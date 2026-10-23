# -*- coding: utf-8 -*-
"""短剧剧本生成 Agent Demo — FastAPI 入口（第五阶段：语料平台系统性功能扩展）

模块1 平台类别扩展   /api/categories*
模块2 知识图谱       /api/graph*
模块3 灵感索引/溯源  /api/inspire* /api/traces* /api/related_dramas /api/compare
模块4 钩子/模板/转化 /api/hooks* /api/templates* /api/convert
系统级               /api/stats /api/refresh /api/extensions

启动：python main.py  页面：http://localhost:8765
"""
import asyncio
import json
import os
import random
import re
import threading
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Request
from fastapi.responses import StreamingResponse, FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from agent.pipeline import run_pipeline
from agent.knowledge import get_kb, reset_kb
from agent import collector
from agent import polish as polish_mod
from agent import categories as cats
from agent import graph as graph_mod
from agent import hooks as hooks_mod
from agent import fallback as fb
from agent import templates as tpl_mod
from agent import trace as trace_mod
from agent import scheduler
from agent import kb_daily
from agent import llm as llm_mod
from agent.extractor import run_extract, extract_text_hooks, EXTRACT_RULES
from agent.market import normalize_market, normalize_locale, normalize_content_type, normalize_item, market_matches
from agent.library import reference_from_corpus, stored_library_item
from agent import localization as loc
from agent.studio_api import router as studio_router, store as studio_store

ROOT = Path(__file__).resolve().parent


@asynccontextmanager
async def lifespan(_app):
    studio_store.recover_interrupted()  # 仅恢复本地创作候选，不自动重发模型请求
    hooks_mod.ensure_seed()  # 启动时幂等扩充钩子种子库（32条预审通过）
    _cleanup_stale_writer_tasks()  # 服务重启会中断 running 任务，统一标记为 error（suspended 任务保留可续跑）
    _sync_library_from_graph()  # 知识图谱剧本实体 → 参考剧本库（幂等）
    if os.environ.get("DUANJU_SCHEDULER_ENABLED", "true").lower() in {"1", "true", "yes"}:
        scheduler.start()  # 24h 数据新鲜度守护；私有部署可关闭自动采集
    if os.environ.get("DUANJU_WRITER_AUTO_RESUME_ENABLED", "true").lower() in {"1", "true", "yes"}:
        asyncio.create_task(_writer_auto_resume_loop())  # 本地测试可关闭旧任务的自动续跑
    yield


def _merge_outline_ext(task: dict, cont: dict) -> str:
    """按集号合并新旧续写的 outline_ext（加集续写不丢前段大纲行）"""
    from agent.serial import parse_outline
    old = parse_outline((task.get("cont") or {}).get("outline_ext", ""))
    new = parse_outline((cont or {}).get("outline_ext", "") or "")
    merged = {**old, **new}
    return "\n".join(line for _, line in sorted(merged.items()))


async def _writer_auto_resume_loop():
    """D: 挂起任务自动续跑守护——每 10 分钟扫描 suspended 任务，LLM 探活成功即自动续写"""
    while True:
        await asyncio.sleep(600)
        try:
            if not llm_mod.get_config().get("api_key"):
                continue
            task_dir = ROOT / "data" / "writer_tasks"
            if not task_dir.exists():
                continue
            for p in sorted(task_dir.glob("*.json")):
                try:
                    t = json.load(open(p, encoding="utf-8"))
                except Exception:
                    continue
                if t.get("status") != "suspended" or not t.get("tid"):
                    continue
                if time.time() - t.get("updated_at", 0) < 600:
                    continue  # 挂起不足 10 分钟：优先留给用户手动续跑
                probe = await llm_mod.chat(
                    [{"role": "user", "content": "只回复两个字：正常"}],
                    temperature=0, max_tokens=8, timeout=20, retries=1)
                if not probe:
                    continue  # 限流未恢复，等下一轮扫描
                try:
                    await writer_continue_task(t["tid"], {
                        "anchor": "both", "note": "",
                        "target": ((t.get("suspended") or {}).get("target")
                                   or (t.get("cont") or {}).get("target") or 10)})
                except HTTPException:
                    pass  # 用户已手动续写（running）或任务已被处理
                await asyncio.sleep(5)  # 多个挂起任务间错峰，避免冲击 LLM
        except Exception:
            pass  # 守护循环永不退出


def _cleanup_stale_writer_tasks():
    """把遗留的 status=running 编剧任务标记为 error（服务重启必然中断）"""
    task_dir = ROOT / "data" / "writer_tasks"
    if not task_dir.exists():
        return
    for p in task_dir.glob("*.json"):
        try:
            t = json.load(open(p, encoding="utf-8"))
        except Exception:
            continue
        if t.get("status") == "running":
            t["status"] = "error"
            t["error"] = t.get("error") or "服务重启导致任务中断"
            t["updated_at"] = time.time()
            with open(p, "w", encoding="utf-8") as f:
                json.dump(t, f, ensure_ascii=False)


app = FastAPI(title="短剧剧本生成 Agent Demo", version="0.6.0", lifespan=lifespan)
app.include_router(studio_router)


# 线上两个域名共用一个进程，市场边界由 Host 决定。未知 Host 仅保留本地
# 开发兼容：/cn 为中国区，其余路径按日本区处理。
SITE_HOST_MARKETS = {
    "juben.onesay.top": "japan",
    "jubencn.onesay.top": "china",
}


def site_market_for_request(request: Request) -> str:
    host = (request.headers.get("host") or "").split(":", 1)[0].strip().lower()
    if host in SITE_HOST_MARKETS:
        return SITE_HOST_MARKETS[host]  # 线上：域名决定市场（客户端不可伪造）
    # 本地开发 / 内网：X-Duanju-Site header（前端统一注入）→ /cn 路径回退 → 默认日本区
    if (request.headers.get("x-duanju-site") or "").strip().lower() == "china":
        return "china"
    return "china" if request.url.path == "/cn" or request.url.path.startswith("/cn/") else "japan"


@app.middleware("http")
async def enforce_site_market(request: Request, call_next):
    """把公开站点的 API 请求限制在当前域名市场，避免靠参数跨区读取或写入。"""
    if not request.url.path.startswith("/api/"):
        return await call_next(request)

    market = site_market_for_request(request)
    requested = request.query_params.get("market")
    if requested and normalize_market(requested) != market:
        return JSONResponse({"detail": "当前站点不允许访问另一市场"}, status_code=403)

    # 所有支持 market 查询参数的读取接口，在缺省时也必须按当前站点过滤。
    if not requested:
        params = list(request.query_params.multi_items())
        params.append(("market", market))
        from urllib.parse import urlencode
        request.scope["query_string"] = urlencode(params).encode("utf-8")

    # JSON 写入请求缺省时注入当前市场；显式指定另一市场则拒绝。
    # 注意：/api/generate 为 SSE 流式端点，替换 request._receive 会破坏 chunked 流
    # （BaseHTTPMiddleware 已知兼容性问题），且该端点函数内已强制站点市场，此处跳过。
    if request.url.path == "/api/generate":
        request.state.site_market = market
        return await call_next(request)
    if request.method in {"POST", "PUT", "PATCH", "DELETE"} and "application/json" in (request.headers.get("content-type") or ""):
        body = await request.body()
        if body:
            try:
                payload = json.loads(body)
            except Exception:
                payload = None
            if isinstance(payload, dict):
                body_market = payload.get("market")
                if body_market and normalize_market(body_market) != market:
                    return JSONResponse({"detail": "当前站点不允许写入另一市场"}, status_code=403)
                payload["market"] = market
                body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
                request._body = body
                async def receive():
                    return {"type": "http.request", "body": body, "more_body": False}
                request._receive = receive
    request.state.site_market = market
    return await call_next(request)


class GenReq(BaseModel):
    idea: str = ""
    genre: str = "逆袭/战神"
    hero: str = ""
    episodes: int = 12
    market: str = "china"
    output_locale: str = "zh-CN"
    content_type: str = "short_drama"
    # 小说模式专属（content_type=novel 时生效）
    novel_length: str = "long"      # long 长篇连载 / short 短篇
    audience: str = "general"       # male 男性向 / female 女性向 / general 一般向
    worldview: str = ""             # 世界观设定
    words_per_chapter: int = 0      # 章节字数（0=默认 500-900）


# ================= 基础（原有一~四阶段端点） =================

def resolve_site_market(request: Request) -> str:
    """端点内站点市场判定（与 enforce_site_market 中间件同一判定源）"""
    return site_market_for_request(request)


def deny_cross_market(item_market, site: str):
    """详情接口市场校验：跨站点内容一律 404（不暴露存在性）"""
    if normalize_market(item_market) != site:
        raise HTTPException(404, "不存在")


@app.get("/")
def index():
    return FileResponse(ROOT / "static" / "index.html")


@app.get("/cn")
def index_cn():
    """本地兼容入口：中国版页面（线上由 jubencn.onesay.top 承载）"""
    return FileResponse(ROOT / "static" / "index.html")


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "duanju-script-agent", "version": "0.6.0",
            "model": llm_mod.MODEL, "llm_ready": bool(llm_mod.API_KEY)}


# ================= AI 方案配置（查看 / 修改 / 测试，热生效） =================
class LlmConfigReq(BaseModel):
    api_key: str = ""    # 留空 = 保持现有密钥不变
    api_base: str = ""
    model: str = ""


@app.get("/api/llm/config")
def api_llm_config_get():
    """当前 AI 方案与配置（密钥脱敏展示）"""
    return {"ok": True, **llm_mod.get_config()}


@app.post("/api/llm/config")
def api_llm_config_update(req: LlmConfigReq):
    """修改 AI 配置（厂商 API Base / 模型 / 密钥），立即生效无需重启"""
    cfg = llm_mod.update_config(req.api_key or None, req.api_base or None, req.model or None)
    return {"ok": True, **cfg}


@app.post("/api/llm/test")
async def api_llm_test():
    """AI 连通性测试：一次最小真实调用，返回延迟与错误信息"""
    return await llm_mod.test_config()


@app.get("/api/corpus")
def corpus(market: str = "", locale: str = "", content_type: str = ""):
    kb = get_kb()
    items = [{k: v for k, v in it.items() if not k.startswith("_")} for it in kb.items
             if market_matches(it, market, locale, content_type)]
    return {"count": len(items), "live": kb.live_meta, "items": items}


@app.post("/api/collect")
async def collect():
    """多源实时采集（红果短剧榜 + 晋江网文榜，注册表内全部源）→ 重建知识库 → 新剧本自动抽取入知识图谱"""
    result = await asyncio.to_thread(collector.collect)
    if result.get("ok"):
        reset_kb()
        try:
            # 新采集语料自动抽取入知识图谱：规则引擎零成本（drama/hook/theme/tags 实体），
            # 按 extract_progress 幂等去重；LLM 深挖留给「每日更新」或手动「抽取」按钮
            ext = await run_extract(limit=2000, use_llm=False)
            result["graph_extract"] = ext
            _sync_library_from_graph()  # 图谱新增剧本同步进参考剧本库
        except Exception as e:
            result["graph_extract_error"] = str(e)  # 抽取失败不影响采集结果
    return result


