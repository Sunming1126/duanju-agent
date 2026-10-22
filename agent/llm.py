# -*- coding: utf-8 -*-
"""LLM 客户端：OpenAI 兼容模式（当前：火山方舟 豆包 doubao-seed-2-1-lite）

配置优先级：界面保存的 data/llm_config.json > 真实环境变量 / 项目根 .env > 内置默认
支持运行时热更新：update_config() 修改模块级变量后所有引用方（llm.MODEL 等）立即生效，无需重启。
"""
import os
import json
import time
import random
import asyncio
from pathlib import Path

import httpx
from dotenv import load_dotenv

# 优先级：真实环境变量 > 项目根 .env（不覆盖已有环境变量）
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

# 界面配置文件（存在则优先于环境变量）
_CFG_PATH = Path(__file__).resolve().parent.parent / "data" / "llm_config.json"


def _load_file_cfg():
    try:
        return json.loads(_CFG_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


_FILE_CFG = _load_file_cfg()
_CFG_MTIME = _CFG_PATH.stat().st_mtime if _CFG_PATH.exists() else 0.0


def _apply_cfg(cfg: dict):
    """将文件配置应用到模块级变量（优先级：文件值 > 环境变量 > 内置默认）"""
    global API_KEY, API_BASE, MODEL
    API_KEY = cfg.get("api_key") or os.environ.get("OPENAI_API_KEY", "")
    API_BASE = (cfg.get("api_base") or os.environ.get("OPENAI_API_BASE")
                or "https://ark.cn-beijing.volces.com/api/v3").rstrip("/")
    MODEL = cfg.get("model") or os.environ.get("LLM_DEFAULT_MODEL", "doubao-seed-2-1-lite-260915")


_apply_cfg(_FILE_CFG)


def _refresh_config():
    """配置文件热重载：llm_config.json 落盘变更后自动生效（修复服务启动后改配置不生效导致 LLM 全挂、
    每集静默落模板兜底的问题）。仅在 chat() 入口做一次 stat 对比，开销可忽略。"""
    global _FILE_CFG, _CFG_MTIME
    try:
        mt = _CFG_PATH.stat().st_mtime
    except OSError:
        return
    if mt != _CFG_MTIME:
        _CFG_MTIME = mt
        _FILE_CFG = _load_file_cfg()
        _apply_cfg(_FILE_CFG)
        print(f"[llm] 检测到 llm_config.json 变更，已热重载：model={MODEL} base={API_BASE}")


def provider_of(api_base: str) -> str:
    """根据 API Base 识别 AI 方案（厂商/平台）"""
    b = (api_base or "").lower()
    if "volces.com" in b or "/ark" in b:
        return "火山方舟（豆包）"
    if "dashscope" in b:
        return "阿里云百炼（通义千问）"
    if "deepseek" in b:
        return "DeepSeek"
    if "moonshot" in b:
        return "月之暗面（Kimi）"
    if "bigmodel" in b:
        return "智谱（GLM）"
    if "minimax" in b:
        return "MiniMax"
    if "siliconflow" in b:
        return "硅基流动"
    if "openai.com" in b:
        return "OpenAI"
    return "OpenAI 兼容"


def get_config():
    """当前生效配置（密钥脱敏）"""
    if _CFG_PATH.exists():
        source = "界面配置（data/llm_config.json，优先于 .env）"
    elif API_KEY:
        source = "环境变量 / .env"
    else:
        source = "内置默认（未配置密钥）"
    masked = ""
    if API_KEY:
        masked = f"{API_KEY[:4]}****{API_KEY[-4:]}" if len(API_KEY) > 8 else "已配置"
    return {
        "api_base": API_BASE,
        "model": MODEL,
        "has_key": bool(API_KEY),
        "api_key_masked": masked,
        "provider": provider_of(API_BASE),
        "source": source,
    }


def update_config(api_key=None, api_base=None, model=None):
    """更新 AI 配置并立即生效（None/空串 = 保持不变），持久化到 data/llm_config.json"""
    global API_KEY, API_BASE, MODEL
    cfg = _load_file_cfg()
    if api_key and str(api_key).strip():
        cfg["api_key"] = str(api_key).strip()
    if api_base and str(api_base).strip():
        cfg["api_base"] = str(api_base).strip().rstrip("/")
    if model and str(model).strip():
        cfg["model"] = str(model).strip()
    _CFG_PATH.parent.mkdir(exist_ok=True)
    _CFG_PATH.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
    API_KEY = cfg.get("api_key") or API_KEY
    API_BASE = cfg.get("api_base") or API_BASE
    MODEL = cfg.get("model") or MODEL
    return get_config()


async def test_config():
    """连通性测试：发起一次最小真实调用，返回延迟/引擎/错误信息"""
    t0 = time.time()
    reply = await chat([{"role": "user", "content": "只回复两个字：正常"}],
                       temperature=0, max_tokens=8, timeout=25, retries=1)
    out = {"ok": reply is not None, "latency_ms": int((time.time() - t0) * 1000),
           "model": MODEL, "api_base": API_BASE, "provider": provider_of(API_BASE),
           "has_key": bool(API_KEY)}
    if reply is not None:
        out["reply"] = reply.strip()[:50]
    else:
        out["error"] = "调用失败（见服务端日志 [llm] 行）"
    return out


async def chat(messages, temperature=0.8, max_tokens=2000, timeout=150.0, retries=3, err_box=None):
    """调用 LLM，返回文本；失败返回 None（由上层走模板兜底或挂起）。
    瞬时失败（超时/限流/5xx）自动重试，指数退避（429 限流窗口按分钟计，用 10/25/45s 长退避+随机抖动）。
    err_box 传 dict 时回传末次失败类型：{kind: rate_limit|http_error|error, status, attempts}；
    调用方据此区分「限流挂起」与「普通失败兜底」（见 serial.run_continuation）。"""
    _refresh_config()  # 配置文件热重载（llm_config.json 变更自动生效）
    url = f"{API_BASE}/chat/completions"
    payload = {
        "model": MODEL,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    # 豆包 seed 系列：关闭思维链提速（创作类任务无需 CoT，长文易超时）
    if MODEL.startswith("doubao"):
        payload["thinking"] = {"type": "disabled"}
    headers = {"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}
    last_err = None
    if err_box is not None:
        err_box.clear()
    for attempt in range(retries):
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                resp = await client.post(url, json=payload, headers=headers)
                resp.raise_for_status()
                data = resp.json()
                if err_box is not None:
                    err_box.clear()
                return data["choices"][0]["message"]["content"]
        except httpx.HTTPStatusError as e:
            last_err = e
            status = e.response.status_code if e.response is not None else 0
            limited = status == 429
            if err_box is not None:
                err_box.clear()
                err_box.update({"kind": "rate_limit" if limited else "http_error",
                                "status": status, "attempts": attempt + 1})
            print(f"[llm] 第{attempt + 1}次调用失败: HTTPStatusError: {e}"
                  + ("（限流，延长退避）" if limited else ""))
            if attempt < retries - 1:
                wait = 10 * (attempt + 1) + 15 * attempt if limited else 1.5 * (2 ** attempt)
                await asyncio.sleep(wait + random.uniform(0, 2))
        except Exception as e:
            last_err = e
            if err_box is not None:
                err_box.clear()
                err_box.update({"kind": "error", "status": 0, "attempts": attempt + 1})
            print(f"[llm] 第{attempt + 1}次调用失败: {type(e).__name__}: {e}")
            if attempt < retries - 1:
                await asyncio.sleep(1.5 * (2 ** attempt))
    print(f"[llm] 重试{retries}次仍失败: {type(last_err).__name__}")
    return None


async def chat_json(messages, temperature=0.5, max_tokens=2000, timeout=90.0):
    """调用 LLM 并解析 JSON（容忍 ```json 包裹），失败返回 None"""
    text = await chat(messages, temperature, max_tokens, timeout)
    if text is None:
        return None
    text = text.strip()
    # 剥离 markdown 代码块
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]
    # 截取首个 { 或 [ 到最后一个 } 或 ]
    for start_ch, end_ch in (("{", "}"), ("[", "]")):
        i, j = text.find(start_ch), text.rfind(end_ch)
        if i != -1 and j > i:
            try:
                return json.loads(text[i : j + 1])
            except Exception:
                continue
    return None
