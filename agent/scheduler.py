# -*- coding: utf-8 -*-
"""系统级调度器：每日知识更新 + 数据新鲜度兜底 + 扩展接口位

调度策略：
- 每 30 分钟巡检一次（启动后先缓冲 3 分钟再首次巡检）
- 每日任务：当天尚未运行过且时间 >= DAILY_HOUR（09:00）→ 触发 kb_daily.run_daily_update
  （完整管线：归档旧版图谱 → 采集 → 深加工 → 抽取去重入库 → 灵感库重建 → 校验 → 报告）
- 兜底任务：corpus_live.json 超过 24h 未更新且当日任务不适用 → 轻量 refresh（无 LLM）
- 进程重启播种：从 corpus_live.json 的 updated 日期恢复 last_run_date，避免重启后重复跑当日任务
- 预留扩展接口位：register_extension()（技术方案中的接口位③，供未来模块无缝集成）
"""
import os
import threading
import time
import json
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
_LIVE = ROOT / "data" / "corpus_live.json"

DAILY_HOUR = 9          # 每日知识更新触发时刻（当地时区）
CHECK_INTERVAL = 1800   # 巡检间隔：30 分钟
BOOT_DELAY = 180        # 启动缓冲，避免与 lifespan 其他初始化抢资源
# 完整更新最小间隔（小时）：默认 24h=每天一次；环境变量可调（如 12 = 每 12 小时一次）
INTERVAL_HOURS = max(1, int(os.environ.get("DUANJU_UPDATE_INTERVAL_HOURS", "24") or 24))
INTERVAL = timedelta(hours=INTERVAL_HOURS)

_state = {
    "last_check": None,
    "last_run_date": None,   # 最近一次完整每日更新的日期（YYYY-MM-DD）
    "last_run_ts": None,     # 最近一次完整每日更新时间（datetime）
    "last_refresh": None,    # 最近一次轻量刷新时间
    "stale": False,
    "running": False,
}

# ---------- 扩展接口位 ----------
_EXTENSIONS = {}


def register_extension(name, handler):
    """预留接口位：未来功能模块通过此注册钩子无缝集成（scheduler 事件驱动调用）"""
    _EXTENSIONS[name] = handler
    return True


def list_extensions():
    return sorted(_EXTENSIONS.keys())


def _stale():
    if not _LIVE.exists():
        return False
    try:
        meta = json.loads(_LIVE.read_text(encoding="utf-8"))
        updated = datetime.fromisoformat(meta.get("updated"))
        return datetime.now() - updated > timedelta(hours=24)
    except Exception:
        return False


def _corpus_date():
    """语料最近更新日期（YYYY-MM-DD），读取失败返回 None"""
    try:
        meta = json.loads(_LIVE.read_text(encoding="utf-8"))
        return (meta.get("updated") or "")[:10]
    except Exception:
        return None


def _corpus_updated_at():
    """语料最近更新时间（datetime），读取失败返回 None"""
    try:
        meta = json.loads(_LIVE.read_text(encoding="utf-8"))
        return datetime.fromisoformat(meta.get("updated"))
    except Exception:
        return None


def refresh_now(reason="manual"):
    """轻量刷新（无 LLM）：重新采集 → 重建知识库 → 小批量增量抽取"""
    if _state["running"]:
        return {"ok": False, "msg": "刷新进行中"}
    _state["running"] = True
    try:
        from . import collector
        from .knowledge import reset_kb
        from .extractor import run_extract

        result = collector.collect()
        if result.get("ok"):
            reset_kb()
            import asyncio
            try:
                loop = asyncio.get_running_loop()
            except RuntimeError:
                loop = None
            if loop:
                loop.create_task(run_extract(limit=5, use_llm=False))
            else:
                asyncio.run(run_extract(limit=5, use_llm=False))
        _state["last_refresh"] = datetime.now().isoformat(timespec="seconds")
        for name, fn in _EXTENSIONS.items():
            try:
                fn("refresh", {"reason": reason})
            except Exception:
                pass
        return {"ok": bool(result.get("ok")), "reason": reason, "collect": result}
    finally:
        _state["running"] = False


def _run_daily(reason):
    """在工作线程中执行完整每日管线（无事件循环，kb_daily 内部用 asyncio.run 安全）"""
    try:
        from . import kb_daily
        rep = kb_daily.run_daily_update(reason=reason)
        for name, fn in _EXTENSIONS.items():
            try:
                fn("daily_update", {"reason": reason, "run_id": rep.get("run_id")})
            except Exception:
                pass
        return rep
    except Exception as e:
        print(f"[scheduler] 每日更新失败: {e}")
        return {"ok": False, "error": str(e)}


def _tick():
    """单次巡检：按 INTERVAL_HOURS 周期触发完整更新，其次 24h 新鲜度兜底"""
    now = datetime.now()

    # ① 手动/外部更新过语料（如页面「每日更新」按钮）→ 同步水位线，避免立刻重复跑
    cu = _corpus_updated_at()
    if cu and now - cu < INTERVAL:
        if _state["last_run_ts"] is None or _state["last_run_ts"] < cu:
            _state["last_run_ts"] = cu
            _state["last_run_date"] = cu.strftime("%Y-%m-%d")

    last = _state.get("last_run_ts")
    if last is None:
        # 从未跑过：到达当日 DAILY_HOUR 后首跑
        if now.hour >= DAILY_HOUR:
            _trigger(now)
    elif now - last >= INTERVAL:
        _trigger(now)

    # ② 兜底：语料陈旧超 24h（完整更新不适用时）
    if _stale():
        _state["stale"] = True
        try:
            print("[scheduler] 语料超 24h 未更新，执行兜底刷新")
            refresh_now(reason="24h_auto_refresh")
        finally:
            _state["stale"] = False


def _trigger(now: datetime):
    """触发完整每日管线（先占位水位线，防止巡检重叠重复触发）"""
    _state["last_run_ts"] = now
    _state["last_run_date"] = now.strftime("%Y-%m-%d")
    print(f"[scheduler] 触发知识更新 (interval_{INTERVAL_HOURS}h)")
    _run_daily("daily_schedule")


def _loop():
    time.sleep(BOOT_DELAY)
    while True:
        _state["last_check"] = datetime.now().isoformat(timespec="seconds")
        try:
            _tick()
        except Exception as e:
            print(f"[scheduler] 巡检失败: {e}")
        time.sleep(CHECK_INTERVAL)


def start():
    """FastAPI startup 时调用：播种水位线（INTERVAL 内更新过则不立刻重跑）+ 启动守护线程"""
    cu = _corpus_updated_at()
    if cu and datetime.now() - cu < INTERVAL:
        _state["last_run_ts"] = cu
        _state["last_run_date"] = cu.strftime("%Y-%m-%d")
    elif not _state.get("last_run_date"):
        d = _corpus_date()
        if d:
            _state["last_run_date"] = d
    threading.Thread(target=_loop, daemon=True, name="kb-scheduler").start()
    return True


def status():
    return {**_state, "daily_hour": DAILY_HOUR,
            "check_interval_min": CHECK_INTERVAL // 60,
            "interval_hours": INTERVAL_HOURS, "corpus_date": _corpus_date()}