@app.post("/api/corpus/polish")
async def corpus_polish(body: dict = None):
    """AI 深加工语料：LLM 批量补全采集条目的钩子/反转/金句/节拍（heat 高优先，已加工跳过）。
    body 可选 {limit?: int}，默认 20 条。"""
    body = body or {}
    try:
        result = await polish_mod.polish(limit=int(body.get("limit", 20)))
        if result.get("polished"):
            reset_kb()
        return result
    except Exception as e:
        raise HTTPException(500, f"深加工失败: {e}")


@app.post("/api/corpus/import")
async def corpus_import(request: Request, body: dict = None):
    """人工导入语料：body {text?, market?, content_type?}（market 由站点域名强制） 支持 JSON 数组 / CSV（含表头）/ MD（## 分块 字段:值）。
    解析成功写入 data/corpus_manual.json（独立于采集产物，不会被采集刷新覆盖）→ 重建知识库。
    market/content_type 为条目未自带时的默认值（自由导入日本资料时传 market=japan）。"""
    body = body or {}
    text = body.get("text", "")
    default_market = resolve_site_market(request)  # 站点强制：导入一律归当前站点市场
    default_ct = body.get("content_type", "")
    try:
        items, fmt = polish_mod.parse_import_text(text)
        if not items:
            raise HTTPException(400, "未解析到有效条目（需含 title 字段/列）")
        if default_market or default_ct:
            for it in items:
                it["market"] = it.get("market") or default_market
                it["content_type"] = it.get("content_type") or default_ct
        result = await asyncio.to_thread(polish_mod.merge_manual_items, items)
        reset_kb()
        return {**result, "fmt": fmt}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"导入失败: {e}")


@app.get("/api/corpus/search")
def corpus_search(request: Request, q: str, top_k: int = 5, locale: str = "", content_type: str = ""):
    market = resolve_site_market(request)
    if not q.strip():
        raise HTTPException(400, "q 不能为空")
    hits = get_kb().search(q, top_k=top_k, market=market, locale=locale, content_type=content_type)
    return {"query": q, "hits": hits}


@app.get("/api/leaderboard")
def leaderboard(request: Request):
    market = resolve_site_market(request)
    if (ROOT / "data" / "corpus_live.json").exists():
        try:
            with open(ROOT / "data" / "corpus_live.json", "r", encoding="utf-8") as f:
                live = json.load(f)
            items = [normalize_item(x) for x in live.get("items", [])]
            if market:
                items = [x for x in items if market_matches(x, market)]
            items = sorted(items, key=lambda x: -x.get("heat", 0))
            genre_count: dict = {}
            for it in items:
                g = (it.get("genre") or "其他").split("/")[0]
                genre_count[g] = genre_count.get(g, 0) + 1
            return {
                "updated": live.get("updated"),
                "source": "日本公开作品榜单" if market == "japan" else "红果短剧网页版（实时采集）",
                "list": [
                    {
                        "rank": i + 1,
                        "title": it["title"],
                        "genre": it["genre"],
                        "heat": it.get("heat", 0),
                        "trend": f"{it.get('tab', '')} 第{it.get('rank', '-')}名",
                        "tags": it.get("tags", [])[:4],
                        "logline": (it.get("logline") or "")[:60],
                        "market": it.get("market", "china"),
                        "source_platform": it.get("source_platform", ""),
                        "content_type": it.get("content_type", "short_drama"),
                    }
                    for i, it in enumerate(items)
                ],
                "genre_stats": sorted(genre_count.items(), key=lambda x: -x[1]),
            }
        except Exception:
            pass
    with open(ROOT / "data" / "leaderboard.json", "r", encoding="utf-8") as f:
        return json.load(f)


def _save_writer_history(req: GenReq, events: list):
    """工作台流水线产出 → 编剧历史任务（对接：编剧页「历史任务」可载入重放/加集续写）"""
    try:
        ev = {e.get("node"): (e.get("data") or {})
              for e in events if e.get("status") == "done" and e.get("node") and not str(e.get("node")).startswith("_")}
        parsed = ev.get("parse_idea") or {}
        outline = (ev.get("outline") or {}).get("text", "")
        qc = ev.get("quality_check") or {}
        script_final = (ev.get("refine") or {}).get("text") or (ev.get("script") or {}).get("text") or ""
        if not script_final:
            return  # 无成品不存
        r = req.model_dump() if hasattr(req, "model_dump") else dict(req)
        wtask = {
            "tid": uuid.uuid4().hex[:8],
            "source": "工作台",  # 区别于编剧页发起的任务（req.hot_tags 等字段一致，续写链路通用）
            "stage": "done",
            "status": "completed",
            "req": r,
            "agg": {
                "title": (r.get("idea") or parsed.get("logline") or "")[:30] or "未命名作品",
                "story": parsed.get("logline", ""),
                "genre": parsed.get("genre", "") or r.get("genre", ""),
                "hero": parsed.get("hero", "") or r.get("hero", ""),
                "outline_text": outline,
                "ep1_script": script_final,
                "ep1_qc": {"score": qc.get("score", 0), "pass": qc.get("pass", False), "summary": qc.get("summary", "")},
                "market": r.get("market", "china"),
                "output_locale": r.get("output_locale", "zh-CN"),
                "content_type": r.get("content_type", "short_drama"),
                "script_locale": r.get("output_locale", "zh-CN"),
            },
            "events": events,  # 载入历史时可在编剧画布完整重放
            "created_at": time.time(),
            "updated_at": time.time(),
        }
        wdir = ROOT / "data" / "writer_tasks"
        wdir.mkdir(exist_ok=True)
        with open(wdir / f"{wtask['tid']}.json", "w", encoding="utf-8") as f:
            json.dump(wtask, f, ensure_ascii=False)
        print(f"[writer_history] 工作台产出已保存到编剧历史任务: {wtask['tid']}")
    except Exception as e:
        print(f"[writer_history] 保存失败(不影响生成): {e}")


@app.post("/api/generate")
async def generate(request: Request, req: GenReq):
    req.market = resolve_site_market(request)          # 站点强制归属
    if "output_locale" not in req.model_fields_set or not req.output_locale:
        req.output_locale = normalize_locale(None, req.market)
    if "genre" not in req.model_fields_set or not req.genre:
        req.genre = loc.default_genre(req.output_locale, req.market)
    """SSE 流式生成：逐节点推送状态与内容（完成后自动写入溯源 trace + 编剧历史任务）"""

    async def event_stream():
        queue: asyncio.Queue = asyncio.Queue()
        finished = False

        async def emit(event: dict):
            await queue.put(event)

        async def worker():
            nonlocal finished
            events: list = []
            try:
                async def tap(event: dict):
                    events.append(event)
                    await emit(event)

                await run_pipeline(req.model_dump(), tap)
                _save_writer_history(req, events)  # 工作台产出同步进编剧历史任务
            except Exception as e:
                await queue.put({"node": "_error", "status": "error", "data": {"message": str(e)}})
            finally:
                finished = True

        task = asyncio.create_task(worker())
        try:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=0.2)
                except asyncio.TimeoutError:
                    if finished and queue.empty():
                        break
                    continue
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        finally:
            task.cancel()

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ================= 模块1：平台类别扩展 =================

@app.get("/api/categories")
def api_categories(request: Request, dimension: str = "", include_archived: bool = True):
    market = resolve_site_market(request)
    out = cats.list_categories(dimension=dimension or None, include_archived=include_archived,
                               market=market)
    # usage 统计（端点层组装，存储层保持纯净）：
    # graph=图谱实体按 category_ids 计数 / corpus=语料按 genre 含类别名 / hooks=钩子按 category 名
    g = graph_mod.get_graph()
    kb = get_kb()
    hook_items = hooks_mod.list_hooks(market=market or "")["items"]
    usage = {}
    for c in out["categories"]:
        cid, cname = c["id"], c["name"]
        g_hits = [e.get("name") or e["id"] for e in g.g["entities"] if cid in (e.get("category_ids") or [])]
        c_hits = [it.get("title") or it.get("name") for it in kb.items if cname in (it.get("genre") or "")]
        usage[cid] = {
            "graph": len(g_hits),
            "corpus": len(c_hits),
            "hooks": sum(1 for h in hook_items if h.get("category") == cname),
            # 挂接内容清单（D3：图谱实体前 8 / 语料前 5，前端点击可跳转定位）
            "graph_names": g_hits[:8],
            "corpus_names": c_hits[:5],
        }
    out["usage"] = usage
    return out


@app.post("/api/categories")
def api_category_add(request: Request, body: dict):
    try:
        return cats.add_category(body.get("dimension", ""), body.get("name", ""),
                                 body.get("features", ""), body.get("data_source", ""),
                                 body.get("related_ids"), market=resolve_site_market(request))
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.put("/api/categories/{cid}")
def api_category_update(request: Request, cid: str, body: dict):
    cat = cats.get_category(cid)
    if cat is not None:
        deny_cross_market(cat.get("market", "china"), resolve_site_market(request))
    try:
        return cats.update_category(cid, name=body.get("name"), features=body.get("features"),
                                    data_source=body.get("data_source"), related_ids=body.get("related_ids"))
    except ValueError as e:
        raise HTTPException(404, str(e))


@app.post("/api/categories/{cid}/archive")
def api_category_archive(request: Request, cid: str, body: dict = None):
    cat = cats.get_category(cid)
    if cat is not None:
        deny_cross_market(cat.get("market", "china"), resolve_site_market(request))
    try:
        return cats.archive_category(cid, (body or {}).get("archived", True))
    except ValueError as e:
        raise HTTPException(404, str(e))


# ================= 模块2：知识图谱 =================

@app.get("/api/graph")
def api_graph(request: Request, types: str = "", q: str = "", limit: int = 300):
    market = resolve_site_market(request)
    tlist = [t.strip() for t in types.split(",") if t.strip()] if types else None
    t0 = time.perf_counter()
    data = graph_mod.get_graph().overview(types=tlist, q=q or None, limit=limit, market=market)
    data["ms"] = round((time.perf_counter() - t0) * 1000, 1)
    data["type_names"] = graph_mod.TYPE_NAMES
    return data


@app.get("/api/graph/cluster")
def api_graph_cluster(request: Request):
    return {"clusters": graph_mod.get_graph().cluster(market=resolve_site_market(request))}


@app.get("/api/graph/node/{eid}")
def api_graph_node(request: Request, eid: str):
    g = graph_mod.get_graph()
    e = g.get(eid)
    if not e:
        raise HTTPException(404, f"节点不存在: {eid}")
    site = resolve_site_market(request)
    em = e.get("market") or "china"
    if site and em not in (site, "common"):
        raise HTTPException(404, f"节点不存在: {eid}")  # 跨站点内容不暴露存在性
    return {"node": e, "neighbors": g.neighbors(eid), "type_names": graph_mod.TYPE_NAMES}


@app.get("/api/graph/path")
def api_graph_path(src: str, dst: str, max_hops: int = 4):
    p = graph_mod.get_graph().path(src, dst, max_hops)
    if not p:
        raise HTTPException(404, f"无路径: {src} → {dst}（≤{max_hops}跳）")
    return p


@app.post("/api/graph/extract")
async def api_graph_extract(body: dict = None):
    """触发大模型知识抽取（body 可选 {limit, use_llm}）"""
    body = body or {}
    result = await run_extract(limit=int(body.get("limit", 8)),
                               use_llm=bool(body.get("use_llm", False)))
    return result


# ================= 模块3：灵感索引 / 溯源 / 关联 / 对比 =================

@app.get("/api/inspire")
def api_inspire(request: Request, q: str = "", theme: str = "", emotion: str = "", tag: str = "",
                top_k: int = 8):
    """创作灵感索引：主题(题材)/情感/标签 多维过滤 + BM25 检索；市场由域名决定"""
    market = resolve_site_market(request)
    kb = get_kb()
    pool = [i for i in range(len(kb.items))
            if (not market) or normalize_market(kb.items[i].get("market")) == normalize_market(market)]
    if theme:
        pool = [i for i in pool if theme in (kb.items[i].get("genre") or "")]
    if emotion:
        pool = [i for i in pool
                if emotion in " ".join(kb.items[i].get("tags", [])) or emotion in (kb.items[i].get("genre") or "")]
    if tag:
        pool = [i for i in pool if tag in " ".join(kb.items[i].get("tags", []))]
    t0 = time.perf_counter()
    if q.strip() and pool:
        hits = kb.search(q, top_k=top_k, pool=pool)
    else:
        hits = []
        for i in pool[:top_k]:
            it = dict(kb.items[i])
            it["_score"] = it.get("heat", 0) / 10000
            hits.append(it)
    ms = round((time.perf_counter() - t0) * 1000, 1)
    return {"count": len(hits), "ms": ms, "filters": {"theme": theme, "emotion": emotion, "tag": tag, "q": q},
            "hits": [{k: v for k, v in h.items() if not k.startswith("_")} | {"_score": h.get("_score")} for h in hits]}


@app.get("/api/inspire/related")
def api_inspire_related(eid: str, top_k: int = 6):
    """关联推荐：图谱关联度排序 + 互补内容（标签互补）"""
    g = graph_mod.get_graph()
    ref = eid if ":" in eid else f"drama:{eid}"
    if not g.get(ref):
        raise HTTPException(404, f"图谱中不存在: {eid}")
    related = g.related_dramas(ref, top_k=top_k)
    base_tags = set((g.get(ref).get("category_ids") or []) + (g.get(ref)["props"].get("tags") or []))
    for r in related:
        o = g.get(r["id"])
        otags = set((o.get("category_ids") or []) + (o["props"].get("tags") or []))
        r["complementary_tags"] = sorted(otags - base_tags)[:4]
    return {"ref": ref, "related": related}


SPARK_EMOTIONS = ["爽感拉满", "甜度超标", "怒火中烧", "悬念窒息", "暖到心坎", "紧张到手心出汗"]
# (主角人设全称, 片名短称)
SPARK_HEROES = [("被赶出家族的假千金", "假千金"), ("隐藏实力的上门女婿", "上门女婿"),
                ("重生归来的复仇千金", "复仇千金"), ("觉醒系统的普通上班族", "上班族"),
                ("带着萌宝的离异设计师", "离异设计师"), ("重回高考前的中年人", "中年人"),
                ("穿越成反派的落魄编剧", "落魄编剧"), ("被误会十年的老实人", "老实人")]
SPARK_TITLES = ["{g}风暴：{h}不好惹", "再见，{h}", "{h}的第二次人生",
                "谁说{g}不能赢", "{h}觉醒之后", "这一次，{h}不退让",
                "{g}局中局", "{h}的顶点时刻"]


def _spark_one(kb) -> dict:
    """单张本地灵感卡：题材×情绪×钩子机制×主角人设×片名 组合"""
    gpool = list(fb.BEAT_LIB.keys())
    for it in kb.items:
        if not market_matches(it, "china"):
            continue
        g = (it.get("genre") or "").split("/")[0]
        if g and g not in gpool:
            gpool.append(g)
    genre = random.choice(gpool)
    emotion = random.choice(SPARK_EMOTIONS)
    hero, hero_short = random.choice(SPARK_HEROES)
    beats = fb._pick_beats(genre, 6)
    mechanism = random.choice(hooks_mod.MECHANISMS)
    # 开场钩子优先从已通过钩子库抽真实钩子（优先匹配机制），库空时退回题材模板
    approved_open = [h for h in hooks_mod.list_hooks(status="approved")["items"]
                     if h["position"] == "open"]
    pool = [h for h in approved_open if h["mechanism"] == mechanism] or approved_open
    if pool:
        h = random.choice(pool)
        open_hook = {"text": h["text"], "category": h["category"], "mechanism": h["mechanism"],
                     "intensity": h["intensity"], "from": "钩子库"}
    else:
        open_hook = {"text": fb._pick_hook(genre, hero), "category": None,
                     "mechanism": None, "intensity": 3, "from": "题材模板"}
    title = "《" + random.choice(SPARK_TITLES).format(g=genre, h=hero_short) + "》"
    logline = (f"开场即{beats[0]}：{hero}被卷入{genre}漩涡；{beats[2]}只是开始，"
               f"真正的底牌要到「{beats[4]}」才掀开。")
    return {"title": title, "genre": genre, "hero": hero, "emotion": emotion,
            "mechanism": mechanism, "logline": logline, "open_hook": open_hook,
            "beats": beats, "tags": [genre, emotion, mechanism]}


@app.get("/api/inspire/spark")
def api_inspire_spark(request: Request, n: int = 1):
    """灵感抽卡：一次抽 n 张（1..12）；市场由域名决定"""
    market = resolve_site_market(request)
    kb = get_kb()
    n = max(1, min(int(n or 1), 12))
    mkt = market or ""
    if mkt and normalize_market(mkt) == "japan":
        cards = [_spark_one_japan(kb) for _ in range(n)]
    else:
        cards = [_spark_one(kb) for _ in range(n)]
    return {"count": n, "market": normalize_market(mkt) if mkt else "china", "cards": cards}


def _spark_one_japan(kb) -> dict:
    """日本市场灵感卡：从日本语料随机抽真实作品 + 日本钩子库（fallback：语料自身字段拼卡）"""
    pool = [it for it in kb.items
            if normalize_market(it.get("market")) == "japan" and (it.get("title") or "").strip()]
    if not pool:
        return {"title": "《日本語アイデア》", "genre": "", "hero": "", "emotion": "",
                "mechanism": "", "logline": "日本語料がまだありません。知識グラフで「毎日更新」を実行してください。",
                "open_hook": {"text": "", "from": "", "mechanism": "", "intensity": 0},
                "beats": [], "tags": ["japan"], "market": "japan"}
    it = random.choice(pool)
    hook = (it.get("hook") or "").strip()
    open_hook = {"text": hook[:80], "category": None, "mechanism": None, "intensity": 3,
                 "from": it.get("source_platform") or "日本語料"} if hook \
        else {"text": "", "from": "", "mechanism": "", "intensity": 0}
    return {"title": it["title"], "genre": it.get("genre", ""),
            "hero": (it.get("hero") or "")[:40], "author": it.get("author") or "",
            "record_type": "source_reference", "emotion": (it.get("tags") or [""])[0],
            "mechanism": "", "logline": (it.get("logline") or it["title"])[:120],
            "open_hook": open_hook, "beats": [str(b) for b in (it.get("beats") or [])][:6],
            "tags": [str(t) for t in (it.get("tags") or [])][:4],
            "source_url": it.get("source_url", ""), "market": "japan"}


SPARK_AI_SCHEMA = ("[{\"title\":\"《书名》\",\"genre\":\"题材\",\"hero\":\"主角人设（含身份反差）\","
                   "\"emotion\":\"情绪卖点\",\"mechanism\":\"悬念或危机或反差或期待或金句\","
                   "\"logline\":\"一句话故事(40-70字)\","
                   "\"open_hook\":{\"text\":\"开场3秒钩子(20-40字)\",\"intensity\":3},"
                   "\"beats\":[\"6个递进节拍短语\"],\"tags\":[\"3个标签\"]}]")


def _spark_g(d: dict, *names):
    """按候选键名取值（模型可能输出中文键名）"""
    for n in names:
        v = d.get(n)
        if v:
            return v
    return None


@app.post("/api/inspire/spark_ai")
async def api_inspire_spark_ai(request: Request, body: dict):
    """AI 灵感卡：豆包按约束批量生成创意种子，字段与本地卡一致（失败自动退回本地组合）"""
    kb = get_kb()
    try:
        n = max(1, min(int(body.get("n") or 4), 8))
    except (TypeError, ValueError):
        n = 4
    hint = str(body.get("hint") or "").strip()[:120]
    market = resolve_site_market(request)
    output_locale = normalize_locale(body.get("output_locale"), market)
    content_type = normalize_content_type(body.get("content_type"))
    gpool = list(loc.JP_GENRES if market == "japan" else fb.BEAT_LIB.keys())
    for it in kb.items:
        if not market_matches(it, market):
            continue
        g = (it.get("genre") or "").split("/")[0]
        if g and g not in gpool:
            gpool.append(g)
    prompt = (
        "你是面向目标市场的故事策划。请生成 "
        f"{n} 张互不雷同的短剧创意灵感卡。\n"
        f"- 题材从这些赛道里选或自创相近的：{('、'.join(gpool[:18]))}\n"
        f"- 钩子机制五选一：{('、'.join(hooks_mod.MECHANISMS))}\n"
        "- 主角人设要有身份反差和记忆点；logline 讲清 冲突+反差+爽点；"
        "开场钩子要 3 秒抓人；beats 按 起手-升级-反转-压制-爆发-结尾钩子 递进，共6个短语。\n"
        + (f"- 用户方向约束：{hint}\n" if hint else "")
        + "严格只输出 JSON 数组，字段名必须与下面示例完全一致（英文键名），不要增删字段：\n"
        + SPARK_AI_SCHEMA + "\n" + loc.language_instruction(output_locale, market)
        + f"\n内容类型：{content_type}。"
    )
    t0 = time.perf_counter()
    try:
        raw = await llm_mod.chat_json([{"role": "user", "content": prompt}],
                                      temperature=0.95, max_tokens=4000, timeout=120.0)
    except Exception:
        raw = None
    # 容错解析：list 直接用；dict 取第一个 list 值（模型可能包一层对象）
    raw_list = []
    if isinstance(raw, list):
        raw_list = raw
    elif isinstance(raw, dict):
        raw_list = next((v for v in raw.values() if isinstance(v, list)), [])
    cards = []
    for item in raw_list:
        if not isinstance(item, dict):
            continue
        logline = _spark_g(item, "logline", "一句话故事", "创意", "梗概")
        if not logline:
            continue
        base = _spark_one_japan(kb) if market == "japan" else _spark_one(kb)
        oh = item.get("open_hook")
        if isinstance(oh, dict):
            oh_text = _spark_g(oh, "text", "开场钩子", "开场3秒钩子") or base["open_hook"]["text"]
            oh_mech = _spark_g(oh, "mechanism", "机制")
            oh_int = oh.get("intensity")
        else:  # 钩子直接是文本（或包在中文键里）
            oh_text = _spark_g(item, "开场3秒钩子", "开场钩子") or (str(oh) if oh else base["open_hook"]["text"])
            oh_mech, oh_int = None, 3
        beats = _spark_g(item, "beats", "节拍", "剧情节拍")
        if isinstance(beats, dict):  # 模型可能把节拍包成 {起手:..,升级:..} 对象
            beats = list(beats.values())
        beats = [str(b).strip()[:40] for b in (beats or []) if str(b).strip()][:6] or base["beats"]
        mech = _spark_g(item, "mechanism", "钩子机制")
        cards.append({
            "title": str(_spark_g(item, "title", "书名", "片名") or base["title"])[:30],
            "genre": str(_spark_g(item, "genre", "题材", "题材赛道") or base["genre"])[:12],
            "hero": str(_spark_g(item, "hero", "主角", "主角人设") or base["hero"])[:40],
            "emotion": str(_spark_g(item, "emotion", "情绪", "情绪卖点") or base["emotion"])[:12],
            "mechanism": mech if mech in hooks_mod.MECHANISMS else base["mechanism"],
            "logline": str(logline)[:140], "market": market, "locale": output_locale, "content_type": content_type,
            "open_hook": {"text": str(oh_text)[:60], "category": None, "mechanism": oh_mech,
                          "intensity": oh_int if isinstance(oh_int, int) else 3, "from": "AI"},
            "beats": beats,
            "tags": [str(t)[:12] for t in (_spark_g(item, "tags", "标签") or [])][:3] or base["tags"],
        })
        if len(cards) >= n:
            break
    ms = round((time.perf_counter() - t0) * 1000, 1)
    if not cards:  # AI 失败 → 本地组合兜底，保证功能永远可用
        cards = [(_spark_one_japan(kb) if market == "japan" else _spark_one(kb)) for _ in range(n)]
        return {"ok": False, "fallback": True, "count": len(cards), "ms": ms, "cards": cards}
    return {"ok": True, "count": len(cards), "ms": ms, "cards": cards}


@app.get("/api/traces")
def api_traces(request: Request):
    market = resolve_site_market(request)
    traces = trace_mod.list_traces()
    if market:
        mkt = normalize_market(market)
        items = traces.get("traces") or traces.get("items") or []
        items = [t for t in items
                 if normalize_market((t.get("req") or {}).get("market")) == mkt]
        if "traces" in traces:
            traces["traces"] = items
        else:
            traces["items"] = items
        traces["count"] = len(items)
    return traces


@app.get("/api/traces/{tid}")
def api_trace_detail(tid: str):
    try:
        return trace_mod.get_trace(tid)
    except ValueError as e:
        raise HTTPException(404, str(e))


@app.get("/api/related_dramas/{eid}")
def api_related_dramas(eid: str, top_k: int = 8):
    """剧本间关联度计算与排序（含分解得分）"""
    g = graph_mod.get_graph()
    ref = eid if ":" in eid else f"drama:{eid}"
    t0 = time.perf_counter()
    out = g.related_dramas(ref, top_k=top_k)
    ms = round((time.perf_counter() - t0) * 1000, 1)
    return {"ref": ref, "count": len(out), "ms": ms, "items": out}


@app.post("/api/compare")
def api_compare(body: dict):
    """剧本对比视图：完整元数据 + 内容差异高亮 + 结构比较"""
    a_ref, b_ref = body.get("a", ""), body.get("b", "")
    ka, kb_ = _resolve_script(a_ref), _resolve_script(b_ref)
    diff_a = graph_mod.diff_highlight(ka["text"], kb_["text"])
    diff_b = graph_mod.diff_highlight(kb_["text"], ka["text"])
    beats = {"a": ka.get("beats", []), "b": kb_.get("beats", [])}
    return {"a": ka, "b": kb_,
            "diff": {"a_marked": diff_a[:3000], "b_marked": diff_b[:3000]},
            "structure": beats,
            "similarity": graph_mod.similarity(ka["text"], kb_["text"])}


def _resolve_script(ref: str):
    """对比引用解析：语料 id / 图谱 drama eid / 生成剧 → 完整元数据"""
    kb = get_kb()
    plain = ref.split(":", 1)[-1]
    for it in kb.items:
        if it["id"] == plain:
            text = "。".join(filter(None, [it.get("logline", ""), it.get("hook", ""),
                                           it.get("reversal", ""), "。".join(it.get("golden_lines", []))]))
            return {"id": it["id"], "title": it["title"], "genre": it.get("genre", ""),
                    "author": it.get("source", "manual"), "created_at": it.get("updated", "-"),
                    "tags": it.get("tags", []), "beats": it.get("beats", []), "text": text}
    g = graph_mod.get_graph()
    e = g.get(ref if ":" in ref else f"drama:{ref}")
    if e and e["type"] == "drama":
        p = e["props"]
        text = "。".join(filter(None, [p.get("logline", ""), p.get("text", ""), p.get("brief", "")]))
        return {"id": e["id"], "title": e["name"], "genre": p.get("genre", ""),
                "author": "AI生成" if p.get("generated") else p.get("source", "-"),
                "created_at": e.get("created_at", "-"),
                "tags": p.get("tags", []), "beats": p.get("beats", []), "text": text}
    raise HTTPException(404, f"找不到剧本: {ref}")


# ================= 模块4：钩子 / 模板 / 转化 =================

@app.get("/api/hooks")
def api_hooks(request: Request, status: str = "", q: str = "", category: str = ""):
    market = resolve_site_market(request)  # 站点强制归属（域名决定，忽略请求参数）
    return hooks_mod.list_hooks(status=status or None, q=q or None,
                                category=category or None, market=market)


@app.post("/api/hooks")
def api_hook_create(request: Request, body: dict):
    try:
        return hooks_mod.create_hook(body.get("name", "未命名钩子"), body.get("text", ""),
                                     body.get("category", "悬念钩"), body.get("position", "open"),
                                     body.get("mechanism", "悬念"), body.get("intensity", 3),
                                     body.get("tags"), body.get("source_id"), body.get("status", "pending"),
                                     market=resolve_site_market(request))
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.put("/api/hooks/{hid}")
def api_hook_update(request: Request, hid: str, body: dict):
    h = hooks_mod.get_hook(hid)
    if h:
        deny_cross_market(h.get("market", "china"), resolve_site_market(request))
    try:
        return hooks_mod.update_hook(hid, text=body.get("text"), name=body.get("name"),
                                     category=body.get("category"), position=body.get("position"),
                                     mechanism=body.get("mechanism"), intensity=body.get("intensity"),
                                     tags=body.get("tags"), note=body.get("note", ""))
    except ValueError as e:
        raise HTTPException(404, str(e))


@app.post("/api/hooks/{hid}/review")
def api_hook_review(request: Request, hid: str, body: dict):
    h = hooks_mod.get_hook(hid)
    if h:
        deny_cross_market(h.get("market", "china"), resolve_site_market(request))
    try:
        return hooks_mod.review_hook(hid, bool(body.get("approved", True)),
                                     body.get("reviewer", "user"), body.get("note", ""))
    except ValueError as e:
        raise HTTPException(404, str(e))


@app.post("/api/hooks/bulk_review")
def api_hook_bulk_review(request: Request, body: dict):
    """批量审核：{ids?: [hid], all_pending?: bool, approved?: bool}，状态变更同步图谱置信度"""
    site = resolve_site_market(request)
    ids = body.get("ids")
    if ids:
        ids = [i for i in ids
               if not (h := hooks_mod.get_hook(i)) or normalize_market(h.get("market", "china")) == site]
        body = dict(body); body["ids"] = ids
    return hooks_mod.bulk_review(ids=body.get("ids"), all_pending=bool(body.get("all_pending")),
                                 approved=bool(body.get("approved", True)),
                                 reviewer=body.get("reviewer", "user"), note=body.get("note", ""))


@app.post("/api/hooks/auto_review")
async def api_hook_auto_review(body: dict = None):
    """AI 智能审核：规则查重拒收同质化 → LLM 四维评审（钩子/新颖/可拍/风险）
    综合分 ≥80 自动通过、<60 自动拒绝、60-80 留人工抽查；risk≥70 一票否决；
    LLM 不可用时降级为纯查重，其余留 pending 等人工。body 可选 {ids?: [hid], batch_size?: int}"""
    body = body or {}
    from agent import auto_review as ar_mod
    try:
        return await ar_mod.auto_review(ids=body.get("ids"), batch_size=int(body.get("batch_size", 10)))
    except Exception as e:
        raise HTTPException(500, f"智能审核失败: {e}")


@app.post("/api/hooks/extract")
async def api_hook_extract(request: Request, body: dict = None):
    """钩子智能抽取：规则模式（可自定义 EXTRACT_RULES）；body 可选 {text, save, rule_words}"""
    body = body or {}
    # 支持规则自定义/优化迭代：运行时向指定类别追加识别词
    extra = body.get("rule_words")
    if extra and isinstance(extra, dict):
        for cat, words in extra.items():
            for rule in EXTRACT_RULES["hook_patterns"]:
                if rule["category"] == cat:
                    rule["pattern"] = rule["pattern"][:-1] + "|" + "|".join(words) + ")"
    text = body.get("text", "")
    if text.strip():
        found = extract_text_hooks(text)
    else:
        # 无文本：对未抽取语料跑增量规则抽取
        result = await run_extract(limit=int(body.get("limit", 3)), use_llm=bool(body.get("use_llm", False)))
        return result
    saved = 0
    if body.get("save", True) and text.strip():
        for f in found[:5]:
            try:
                hooks_mod.create_hook(name=f["name"], text=f["text"], category=f["category"],
                                      mechanism=f["mechanism"], intensity=f["intensity"],
                                      tags=["智能抽取"], status="pending", market=resolve_site_market(request))
                saved += 1
            except Exception:
                pass
    return {"found": found, "saved": saved}


@app.get("/api/templates")
def api_templates(request: Request, kind: str = ""):
    return tpl_mod.list_templates(kind or None, market=resolve_site_market(request))


@app.post("/api/templates")
def api_template_create(request: Request, body: dict):
    return tpl_mod.create_template(body.get("name", "自定义结构"), body.get("description", ""),
                                   body.get("beats"), body.get("kind", "custom"),
                                   body.get("total_episodes_hint", ""),
                                   market=resolve_site_market(request))


@app.put("/api/templates/{tid}")
def api_template_update(request: Request, tid: str, body: dict):
    t = tpl_mod.get_template(tid)
    if t:
        deny_cross_market(t.get("market", "china"), resolve_site_market(request))
    try:
        return tpl_mod.update_template(tid, name=body.get("name"), description=body.get("description"),
                                       beats=body.get("beats"), total_episodes_hint=body.get("total_episodes_hint"))
    except ValueError as e:
        raise HTTPException(404, str(e))


@app.delete("/api/templates/{tid}")
def api_template_delete(request: Request, tid: str):
    t = tpl_mod.get_template(tid)
    if t:
        deny_cross_market(t.get("market", "china"), resolve_site_market(request))
    try:
        return {"deleted": tpl_mod.delete_template(tid)}
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.post("/api/convert")
async def api_convert(request: Request, body: dict):
    """小说 → 短剧元素转化（mode=auto 全自动 / manual 返回分析供人工标注）"""
    text = body.get("text", "")
    if not text.strip():
        raise HTTPException(400, "text 不能为空")
    return await _convert(body.get("title", ""), text, body.get("mode", "auto"),
                          resolve_site_market(request), normalize_locale(body.get("output_locale"), resolve_site_market(request)))


async def _convert(title, text, mode, market="china", output_locale="zh-CN"):
    from agent import converter
    return await converter.convert(text, title=title, mode=mode, market=market, output_locale=output_locale)


# ================= 剧本库自主维护（基于语料导入逻辑扩展） =================
class LibraryItem(BaseModel):
    id: str
    title: str
    kind: str = "reference"  # reference=参考剧本库（导入/图谱提取） | generated=生成剧本库（AI 编剧产出）
    source: str = ""         # 来源说明：导入 / 知识图谱 / AI 编剧
    source_id: str = ""      # 图谱实体 id 等，用于幂等去重
    genre: str = ""
    hero: str = ""
    tags: list[str] = []
    hot_tags: list[str] = []  # 热点标签，用于续写时融入剧情
    outline: str = ""
    script: str = ""
    created_at: float
    updated_at: float
    market: str = "china"
    locale: str = "zh-CN"
    content_type: str = "short_drama"
    title_original: str = ""
    title_localized: dict = {}
    synopsis_localized: dict = {}
    script_locale: str = "zh-CN"


@app.get("/api/library")
def library_list(request: Request, kind: str = "", locale: str = "", content_type: str = ""):
    market = resolve_site_market(request)
    """剧本库列表；kind=reference|generated 可选过滤，空返回全部"""
    lib_dir = ROOT / "data" / "library"
    lib_dir.mkdir(exist_ok=True)
    files = list(lib_dir.glob("*.json"))
    items = []
    existing_source_ids = set()
    for f in files:
        try:
            item = json.load(open(f, encoding="utf-8"))
            item["id"] = f.stem
            item.setdefault("kind", "reference")
            item = stored_library_item(item, f.stem)
            if item.get("source_id") and market_matches(item, market):
                existing_source_ids.add(str(item["source_id"]))
            if kind and item.get("kind") != kind:
                continue
            if not market_matches(item, market, locale, content_type):
                continue
            items.append(item)
        except Exception:
            continue
    # 日本实时/手动语料也要在资源库里可见，尤其是小说类型；不把中国语料
    # 重复复制到剧本库。以 source_id 幂等，后续每日采集可安全补充新条目。
    try:
        for corpus_item in get_kb().items:
            if normalize_market(corpus_item.get("market")) != "japan":
                continue
            source_id = str(corpus_item.get("id") or "")
            if not source_id or source_id in existing_source_ids:
                continue
            item = reference_from_corpus(corpus_item)
            if kind and item.get("kind") != kind:
                continue
            if market_matches(item, market, locale, content_type):
                items.append(item)
    except Exception:
        # 语料库读取失败不影响本地已保存的剧本库。
        pass
    return {"ok": True, "count": len(items), "list": sorted(items, key=lambda x: x.get("updated_at", 0), reverse=True)}


@app.post("/api/library")
async def library_add(item: LibraryItem):
    """新增剧本到本地库（生成工作台入库 → generated；其余调用方显式指定 kind）"""
    if item.kind not in ("reference", "generated"):
        item.kind = "generated"
    lib_dir = ROOT / "data" / "library"
    lib_dir.mkdir(exist_ok=True)
    if not item.id:
        import uuid
        item.id = str(uuid.uuid4())[:8]
    path = lib_dir / f"{item.id}.json"
    item.updated_at = time.time()
    item.created_at = item.created_at or time.time()
    with open(path, "w", encoding="utf-8") as f:
        json.dump(item.model_dump(), f, ensure_ascii=False, indent=2)
    return {"ok": True, "id": item.id}


@app.get("/api/library/{lid}")
def library_detail(lid: str, request: Request):
    """Saved scripts and collected references share a resolvable detail route."""
    site = resolve_site_market(request)
    path = ROOT / "data" / "library" / f"{lid}.json"
    if Path(lid).name == lid and path.is_file():
        item = stored_library_item(json.loads(path.read_text(encoding="utf-8")), lid)
        deny_cross_market(item.get("market"), site)
        return item
    if lid.startswith("corpus-"):
        source_id = lid[len("corpus-"):]
        for item in get_kb().items:
            if str(item.get("id")) == source_id and market_matches(item, site):
                return reference_from_corpus(item)
    raise HTTPException(404, "当前站点找不到该作品或参考资料")


@app.delete("/api/library/{lid}")
def library_delete(lid: str, request: Request):
    """删除剧本"""
    if Path(lid).name != lid:
        raise HTTPException(404, "剧本不存在")
    path = ROOT / "data" / "library" / f"{lid}.json"
    if not path.exists():
        if lid.startswith("corpus-"):
            library_detail(lid, request)  # Preserve cross-market 404 behavior.
            raise HTTPException(405, "采集参考资料不能在剧本库中删除")
        raise HTTPException(404, "剧本不存在")
    item = normalize_item(json.load(open(path, encoding="utf-8")))
    if normalize_market(item.get("market")) != site_market_for_request(request):
        raise HTTPException(404, "当前站点找不到该剧本")
    path.unlink()
    return {"ok": True}


def _library_parse_save(text: str, fallback_title: str = "导入剧本", kind: str = "reference",
                        source: str = "导入", market: str = "china", locale: str = "zh-CN",
                        content_type: str = "short_drama") -> dict:
    """解析剧本文本（MD 结构：标题/题材/主角/热点标签/大纲/正文）并入库，供单条导入与文件批量导入共用"""
    import re
    # 匹配标题：## 标题 或 # 标题
    title_match = re.search(r"^#+\s+(.*)", text, re.MULTILINE)
    title = title_match.group(1).strip() if title_match else fallback_title

    # 匹配题材：- **题材**：... 或 - genre: ...（冒号后 [ \t]* 防跨行捕获）
    genre_match = re.search(r"[-*]\s*\*\*?(?:题材|ジャンル|Genre|genre)\*\*?[:：][ \t]*(.*)", text)
    genre = genre_match.group(1).strip() if genre_match else loc.default_genre(normalize_locale(locale, market), market)

    # 匹配主角：- **主角**：...（值为空时不吃换行）
    hero_match = re.search(r"[-*]\s*\*\*?(?:主角|主人公|Hero|hero)\*\*?[:：][ \t]*(.*)", text)
    hero = hero_match.group(1).strip() if hero_match else ""

    # 匹配热点标签：- **热点标签**：... 或 - hot_tags: ...
    hot_tags_match = re.search(r"[-*]\s*\*\*?(热点标签|hot_tags)\*\*?[:：][ \t]*(.*)", text)
    hot_tags = []
    if hot_tags_match:
        hot_tags = [t.strip() for t in re.split(r"[,，、]", hot_tags_match.group(2)) if t.strip()]

    # 匹配大纲：- **大纲**：... 或 "### 大纲" 下的内容
    outline = ""
    outline_section = re.search(r"###\s*(?:大纲|あらすじ|Outline)\s*([\s\S]*?)(?=###|$)", text, re.IGNORECASE)
    if outline_section:
        outline = outline_section.group(1).strip()

    # 剧本正文：全文保留
    script = text

    lid = str(uuid.uuid4())[:8]
    lib_dir = ROOT / "data" / "library"
    lib_dir.mkdir(exist_ok=True)
    item = LibraryItem(
        id=lid,
        title=title,
        kind=kind,
        source=source,
        genre=genre,
        hero=hero,
        hot_tags=hot_tags,
        outline=outline,
        script=script,
        created_at=time.time(),
        updated_at=time.time(), market=normalize_market(market),
        locale=normalize_locale(locale, market), content_type=normalize_content_type(content_type)
    )
    with open(lib_dir / f"{lid}.json", "w", encoding="utf-8") as f:
        json.dump(item.model_dump(), f, ensure_ascii=False, indent=2)
    return {"id": lid, "title": title, "genre": genre, "hero": hero, "hot_tags": hot_tags}


@app.post("/api/library/import")
async def library_import(request: Request, body: dict = None):
    """导入剧本到本地库，借鉴corpus_import的解析逻辑，支持MD格式导入剧本"""
    text = (body or {}).get("text", "")
    body = dict(body or {})
    body["market"] = resolve_site_market(request)  # 站点强制归属
    return {"ok": True, **_library_parse_save(text, market=body["market"],
                                                  locale=normalize_locale(body.get("locale"), body["market"]),
                                                  content_type=body.get("content_type", "short_drama"))}


def _sync_library_from_graph() -> dict:
    """把知识图谱里全部 drama（剧本/剧集）实体同步入参考剧本库（按 source_id 幂等去重）。
    script 字段存图谱资料卡（logline+钩子+反转+节拍+金句），非伪造正文。"""
    graph_path = ROOT / "data" / "graph.json"
    if not graph_path.exists():
        return {"added": 0, "skipped": 0, "total": 0, "message": "图谱文件不存在"}
    try:
        g = json.loads(graph_path.read_text(encoding="utf-8"))
    except Exception as e:
        return {"added": 0, "skipped": 0, "total": 0, "message": f"图谱解析失败：{e}"}

    lib_dir = ROOT / "data" / "library"
    lib_dir.mkdir(exist_ok=True)
    have = set()
    for f in lib_dir.glob("*.json"):
        try:
            it = json.load(open(f, encoding="utf-8"))
            if it.get("source_id"):
                have.add(it["source_id"])
        except Exception:
            continue

    added = 0
    for ent in g.get("entities", []):
        if ent.get("type") != "drama":
            continue
        eid = str(ent.get("id") or "")
        if not eid or eid in have:
            continue
        have.add(eid)
        props = ent.get("props") or {}
        logline = str(props.get("logline") or "")
        hook = str(props.get("hook") or "")
        reversal = str(props.get("reversal") or "")
        beats = [str(b) for b in (props.get("beats") or [])]
        golds = [str(x) for x in (props.get("golden_lines") or [])]
        tags = [str(t) for t in (props.get("tags") or [])]
        heat = props.get("heat") or ""
        genre = str(props.get("genre") or "")
        ent_market = normalize_market(props.get("market") or ent.get("market") or "china")

        # 资料卡文本（作为参考资料而非正文）
        parts = [f"【图谱资料卡】《{ent.get('name', '')}》"]
        if logline:
            parts.append(f"一句话故事：{logline}")
        if hook:
            parts.append(f"开场钩子：{hook}")
        if reversal:
            parts.append(f"关键反转：{reversal}")
        if beats:
            parts.append("节拍结构：" + " → ".join(beats))
        if golds:
            parts.append("金句桥段：" + "；".join(golds))
        if heat != "":
            parts.append(f"热度：{heat}")
        script_card = "\n".join(parts)

        hot_tags = tags or ([t.strip() for t in genre.split("/") if t.strip()])
        lid = str(uuid.uuid4())[:8]
        item = LibraryItem(
            id=lid, title=str(ent.get("name") or "未命名剧本"), kind="reference",
            source="知识图谱", source_id=eid, genre=genre,
            outline=logline, script=script_card, hot_tags=hot_tags,
            created_at=time.time(), updated_at=time.time(),
            market=ent_market,
            locale="ja-JP" if ent_market == "japan" else "zh-CN",
        )
        with open(lib_dir / f"{lid}.json", "w", encoding="utf-8") as f:
            json.dump(item.model_dump(), f, ensure_ascii=False, indent=2)
        added += 1
    return {"added": added, "skipped": len([e for e in g.get("entities", []) if e.get("type") == "drama"]) - added,
            "total": len([e for e in g.get("entities", []) if e.get("type") == "drama"])}


@app.post("/api/library/sync_graph")
def library_sync_graph():
    """手动触发：从知识图谱同步剧本实体入参考剧本库（幂等）"""
    r = _sync_library_from_graph()
    return {"ok": True, **r}


# ============ 资源库中心：文件批量导入（拖拽/多文件，仿知识导入页面） ============

def _parse_inspiration_cards(text: str, fallback_title: str, fname_is_csv: bool = False) -> list[dict]:
    """解析导入的灵感文件：JSON 数组 / {cards:[...]} / Markdown「## 标题」分块（块内 题材:/简介:/钩子:/标签: 字段行）"""
    import re
    text = text.strip()
    if not text:
        return []
    # ① JSON 格式
    if text[0] in "[{":
        try:
            data = json.loads(text)
            raw = data.get("cards", []) if isinstance(data, dict) else data
            out = []
            for c in (raw if isinstance(raw, list) else []):
                if not isinstance(c, dict):
                    continue
                hook = c.get("open_hook") or {}
                if isinstance(hook, str):
                    hook = {"text": hook[:80], "from": "导入", "mechanism": "", "intensity": 3}
                out.append({
                    "title": c.get("title") or "", "genre": c.get("genre") or "",
                    "author": c.get("author") or "", "platform": c.get("platform") or "",
                    "heat": c.get("heat") or 0,
                    "logline": c.get("logline") or c.get("intro") or c.get("简介") or "",
                    "open_hook": hook, "beats": c.get("beats") or [], "tags": c.get("tags") or [],
                    "golden_lines": c.get("golden_lines") or [], "emotion": c.get("emotion") or "",
                    "mechanism": c.get("mechanism") or (hook or {}).get("mechanism") or "",
                    "source_url": c.get("source_url") or "",
                })
            return [c for c in out if c["title"]]
        except Exception:
            pass
    # ② CSV（含表头：标题/title,题材/genre,简介/logline,钩子/hook,标签/tags,作者,平台,热度）
    first_line = text.splitlines()[0] if text.splitlines() else ""
    if fname_is_csv or ("," in first_line and any(k in first_line.lower() for k in ("标题", "title", "题材", "genre"))):
        import csv as _csv
        import io as _io
        out = []
        try:
            rows = list(_csv.DictReader(_io.StringIO(text)))
        except Exception:
            rows = []
        for row in rows:
            row = { (k or "").strip().lower(): (v or "").strip() for k, v in row.items() }
            title = row.get("标题") or row.get("title") or ""
            if not title:
                continue
            hook_text = row.get("钩子") or row.get("hook") or row.get("开场钩子") or ""
            tags = [t.strip() for t in re.split(r"[,，、]", row.get("标签") or row.get("tags") or "") if t.strip()]
            out.append({
                "title": title,
                "genre": row.get("题材") or row.get("genre") or "",
                "author": row.get("作者") or row.get("author") or "",
                "platform": row.get("平台") or row.get("platform") or "",
                "logline": row.get("简介") or row.get("logline") or row.get("一句话") or "",
                "open_hook": {"text": hook_text[:80], "from": "导入", "mechanism": "", "intensity": 3} if hook_text else None,
                "tags": tags, "beats": [], "golden_lines": [],
            })
        if out:
            return out
    # ③ Markdown / 纯文本分块
    cards = []

    def _field(body, *names):
        for n in names:
            m = re.search(rf"[-*]?\s*\**{n}\**[:：]\s*(.*)", body)
            if m and m.group(1).strip():
                return m.group(1).strip()
        return ""

    for b in re.split(r"^##+\s*", text, flags=re.MULTILINE):
        b = b.strip()
        if not b:
            continue
        lines = b.splitlines()
        title = lines[0].strip().lstrip("#").strip()
        body = "\n".join(lines[1:]).strip()
        genre = _field(body, "题材", "genre")
        logline = _field(body, "简介", "一句话", "logline", "创意", "梗概")
        hook_text = _field(body, "钩子", "开场钩子", "hook")
        tags_raw = _field(body, "标签", "tags")
        tags = [t.strip() for t in re.split(r"[,，、]", tags_raw) if t.strip()]
        cards.append({
            "title": title or fallback_title, "genre": genre,
            "logline": logline or body[:200],
            "open_hook": {"text": hook_text[:80], "from": "导入", "mechanism": "", "intensity": 3} if hook_text else None,
            "tags": tags, "beats": [], "golden_lines": [],
        })
    return cards


@app.post("/api/hub/import")
async def hub_import(request: Request, files: list[UploadFile] = File(...), target: str = Form("script"), market: str = Form("china"), locale: str = Form(""), content_type: str = Form("")):
    """资源库中心批量导入：target=script 剧本文件(.txt/.md)；target=inspiration 灵感文件(.json/.md/.txt)"""
    site_market = site_market_for_request(request)
    if market and normalize_market(market) != site_market:
        raise HTTPException(403, "当前站点不允许写入另一市场")
    market = site_market
    results = []
    for f in files:
        fname = f.filename or "未命名"
        fallback = Path(fname).stem or "导入内容"
        try:
            raw = await f.read()
            text = raw.decode("utf-8", "replace")
            if not text.strip():
                results.append({"file": fname, "ok": False, "error": "文件为空"})
                continue
            if target == "inspiration":
                cards = _parse_inspiration_cards(text, fallback, fname_is_csv=fname.lower().endswith(".csv"))
                if not cards:
                    results.append({"file": fname, "ok": False, "error": "未解析出有效灵感条目"})
                    continue
                for card in cards:
                    card["market"] = normalize_market(market)
                    card["locale"] = normalize_locale(locale, market)
                    card["content_type"] = normalize_content_type(content_type or "inspiration")
                    card["source_type"] = "manual"
                r = kb_daily.append_inspirations(cards)
                results.append({"file": fname, "ok": True, "title": fallback,
                                "message": f"新增 {r['added']} 条灵感（重复跳过 {r['skipped']}）"})
            else:
                r = _library_parse_save(text, fallback_title=fallback, market=market, locale=locale or normalize_locale("", market), content_type=content_type or "short_drama")
                results.append({"file": fname, "ok": True, "id": r["id"], "title": r["title"],
                                "message": f"已入库《{r['title']}》"})
        except Exception as e:
            results.append({"file": fname, "ok": False, "error": str(e)})
    return {"ok": True, "target": target, "market": normalize_market(market), "results": results}


# ============ 新增：Trae 对接 · AI 编剧 端点 ============
class WriterTask(BaseModel):
    idea: str
    genre: str = "逆袭/战神"
    hero: str = ""
    episodes: int = 10
    first_half: int = 5
    hot_tags: list[str] = []
    market: str = "china"
    output_locale: str = "zh-CN"
    content_type: str = "short_drama"


@app.get("/api/writer/status")
def writer_status():
    """Trae调用状态：引擎连通性、模型、双引擎就绪状态"""
    return {
        "ok": True,
        "connected": bool(llm_mod.API_KEY),
        "model": llm_mod.MODEL or "未配置",
        "engine": "Trae Agent · 双引擎（主流水线 + 两段式续写）",
        "kb_items": len(get_kb().items)
    }


@app.post("/api/writer/tasks")
async def writer_create_task(request: Request, req: WriterTask):
    """创建编剧任务，启动阶段一生成前半部分"""
    req.market = resolve_site_market(request)  # 站点强制归属
    if "output_locale" not in req.model_fields_set or not req.output_locale:
        req.output_locale = normalize_locale(None, req.market)
    if "genre" not in req.model_fields_set or not req.genre:
        req.genre = loc.default_genre(req.output_locale, req.market)
    import threading
    from agent.serial import run_continuation
    tid = str(uuid.uuid4())[:8]
    task_dir = ROOT / "data" / "writer_tasks"
    task_dir.mkdir(exist_ok=True)
    
    # 初始化任务数据
    task = {
        "tid": tid,
        "stage": "stage1",
        "status": "running",
        "created_at": time.time(),
        "updated_at": time.time(),
        "events": [],
        "agg": {},
        "cont": {},
        "req": req.model_dump()
    }
    
    async def emit(event: dict):
        """事件推送函数，保存到任务（流水线要求 async emit）"""
        task["events"].append(event)
        task["updated_at"] = time.time()
        with open(task_dir / f"{tid}.json", "w", encoding="utf-8") as f:
            json.dump(task, f, ensure_ascii=False)
    
    # 阶段一：运行主流水线生成前半部分
    async def run_stage1():
        try:
            await run_pipeline(req.model_dump(), emit)
            # 阶段一完成：从事件流聚合结构化成品（与 agent_bridge._aggregate 同构）
            import re as _re
            nodes = {}
            for ev in task["events"]:
                if ev.get("status") == "done" and isinstance(ev.get("data"), dict):
                    nodes[ev["node"]] = ev["data"]
            parsed = nodes.get("parse_idea", {})
            qc, rf = nodes.get("quality_check", {}), nodes.get("refine", {})
            logline = str(parsed.get("logline", "") or "")
            title = _re.split(r"[，。,.;；!！?？\n]", logline)[0].strip()[:24] if logline else ""
            script_final = rf.get("text") or nodes.get("script", {}).get("text", "")
            score = rf.get("after_score", rf.get("before_score", qc.get("score")))
            agg = {
                "title": title or req.idea[:24],
                "story": req.idea,
                "hero": req.hero,
                "genre": req.genre,
                "outline_text": nodes.get("outline", {}).get("text", ""),
                "ep1_script": script_final,
                "ep1_qc": {
                    "score": score,
                    "pass": bool(qc.get("pass", True)) and (score is None or score >= 80),
                    "summary": rf.get("after_summary", qc.get("summary", "")),
                    "rules_detail": qc.get("checks", []),
                    "llm_review": qc.get("llm_review"),
                }
            }
            task["agg"] = agg
            # 自动入库生成剧本库（kind=generated），后续续写更新同一条目
            try:
                lib_dir = ROOT / "data" / "library"
                lib_dir.mkdir(exist_ok=True)
                lib_item = LibraryItem(
                    id=str(uuid.uuid4())[:8], title=agg["title"], kind="generated",
                    source="AI 编剧", genre=req.genre, hero=req.hero, hot_tags=req.hot_tags,
                    outline=agg["outline_text"], script=script_final,
                    created_at=time.time(), updated_at=time.time(),
                    market=normalize_market(req.market), locale=normalize_locale(req.output_locale, req.market),
                    content_type=normalize_content_type(req.content_type),
                    title_original=agg["title"],
                    title_localized={normalize_locale(req.output_locale, req.market): agg["title"]},
                    synopsis_localized={normalize_locale(req.output_locale, req.market): agg["story"]},
                    script_locale=normalize_locale(req.output_locale, req.market),
                )
                with open(lib_dir / f"{lib_item.id}.json", "w", encoding="utf-8") as f:
                    json.dump(lib_item.model_dump(), f, ensure_ascii=False, indent=2)
                task["lib_id"] = lib_item.id
            except Exception:
                pass
            task["stage"] = "stage_done"
            task["status"] = "completed"
            await emit({"node": "_stage_done", "status": "done"})
        except Exception as e:
            task["stage"] = "error"
            task["status"] = "error"
            task["error"] = str(e)
            await emit({"node": "_error", "status": "error", "data": {"message": str(e)}})
        finally:
            task["updated_at"] = time.time()
            with open(task_dir / f"{tid}.json", "w", encoding="utf-8") as f:
                json.dump(task, f, ensure_ascii=False)
    
    # 后台线程运行
    threading.Thread(target=lambda: asyncio.run(run_stage1()), daemon=True).start()
    
    # 保存任务
    with open(task_dir / f"{tid}.json", "w", encoding="utf-8") as f:
        json.dump(task, f, ensure_ascii=False)
    
    return {"ok": True, "tid": tid, "stage": "stage1"}


@app.post("/api/writer/import")
async def writer_import(request: Request, body: dict = None):
    """导入已有成品剧本 → 解析后直接进入满意度确认（可续写）"""
    body = dict(body or {})
    body["market"] = resolve_site_market(request)  # 站点强制归属
    text = (body or {}).get("text", "").strip()
    try:
        target = min(max(int((body or {}).get("target", 10) or 10), 2), 50)
    except (TypeError, ValueError):
        target = 10
    if not text:
        raise HTTPException(400, "缺少剧本文本")
    tid = str(uuid.uuid4())[:8]
    task_dir = ROOT / "data" / "writer_tasks"
    task_dir.mkdir(exist_ok=True)

    # 解析MD格式（与 library_import 同源）：标题/题材/主角/一句话故事/热点标签/第1集/后续走向
    # 图谱资料卡识别（库「加载」/复制粘贴会把资料卡文本放进导入框）：资料卡是参考资料
    # （一句话故事/开场钩子/反转/节拍），不是剧本正文，绝不能当第1集
    card_fields = re.findall(r"(?:一句话故事|开场钩子|关键反转|节拍结构|金句桥段|热度)[:：]", text)
    is_card = text.lstrip().startswith("【图谱资料卡】") or ("###" not in text and len(card_fields) >= 2)

    title_match = re.search(r"^#+\s*(.*)", text, re.MULTILINE)
    title = title_match.group(1).strip() if title_match else ""
    if not title:
        tm0 = re.search(r"《(.+?)》", text[:200])  # 无 MD 标题（如图谱资料卡）：从首部《书名》提取
        title = tm0.group(1) if tm0 else "导入剧本"
    tm = re.search(r"《(.+?)》", title)
    if tm:
        title = tm.group(1)
    title = re.sub(r"^\d+\s*", "", title).strip() or "导入剧本"

    # 注意：冒号后用 [ \t]* 而非 \s*，防止值为空时 \s 跨过换行捕获下一行
    genre_match = re.search(r"[-*]\s*\*\*?(?:题材|ジャンル|Genre|genre)\*\*?[:：][ \t]*(.*)", text)
    genre = genre_match.group(1).split("·")[0].strip() if genre_match else loc.default_genre(normalize_locale(body.get("output_locale"), body["market"]), body["market"])

    hero_match = re.search(r"[-*]\s*\*\*?(?:主角|主人公|Hero|hero)\*\*?[:：][ \t]*(.*)", text)
    hero = hero_match.group(1).strip() if hero_match else ""
    if not hero:
        hm = re.search(r"\*\*([^*，。]{2,10})\*\*，\s*\d+\s*岁", text)
        hero = hm.group(1).strip() if hm else ""

    story_match = re.search(r"[-*]\s*\*\*?(?:一句话故事|ログライン|Logline|logline)\*\*?[:：][ \t]*(.*)", text) \
        or (re.search(r"一句话故事[:：][ \t]*(.*)", text) if is_card else None)
    story = story_match.group(1).strip() if story_match else text[:80]
    if is_card and len(story) > 120:
        story = story[:120] + "…"  # 资料卡的一句话故事可能整段塞进行内，截断防污染上下文

    hot_tags_match = re.search(r"[-*]\s*\*\*?(热点标签|hot_tags)\*\*?[:：][ \t]*(.*)", text)
    hot_tags = [t.strip() for t in re.split(r"[,，、]", hot_tags_match.group(2)) if t.strip()] if hot_tags_match else []

    # 剧情资料段（图谱资料卡注入的参考资料）：单独提取，续写时进上下文而非当正文
    card = ""
    m_card = re.search(r"###\s*(?:剧情资料|参考資料|Reference notes)[^\n]*\n?([\s\S]*?)(?=###|$)", text)
    if m_card:
        card = m_card.group(1).strip()
    if is_card and not card:
        # 整段资料卡文本（无 ### 结构）：去掉卡片头，全部作为剧情资料
        card = re.sub(r"^\s*【图谱资料卡】[^\n]*\n?", "", text).strip()

    # —— 剧集拆分：优先「—— 第 N 集 ——」分隔线（多集成品/库条目回导），其次「### 第 N 集」标题 ——
    eps = []  # [{no, text}] 按集号排序
    dparts = re.split(r"[ \t]*——[ \t]*第\s*(\d+)\s*[集話章][ \t]*——[ \t]*", text)
    if len(dparts) >= 3:
        head = dparts[0].strip()
        for i in range(1, len(dparts) - 1, 2):
            seg = dparts[i + 1].strip()
            if seg:
                eps.append({"no": int(dparts[i]), "text": seg})
        if head and not any(e["no"] == 1 for e in eps):
            # 分隔线前的内容为第1集原稿（库条目格式）；若内嵌「### 第 1 集」标题则只取标题后正文
            m1 = re.search(r"###\s*第\s*1\s*[集話章]\s*([\s\S]*)", head)
            ep1_text = (m1.group(1) if m1 else head).strip()
            if ep1_text:
                eps.append({"no": 1, "text": ep1_text})
    if not eps:
        for m in re.finditer(r"###\s*第\s*(\d+)\s*[集話章]\s*\n?([\s\S]*?)(?=###|$)", text):
            seg = m.group(2).strip()
            if seg:
                eps.append({"no": int(m.group(1)), "text": seg})
    eps.sort(key=lambda e: e["no"])

    ep1 = ""
    cont_eps = []  # 第2集及以后：预填为已有成品分集（任务直接进入可加集状态）
    if eps:
        for e in eps:
            if e["no"] == 1:
                ep1 = e["text"]
            else:
                cont_eps.append({"no": e["no"], "text": e["text"], "score": None})
    elif "###" in text:
        ep1 = ""  # 结构化导入但无第1集正文（如图谱资料卡条目）：续写时从第1集整剧生成
    else:
        ep1 = "" if is_card else text  # 资料卡不当第1集正文；普通纯文本粘贴：全文即第1集

    outline = ""
    for pat in (r"###\s*(?:后续走向|今後の展開|Future outline)[^\n]*\n?([\s\S]*?)(?=###|$)", r"###\s*(?:大纲|あらすじ|Outline)\s*([\s\S]*?)(?=###|$)"):
        m = re.search(pat, text)
        if m:
            outline = m.group(1).strip()
            break

    agg = {
        "title": title,
        "story": story,
        "hero": hero,
        "genre": genre,
        "outline_text": (story + ("\n" + outline if outline else "")).strip(),
        "ep1_script": ep1,
    }
    if card:
        agg["card"] = card
    # 拆出多集时直接预填为已有成品（stage=done），续写时从最后一集+1 加集
    cont = {}
    stage = "stage_done"
    if cont_eps:
        cont = {"episodes": cont_eps, "outline_ext": "",
                "target": max(target, cont_eps[-1]["no"])}
        stage = "done"
    task = {
        "tid": tid, "stage": stage, "status": "completed",
        "created_at": time.time(), "updated_at": time.time(),
        "events": [], "agg": agg, "cont": cont,
        "req": {"idea": story, "genre": genre, "hero": hero,
                "episodes": target, "first_half": 1, "hot_tags": hot_tags,
                "market": str((body or {}).get("market") or "china"),
                "output_locale": str((body or {}).get("output_locale") or ""),
                "content_type": str((body or {}).get("content_type") or "short_drama")}
    }
    with open(task_dir / f"{tid}.json", "w", encoding="utf-8") as f:
        json.dump(task, f, ensure_ascii=False)
    return {"ok": True, "tid": tid, "agg": agg, "target": target,
            "stage": stage, "episodes": cont_eps}


@app.get("/api/writer/tasks")
def writer_list_tasks(request: Request):
    market = resolve_site_market(request)
    """历史任务列表：按更新时间倒序，供前端「历史任务」面板载入/继续"""
    task_dir = ROOT / "data" / "writer_tasks"
    items = []
    if task_dir.exists():
        for p in task_dir.glob("*.json"):
            try:
                t = json.load(open(p, encoding="utf-8"))
            except Exception:
                continue
            if not t.get("tid"):
                continue  # 旧格式任务文件无 tid，前端无法载入，不在列表展示
            agg = t.get("agg") or {}
            req = t.get("req") or {}
            cont_eps = [e for e in (t.get("cont") or {}).get("episodes", [])
                        if isinstance(e, dict) and e.get("text")]
            # 第1集可能在大纲锚点重生成时进入 episodes（与 agg.ep1_script 互斥，避免重复计数）
            if any(e.get("no") == 1 for e in cont_eps):
                eps_done = len(cont_eps)
            else:
                eps_done = (1 if agg.get("ep1_script") else 0) + len(cont_eps)
            t_mkt = normalize_market(req.get("market"))
            if market and t_mkt != normalize_market(market):
                continue
            items.append({
                "tid": t.get("tid"),
                "title": agg.get("title") or (req.get("idea", "") or "")[:20] or "未命名任务",
                "genre": agg.get("genre") or req.get("genre", ""),
                "source": t.get("source", ""),
                "stage": t.get("stage"),
                "status": t.get("status"),
                "market": t_mkt,
                "target": req.get("episodes", 10),
                "eps_done": eps_done,
                "created_at": t.get("created_at"),
                "updated_at": t.get("updated_at"),
                "running": t.get("status") == "running",
            })
    items.sort(key=lambda x: x.get("updated_at") or 0, reverse=True)
    return {"ok": True, "items": items}


@app.get("/api/writer/tasks/{tid}")
def writer_get_task(request: Request, tid: str):
    """获取任务详情"""
    path = ROOT / "data" / "writer_tasks" / f"{tid}.json"
    if not path.exists():
        raise HTTPException(404, "任务不存在")
    t = json.load(open(path, encoding="utf-8"))
    deny_cross_market((t.get("req") or {}).get("market", "china"), resolve_site_market(request))
    return t


@app.post("/api/writer/tasks/{tid}/continue")
async def writer_continue_task(request: Request, tid: str, body: dict):
    """任务续接：stage_done 从第2集续写；done 加集 / suspended 挂起续跑 / error 重试（从已有最后一集+1 接续）"""
    import threading
    from agent.serial import run_continuation
    path = ROOT / "data" / "writer_tasks" / f"{tid}.json"
    if not path.exists():
        raise HTTPException(404, "任务不存在")
    _t = json.load(open(path, encoding="utf-8"))
    deny_cross_market((_t.get("req") or {}).get("market", "china"), resolve_site_market(request))
    task = json.load(open(path, encoding="utf-8"))
    if task.get("status") == "running":
        raise HTTPException(400, "任务正在生成中，请等待完成后再续写")

    # done 加集 / suspended 挂起续跑 / error 重试：已有集数均参与续写（从最后一集的下一集接续）
    old_eps = []
    if task["stage"] == "done" or task.get("status") in ("suspended", "error"):
        old_eps = [e for e in (task.get("cont") or {}).get("episodes", [])
                   if isinstance(e, dict) and e.get("text")]

    # 续接参数与锚点：outline=只保留大纲从第1集重新生成 / script=只保留第1集剧本 /
    # both=大纲+第1集全保留接着续写（默认）
    anchor = body.get("anchor", "both")
    note = body.get("note", "")
    try:
        target = min(max(int(body.get("target") or 10), 2), 50)
    except (TypeError, ValueError):
        target = 10

    agg = task.get("agg") or {}
    if old_eps:
        start_ep = old_eps[-1].get("no", 1) + 1  # 加集续写
    elif anchor == "outline":
        start_ep = 1  # 只保留大纲：丢弃第1集剧本，整剧重新生成
    elif agg.get("ep1_script"):
        start_ep = 2  # 保留第1集剧本：从第2集续写
    else:
        start_ep = 1  # 无第1集成品（如图谱资料卡条目）：整剧从第1集生成
    if target < start_ep:
        raise HTTPException(400, f"目标集数需大于当前已有 {start_ep - 1} 集，请调高目标集数")
    task["stage"] = "stage2"
    task["status"] = "running"
    task["updated_at"] = time.time()

    # 上下文：基于前半部分的agg；加集续写带上最后一集结尾，保证剧情无缝衔接
    last_ep = old_eps[-1] if old_eps else None
    ctx = {
        "title": agg.get("title", ""),
        "story": agg.get("story", ""),
        "hero": agg.get("hero", ""),
        "genre": agg.get("genre", ""),
        "ep1_script": agg.get("ep1_script", ""),
        # 大纲 = 前半段 agg 大纲 + 已有续写的 outline_ext（断点续跑/加集不重新生成旧集大纲）
        "outline_text": "\n".join(filter(None, [
            agg.get("outline_text", ""), (task.get("cont") or {}).get("outline_ext", "")])),
        "card": agg.get("card", ""),
        "target": target,
        "note": note,
        "hot_tags": task["req"].get("hot_tags", []),
        "start_ep": start_ep,
        # 三字段贯穿续写链路：日本任务 stage2 续写继续输出自然日语，不回落中文规则
        "market": task["req"].get("market", "china"),
        "output_locale": task["req"].get("output_locale", "zh-CN"),
        "content_type": task["req"].get("content_type", "short_drama"),
    }
    if not old_eps and anchor == "outline":
        ctx["ep1_script"] = ""  # 只保留大纲：第1集剧本不进上下文（第1集将重新生成）
    elif not old_eps and anchor == "script":
        ctx["outline_text"] = ""  # 只保留第1集剧本：大纲不进上下文（剧情由续写引擎重新编排）
    if last_ep:
        ctx["prev_tail"] = (last_ep.get("text") or "")[-300:]

    async def emit(event: dict):
        """事件推送，保存到任务（续写引擎要求 async emit）"""
        task["events"].append(event)
        task["updated_at"] = time.time()
        with open(path, "w", encoding="utf-8") as f:
            json.dump(task, f, ensure_ascii=False)

    # 阶段二：续写后续集数（done 加集 / 挂起续跑，新增集数与旧集合并，成品始终完整）
    async def run_stage2():
        cont = {}
        try:
            cont = await run_continuation(ctx, emit)
            # 只保留有效集（限流挂起时已完成的集也一并保存）
            new_eps = [e for e in (cont.get("episodes") or [])
                       if isinstance(e, dict) and e.get("text")]
            task["cont"] = {"episodes": old_eps + new_eps,
                            "outline_ext": _merge_outline_ext(task, cont),
                            "target": target}
            # 续写完成后更新生成剧本库条目：解析已有分集段落，按集号替换合并，避免重复追加
            if task.get("lib_id") and new_eps:
                try:
                    lib_path = ROOT / "data" / "library" / f"{task['lib_id']}.json"
                    if lib_path.exists():
                        lib_item = json.load(open(lib_path, encoding="utf-8"))
                        script_old = (lib_item.get("script") or "").strip()
                        segs = re.split(r"[ \t]*——[ \t]*第\s*(\d+)\s*[集話章][ \t]*——[ \t]*", script_old)
                        exist = {}
                        head = ""
                        if len(segs) >= 3:
                            head = segs[0].strip()
                            for i in range(1, len(segs) - 1, 2):
                                seg = segs[i + 1].strip()
                                if seg:
                                    exist[int(segs[i])] = seg
                        else:
                            head = script_old  # 无分隔线：整段即第1集原稿
                        if head and 1 not in exist:
                            exist[1] = head
                        for ep in old_eps + new_eps:
                            no, seg = ep.get("no"), (ep.get("text") or "").strip()
                            if no and seg:
                                exist[int(no)] = seg
                        # 重拼：第1集原稿保持在开头（不带分隔线），其余各集按集号排序
                        e1 = exist.pop(1, "")
                        parts = ([e1] if e1 else []) + [
                            f"—— 第 {no} 集 ——\n{exist[no]}" for no in sorted(exist)
                        ]
                        lib_item["script"] = "\n\n".join(parts)
                        lib_item["updated_at"] = time.time()
                        with open(lib_path, "w", encoding="utf-8") as f:
                            json.dump(lib_item, f, ensure_ascii=False, indent=2)
                except Exception:
                    pass
            if cont.get("suspended"):
                # D: LLM 限流 → 任务挂起（已完成集已保存），等自动续跑或用户手动续写
                at_ep = cont.get("suspended_at", start_ep)
                task["stage"] = "stage2"
                task["status"] = "suspended"
                task["suspended"] = {
                    "at_ep": at_ep, "target": target, "reason": "llm_rate_limited",
                    "msg": f"第{at_ep}集生成时遭遇 LLM 限流(429)，已完成 {len(old_eps) + len(new_eps)} 集并保存"}
            else:
                task.pop("suspended", None)
                task["stage"] = "done"
                task["status"] = "completed"
                await emit({"node": "_done", "status": "done",
                            "data": {"count": len(old_eps) + len(new_eps), "target": target}})
        except Exception as e:
            # 抢救异常前已完成的集数（partial 结果落盘，error 状态仍可重试续写）
            rescued = [x for x in (cont.get("episodes") or [])
                       if isinstance(x, dict) and x.get("text")]
            if rescued or cont.get("outline_ext"):
                task["cont"] = {"episodes": old_eps + rescued,
                                "outline_ext": _merge_outline_ext(task, cont),
                                "target": target}
            task["stage"] = "done" if (old_eps or rescued) else "error"
            task["status"] = "error"  # 必须显式置 error，否则停在 running 永久阻塞续写
            task["error"] = str(e)
            await emit({"node": "_error", "status": "error", "data": {"message": str(e)}})
        finally:
            task["updated_at"] = time.time()
            with open(path, "w", encoding="utf-8") as f:
                json.dump(task, f, ensure_ascii=False)

    # 后台线程运行
    threading.Thread(target=lambda: asyncio.run(run_stage2()), daemon=True).start()

    return {"ok": True, "tid": tid, "stage": "stage2", "start_ep": start_ep}


# ================= 系统级 =================
@app.get("/api/stats")
async def api_stats(request: Request):
    """系统级统计（按当前站点市场过滤）：语料规模/图谱质量/钩子队列/调度器状态"""
    market = resolve_site_market(request)
    kb = get_kb()
    kb_items = [it for it in kb.items if (not market) or normalize_market(it.get("market")) == market]
    hl = hooks_mod.list_hooks(market=market)
    g = graph_mod.get_graph()
    q = g.quality(market=market)
    return {
        "corpus": {"count": len(kb_items), "live_meta": kb.live_meta, "market": market},
        "graph": q,
        "hooks": {"total": hl["count"],
                  "pending": sum(1 for h in hl["items"] if h["status"] == "pending"),
                  "approved": sum(1 for h in hl["items"] if h["status"] == "approved")},
        "scheduler": scheduler.status(),
        "sla_targets": {"graph_accuracy_min": 95, "relation_complete_min": 98,
                        "query_ms_max": 300, "ui_ms_max": 100, "refresh_hours_max": 24},
    }


@app.post("/api/refresh")
async def api_refresh():
    """数据新鲜度：手动触发 采集→重建→增量抽取（≤24h 更新频率保障）"""
    result = await asyncio.to_thread(scheduler.refresh_now, "manual_api")
    return result


@app.get("/api/extensions")
def api_extensions():
    """扩展接口位清单：PlatformAdapter（采集源）/ ExportAPI（导出）/ scheduler.register_extension"""
    from agent import collector
    return {"platform_adapters": sorted(collector._ADAPTERS.keys()) if hasattr(collector, "_ADAPTERS") else ["hongguo"],
            "scheduler_hooks": scheduler.list_extensions(),
            "export_api": "/api/export/{kind}（语料/图谱/钩子/模板）"}


# ================= 每日知识更新（kb_daily） =================
class KbUpdateReq(BaseModel):
    wait: bool = False
    polish_limit: int = 8
    extract_limit: int = 15
    use_llm: bool = True
    market: str = "all"   # all 全量 / china 中国源 / japan 日本源（分市场更新）


@app.post("/api/kb/update")
async def api_kb_update(request: Request, req: KbUpdateReq):
    req.market = resolve_site_market(request)  # 站点强制：日本站只更新日本库，中国站只更新中国库
    """触发每日知识更新完整管线：归档旧版图谱 → 采集 → 深加工 → 抽取去重入库 → 灵感库重建 → 校验

    market=japan/china 时按市场分别运行（只采集对应市场源，其它市场语料保留）。
    默认后台执行立即返回（用 GET /api/kb/status 轮询）；wait=true 时阻塞等待完成。
    """
    if req.wait:
        rep = await asyncio.to_thread(
            kb_daily.run_daily_update, "manual_api", req.polish_limit, req.extract_limit,
            req.use_llm, req.market)
        if rep.get("ok"):
            _sync_library_from_graph()  # 图谱更新后同步剧本实体入库
        return {"ok": bool(rep.get("ok")), "report": rep}
    if kb_daily.status()["running"]:
        return {"ok": False, "msg": "已有更新任务进行中", "status_url": "/api/kb/status"}

    def _run_and_sync():
        rep = kb_daily.run_daily_update("manual_api", req.polish_limit, req.extract_limit,
                                        req.use_llm, req.market)
        if rep.get("ok"):
            _sync_library_from_graph()
    threading.Thread(target=_run_and_sync, daemon=True).start()
    return {"ok": True, "msg": "每日知识更新已启动", "status_url": "/api/kb/status"}


@app.get("/api/kb/status")
async def api_kb_status():
    """每日更新运行状态（轮询用）+ 调度器状态"""
    return {"kb": kb_daily.status(), "scheduler": scheduler.status()}


@app.get("/api/kb/runs")
def api_kb_runs(limit: int = 30):
    """历史运行报告列表（摘要）"""
    return kb_daily.list_runs(limit)


@app.get("/api/kb/runs/{run_id}")
def api_kb_run(run_id: str):
    """单次运行完整报告"""
    rep = kb_daily.get_run(run_id)
    if not rep:
        raise HTTPException(404, "运行报告不存在")
    return rep


@app.get("/api/kb/archive")
def api_kb_archive():
    """知识图谱旧版归档列表"""
    return kb_daily.list_archive()


@app.get("/api/kb/archive/{run_id}")
def api_kb_archive_overview(run_id: str, limit: int = 300):
    """读取旧版图谱（与 /api/graph 同构，前端画布直接渲染）"""
    data = kb_daily.archive_overview(run_id, limit)
    if not data:
        raise HTTPException(404, "归档版本不存在")
    return data


# ================= 灵感库（每日管线全量重建，不保留旧版本） =================
@app.get("/api/inspirations")
def api_inspirations(request: Request, q: str = None):
    """灵感库全部内容（q 为可选关键词过滤）"""
    return kb_daily.list_inspirations(q, market=resolve_site_market(request))


@app.post("/api/inspirations/rebuild")
async def api_inspirations_rebuild(request: Request):
    """手动重建灵感库（仅当前站点市场；基于当前知识库热门语料 + 已通过钩子库）"""
    mk = resolve_site_market(request)
    result = await asyncio.to_thread(kb_daily.rebuild_inspirations, mk)
    return {"ok": True, "results": {mk: result}}


app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8765, log_level="info")
