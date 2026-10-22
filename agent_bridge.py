# -*- coding: utf-8 -*-
"""闪剧工厂 × AI 编剧 Agent —— 对接桥（Trae 方案落地层）

把 duanju-agent 的 8 节点生成流水线包装为「创作工作台」Web 服务，
并打通「成品一键写入闪剧工厂」闭环：

  GET  /                            创作工作台 UI（平台内「🤖 AI 编剧」按钮打开）
  GET  /api/agent/status            引擎 / 语料库 / 平台连通状态
  POST /api/agent/tasks             提交创意任务（后台线程跑 pipeline，实时 emit 进度）
  GET  /api/agent/tasks             历史任务列表
  GET  /api/agent/tasks/{id}        轮询单任务进度与结果
  POST /api/agent/tasks/{id}/push   成品写入闪剧工厂（创建项目 + 分集剧本 + 简介）

启动：python agent_bridge.py   （监听 127.0.0.1:5680）
"""
import asyncio
import json
import re
import sys
import threading
import urllib.request
import uuid
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from agent import pipeline as pipeline_mod, llm
from agent.knowledge import get_kb

PLATFORM_BASE = "http://127.0.0.1:5679"
TASKS_DIR = ROOT / "agent_tasks"
TASKS_DIR.mkdir(exist_ok=True)

app = FastAPI(title="duanju-agent-bridge", docs_url=None, redoc_url=None)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)

TASKS: dict = {}


# ============================ 工具 ============================

def _api(method: str, path: str, payload=None, timeout: int = 15):
    """调用闪剧工厂平台 API（响应包裹 {success, data}）。"""
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(
        f"{PLATFORM_BASE}{path}", data=data, method=method,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = json.loads(r.read().decode("utf-8"))
    if body.get("success") is False:
        raise RuntimeError(f"平台错误 {body.get('error')}")
    return body


def _save_task(t: dict):
    try:
        (TASKS_DIR / f"{t['id']}.json").write_text(
            json.dumps(t, ensure_ascii=False), encoding="utf-8"
        )
    except Exception:
        pass


def _load_tasks_from_disk():
    for p in sorted(TASKS_DIR.glob("t*.json")):
        try:
            t = json.loads(p.read_text(encoding="utf-8"))
            TASKS.setdefault(t["id"], t)
        except Exception:
            pass


_load_tasks_from_disk()  # 启动时恢复历史任务


def _make_title(parsed: dict, idea: str) -> str:
    """从 logline 取首个分句作为剧名（贴近短剧命名习惯）。"""
    raw = (parsed.get("logline") or idea or "未命名短剧").strip()
    seg = re.split(r"[，。,.;；!！?？\n]", raw)[0].strip()
    return (seg or raw)[:24]


def _aggregate(t: dict) -> dict:
    """事件流 → 结构化成品（与 mcp_server.generate_script 同构）。"""
    nodes = {}
    for ev in t["events"]:
        if ev.get("status") == "done" and isinstance(ev.get("data"), dict):
            nodes[ev["node"]] = ev["data"]
    parsed = nodes.get("parse_idea", {})
    qc, rf = nodes.get("quality_check", {}), nodes.get("refine", {})
    req = t["req"]
    return {
        "title": _make_title(parsed, req.get("idea", "")),
        "meta": {
            "idea": req.get("idea", ""),
            **{k: parsed.get(k) for k in ("logline", "genre", "hero", "conflict", "selling_point")},
            "episodes": req.get("episodes", 12),
        },
        "outline": nodes.get("outline", {}).get("text", ""),
        "script_raw": nodes.get("script", {}).get("text", ""),
        "script_final": rf.get("text") or nodes.get("script", {}).get("text", ""),
        "quality": {
            "before_score": rf.get("before_score", qc.get("score")),
            "before_summary": rf.get("before_summary", qc.get("summary", "")),
            "after_score": rf.get("after_score"),
            "after_summary": rf.get("after_summary", ""),
            "rules_detail": qc.get("checks", []),
            "llm_review": qc.get("llm_review"),
        },
        "refine_changes": rf.get("changes", []),
        "scenes": nodes.get("scenes", {}).get("scenes", []),
        "storyboard": nodes.get("storyboard", {}).get("shots", []),
    }


def _run_task(tid: str):
    """后台线程：独立事件循环跑 8 节点 pipeline，emit 事件实时进任务状态。"""
    t = TASKS[tid]
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    async def emit(ev: dict):
        t["events"].append(ev)
        slot = t["nodes"].setdefault(ev.get("node", "?"), {"status": "running", "data": None})
        slot["status"] = ev.get("status")
        if ev.get("status") == "done" and isinstance(ev.get("data"), dict):
            slot["data"] = ev["data"]
        _save_task(t)

    async def job():
        try:
            await pipeline_mod.run_pipeline(dict(t["req"]), emit)
            t["result"] = _aggregate(t)
            t["status"] = "done"
        except Exception as e:  # 任何节点崩溃都不该让工作台黑屏
            t["status"] = "error"
            t["error"] = f"{type(e).__name__}: {e}"
        _save_task(t)

    try:
        loop.run_until_complete(job())
    finally:
        loop.close()


# ============================ API 层 ============================

class TaskReq(BaseModel):
    idea: str
    genre: str = "逆袭/战神"
    hero: str = ""
    episodes: int = 12


@app.get("/api/agent/status")
async def agent_status():
    platform = {"ok": False, "error": None, "dramas": 0}
    try:
        r = _api("GET", "/api/v1/dramas")
        data = r.get("data")
        if isinstance(data, dict):  # 平台列表返回 {items: [...]}
            data = data.get("items") or []
        platform["ok"] = True
        platform["dramas"] = len(data) if isinstance(data, list) else 0
    except Exception as e:
        platform["error"] = f"{type(e).__name__}"
    try:
        kb = get_kb()
        kb_info = {"items": len(kb.items), "meta": kb.live_meta if isinstance(kb.live_meta, (str, dict)) else ""}
    except Exception:
        kb_info = {"items": 0, "meta": ""}
    return {
        "success": True,
        "data": {
            "agent": {
                "engine": llm.MODEL,
                "api_key_set": bool(llm.API_KEY),
                "tasks_total": len(TASKS),
                "running": sum(1 for x in TASKS.values() if x.get("status") == "running"),
            },
            "kb": kb_info,
            "platform": platform,
        },
    }


@app.post("/api/agent/tasks")
async def create_task(req: TaskReq):
    if not req.idea.strip():
        raise HTTPException(400, "创意不能为空")
    tid = f"t{datetime.now():%Y%m%d_%H%M%S}_{uuid.uuid4().hex[:4]}"
    t = {
        "id": tid, "created_at": datetime.now().isoformat(timespec="seconds"),
        "req": req.model_dump(), "status": "running",
        "events": [], "nodes": {}, "result": None, "error": None, "push": None,
    }
    TASKS[tid] = t
    _save_task(t)
    threading.Thread(target=_run_task, args=(tid,), daemon=True).start()
    return {"success": True, "data": {"id": tid}}


@app.get("/api/agent/tasks")
async def list_tasks():
    items = sorted(TASKS.values(), key=lambda x: x.get("created_at", ""), reverse=True)
    return {"success": True, "data": [
        {
            "id": x["id"], "created_at": x.get("created_at"), "status": x.get("status"),
            "idea": (x.get("req") or {}).get("idea", ""),
            "title": (x.get("result") or {}).get("title"),
            "pushed": bool(x.get("push")),
        } for x in items
    ]}


@app.get("/api/agent/tasks/{tid}")
async def get_task(tid: str):
    t = TASKS.get(tid)
    if t is None:
        p = TASKS_DIR / f"{tid}.json"
        if p.exists():
            t = json.loads(p.read_text(encoding="utf-8"))
            TASKS[tid] = t
    if t is None:
        raise HTTPException(404, "任务不存在")
    return {"success": True, "data": t}


@app.post("/api/agent/tasks/{tid}/push")
async def push_task(tid: str):
    t = TASKS.get(tid)
    if t is None:
        p = TASKS_DIR / f"{tid}.json"
        if p.exists():
            t = json.loads(p.read_text(encoding="utf-8"))
            TASKS[tid] = t
    if not t:
        raise HTTPException(404, "任务不存在")
    if t.get("status") != "done" or not t.get("result"):
        raise HTTPException(400, "任务尚未完成，无法写入平台")
    if t.get("push"):
        return {"success": True, "data": t["push"]}

    res = t["result"]
    meta = res.get("meta", {})
    title, outline = res.get("title", "未命名短剧"), res.get("outline", "")

    # 1) 创建短剧项目
    created = _api("POST", "/api/v1/dramas", {
        "title": title,
        "description": meta.get("logline", ""),
        "genre": meta.get("genre", "短剧"),
        "style": "竖屏短剧",
        "metadata": {
            "source": "duanju-agent-bridge",
            "agent_task_id": tid,
            "quality_after_score": res.get("quality", {}).get("after_score"),
        },
    })
    drama_id = (created.get("data") or {}).get("id")

    # 2) 分集：大纲逐行 → 各集简介；第1集带成品剧本正文
    eps = []
    for line in outline.splitlines():
        m = re.match(r"\s*第(\d+)集", line)
        if not m:
            continue
        num = int(m.group(1))
        eps.append({
            "episode_number": num,
            "title": line.strip()[:60],
            "description": line.strip(),
            "script_content": res.get("script_final") if num == 1 else None,
            "duration": 120 if num == 1 else 90,
        })
    if not eps:
        eps = [{
            "episode_number": 1, "title": title,
            "description": meta.get("logline", ""),
            "script_content": res.get("script_final"), "duration": 120,
        }]
    _api("PUT", f"/api/v1/dramas/{drama_id}/episodes", {"episodes": eps})

    # 3) 简介与元信息（大纲全文存 metadata.outline_text）
    _api("PUT", f"/api/v1/dramas/{drama_id}/outline", {
        "title": title,
        "summary": meta.get("logline", ""),
        "genre": meta.get("genre", "短剧"),
        "tags": [meta.get("genre", "短剧"), "AI编剧"],
        "style": "竖屏短剧",
        "metadata": {
            "source": "duanju-agent-bridge",
            "agent_task_id": tid,
            "outline_text": outline,
            "quality": {
                "before_score": res.get("quality", {}).get("before_score"),
                "after_score": res.get("quality", {}).get("after_score"),
            },
        },
    })

    t["push"] = {
        "drama_id": drama_id, "title": title, "episodes": len(eps),
        "pushed_at": datetime.now().isoformat(timespec="seconds"),
        "platform_url": f"{PLATFORM_BASE}/",
    }
    _save_task(t)
    return {"success": True, "data": t["push"]}


# ============================ 工作台 UI ============================

HTML_PAGE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>闪剧工厂 × AI 编剧工作台</title>
<style>
:root{
  --bg:#0b0e14; --card:#141926; --card2:#1a2032; --line:#252d42;
  --tx:#e8ecf4; --tx2:#8b94ab; --gold:#f0b429; --gold2:#ffd76a;
  --green:#3dd68c; --red:#ff5d6c; --blue:#5aa7ff;
}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--tx);
  font-family:"Microsoft YaHei","PingFang SC",system-ui,sans-serif;
  min-height:100vh;
  background-image:radial-gradient(900px 400px at 15% -10%,rgba(240,180,41,.08),transparent),
                   radial-gradient(800px 400px at 90% 0%,rgba(255,93,108,.06),transparent);}
.wrap{max-width:1180px;margin:0 auto;padding:28px 24px 60px}
header{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:14px;margin-bottom:22px}
.brand h1{font-size:24px;font-weight:800;letter-spacing:.5px;
  background:linear-gradient(90deg,var(--gold2),#ff9d5c);-webkit-background-clip:text;background-clip:text;color:transparent}
.brand p{color:var(--tx2);font-size:12.5px;margin-top:4px}
.chips{display:flex;gap:8px;flex-wrap:wrap}
.chip{display:flex;align-items:center;gap:7px;background:var(--card);border:1px solid var(--line);
  border-radius:99px;padding:6px 13px;font-size:12px;color:var(--tx2)}
.dot{width:7px;height:7px;border-radius:50%;background:#555}
.dot.on{background:var(--green);box-shadow:0 0 8px var(--green)}
.dot.off{background:var(--red)}
.grid{display:grid;grid-template-columns:360px 1fr;gap:16px}
@media(max-width:900px){.grid{grid-template-columns:1fr}}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px}
.card h3{font-size:14.5px;margin-bottom:14px;display:flex;align-items:center;gap:8px}
.card h3 .tag{font-size:11px;color:var(--tx2);font-weight:400;margin-left:auto}
label{display:block;font-size:12px;color:var(--tx2);margin:12px 0 6px}
textarea,input[type=text],input[type=number],select{width:100%;background:var(--card2);border:1px solid var(--line);
  border-radius:9px;color:var(--tx);padding:10px 12px;font-size:13.5px;font-family:inherit;outline:none;transition:border .2s}
textarea{min-height:96px;resize:vertical;line-height:1.6}
textarea:focus,input:focus,select:focus{border-color:var(--gold)}
.row2{display:flex;gap:10px}.row2>div{flex:1}
.btn{width:100%;margin-top:18px;padding:12px;border:none;border-radius:10px;cursor:pointer;
  font-size:14.5px;font-weight:700;font-family:inherit;color:#1a1200;
  background:linear-gradient(90deg,var(--gold),var(--gold2));transition:transform .15s,box-shadow .2s}
.btn:hover{transform:translateY(-1px);box-shadow:0 6px 20px rgba(240,180,41,.35)}
.btn:disabled{opacity:.5;cursor:not-allowed;transform:none}
.btn.ghost{background:var(--card2);color:var(--tx);border:1px solid var(--line);font-weight:500}
.nodes{display:flex;flex-direction:column;gap:4px}
.node{display:flex;align-items:center;gap:12px;padding:8px 10px;border-radius:9px;transition:background .3s}
.node.running{background:rgba(240,180,41,.07)}
.node .idx{width:26px;height:26px;border-radius:50%;border:1.5px solid var(--line);color:var(--tx2);
  display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0}
.node.done .idx{border-color:var(--green);color:var(--green)}
.node.running .idx{border-color:var(--gold);color:var(--gold)}
.node .nm{font-size:13.5px;font-weight:600;width:76px}
.node .ds{font-size:12px;color:var(--tx2);flex:1}
.node .st{font-size:12px;color:var(--tx2);width:52px;text-align:right}
.node.done .st{color:var(--green)}
.node.running .st{color:var(--gold)}
.spin{display:inline-block;width:12px;height:12px;border:2px solid rgba(240,180,41,.25);
  border-top-color:var(--gold);border-radius:50%;animation:sp .8s linear infinite;vertical-align:-2px}
@keyframes sp{to{transform:rotate(360deg)}}
.log{margin-top:14px;background:#0a0d13;border:1px solid var(--line);border-radius:9px;
  padding:10px 12px;height:110px;overflow-y:auto;font:11.5px/1.8 Consolas,monospace;color:var(--tx2)}
.log b{color:var(--gold);font-weight:600}
.pill{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;padding:3px 10px;border-radius:99px;
  border:1px solid var(--line);color:var(--tx2)}
.pill.run{color:var(--gold);border-color:rgba(240,180,41,.4)}
.pill.ok{color:var(--green);border-color:rgba(61,214,140,.4)}
.pill.err{color:var(--red);border-color:rgba(255,93,108,.4)}
.tabs{display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap}
.tab{padding:7px 16px;border-radius:9px;background:var(--card2);border:1px solid var(--line);
  color:var(--tx2);font-size:13px;cursor:pointer;transition:all .2s}
.tab.on{background:rgba(240,180,41,.12);border-color:rgba(240,180,41,.5);color:var(--gold2)}
.pane{display:none}.pane.on{display:block}
pre.body{white-space:pre-wrap;font:13.5px/1.9 "Microsoft YaHei",monospace;color:var(--tx)}
.score-hero{display:flex;align-items:center;gap:18px;margin-bottom:16px}
.sc{font-size:38px;font-weight:800}.sc small{font-size:12px;color:var(--tx2);font-weight:400;display:block;margin-top:2px}
.sc.before{color:var(--tx2)}.sc.after{color:var(--green)}
.arrow{font-size:22px;color:var(--gold)}
.bars{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin:14px 0}
.bar{background:var(--card2);border:1px solid var(--line);border-radius:9px;padding:10px 12px}
.bar .t{display:flex;justify-content:space-between;font-size:12px;color:var(--tx2);margin-bottom:7px}
.bar .t b{color:var(--tx);font-size:13px}
.bar .tr{height:6px;background:#0a0d13;border-radius:4px;overflow:hidden}
.bar .fi{height:100%;border-radius:4px;background:linear-gradient(90deg,var(--gold),var(--gold2));transition:width .8s}
.issue{background:var(--card2);border:1px solid var(--line);border-left:3px solid var(--gold);
  border-radius:8px;padding:10px 14px;margin-bottom:8px;font-size:12.5px;line-height:1.8}
.issue .q{color:var(--gold2)}
.chk{display:flex;gap:8px;align-items:baseline;padding:6px 0;border-bottom:1px dashed var(--line);font-size:12.5px}
.chk .ok{color:var(--green)}.chk .bad{color:var(--red)}
table{width:100%;border-collapse:collapse;font-size:12.5px}
th{background:var(--card2);color:var(--tx2);text-align:left;padding:8px 10px;font-weight:600}
td{padding:8px 10px;border-top:1px solid var(--line);vertical-align:top;line-height:1.6}
.pushbar{display:flex;align-items:center;gap:14px;margin-top:18px;flex-wrap:wrap}
.pushbar .btn{width:auto;margin:0;padding:11px 26px}
.banner{flex:1;min-width:260px;border-radius:10px;padding:11px 16px;font-size:13px;line-height:1.7}
.banner.ok{background:rgba(61,214,140,.1);border:1px solid rgba(61,214,140,.35);color:var(--green)}
.banner.err{background:rgba(255,93,108,.08);border:1px solid rgba(255,93,108,.35);color:var(--red)}
.empty{color:var(--tx2);font-size:13px;text-align:center;padding:46px 0}
.hist{font-size:12px;color:var(--tx2)}
.hist select{margin-top:6px;font-size:12px;padding:7px 10px}
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="brand">
      <h1>⚡ 闪剧工厂 × AI 编剧工作台</h1>
      <p>Trae 方案 · duanju-agent 全链路产能引擎 —— 创意进，成品出，一键入库</p>
    </div>
    <div class="chips">
      <div class="chip"><span class="dot" id="dot-engine"></span><span id="chip-engine">引擎检测中…</span></div>
      <div class="chip"><span class="dot" id="dot-kb"></span><span id="chip-kb">语料库…</span></div>
      <div class="chip"><span class="dot" id="dot-platform"></span><span id="chip-platform">闪剧工厂…</span></div>
    </div>
  </header>

  <div class="grid">
    <div>
      <div class="card">
        <h3>🎬 提交创意 <span class="tag">8 节点全自动</span></h3>
        <label>一句话创意 *</label>
        <textarea id="idea" placeholder="例：外卖小哥雨夜救下落难老太太，对方竟递来一张刻着仇人姓氏的黑色银行卡…"></textarea>
        <div class="row2">
          <div><label>题材</label>
            <select id="genre">
              <option>逆袭/战神</option><option>赘婿</option><option>闪婚</option>
              <option>萌宝</option><option>重生</option><option>穿越</option>
              <option>复仇</option><option>都市</option>
            </select></div>
          <div><label>规划集数</label>
            <input type="number" id="episodes" value="12" min="4" max="80"></div>
        </div>
        <label>主角名（留空自动）</label>
        <input type="text" id="hero" placeholder="例：周野">
        <button class="btn" id="btn-go" onclick="submitTask()">⚡ 开始生成（约 1-3 分钟）</button>
      </div>
      <div class="card" style="margin-top:16px">
        <h3>🗂 历史任务</h3>
        <div class="hist" id="hist-box">暂无任务</div>
      </div>
    </div>

    <div class="card">
      <h3>🧠 生成流水线 <span class="pill" id="pipe-pill">待命</span></h3>
      <div class="nodes" id="nodes"></div>
      <div class="log" id="log"><div>// 实时事件日志 —— 提交创意后此处滚动输出每个节点的进度</div></div>
    </div>
  </div>

  <div class="card" style="margin-top:16px">
    <h3>📦 成品交付 <span class="tag" id="deliv-tag">质检达标后可一键写入闪剧工厂</span></h3>
    <div class="tabs" id="tabs">
      <div class="tab on" data-t="outline">大纲</div>
      <div class="tab" data-t="script">第1集剧本</div>
      <div class="tab" data-t="quality">质检报告</div>
      <div class="tab" data-t="scenes">分场</div>
      <div class="tab" data-t="storyboard">分镜</div>
    </div>
    <div id="panes">
      <div class="pane on" data-t="outline"><div class="empty">等待生成…</div></div>
      <div class="pane" data-t="script"><div class="empty">等待生成…</div></div>
      <div class="pane" data-t="quality"><div class="empty">等待生成…</div></div>
      <div class="pane" data-t="scenes"><div class="empty">等待生成…</div></div>
      <div class="pane" data-t="storyboard"><div class="empty">等待生成…</div></div>
    </div>
    <div class="pushbar" id="pushbar" style="display:none">
      <button class="btn" id="btn-push" onclick="pushToPlatform()">📤 一键写入闪剧工厂</button>
      <div id="push-result" style="flex:1"></div>
    </div>
  </div>
</div>

<script>
const NODES=[
 ["parse_idea","创意解析","提取题材/主角/核心冲突"],
 ["kb_search","知识检索","爆款语料召回 + 节拍模板"],
 ["outline","剧集大纲","逐集梗概 + 钩子设计"],
 ["script","第1集剧本","场次 + 台词 + 情绪节拍"],
 ["quality_check","内容质检","规则 8 项 + 爆款潜力分"],
 ["refine","精修改写","去 AI 味 / 口语化 / 补钩子"],
 ["scenes","分场拆解","结构化场景表"],
 ["storyboard","分镜脚本","景别 / 运镜 / 时长 / 音效"]];
const DIMS={hook:"钩子强度",cool:"爽点密度",pacing:"节奏张力",paywall:"付费卡点",emotion:"情绪共鸣"};
let curId=null,timer=null,seenEv=0;

function esc(s){return (s==null?"":String(s)).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")}
function $id(x){return document.getElementById(x)}

async function init(){
  renderNodes({});
  try{
    const r=await fetch("/api/agent/status").then(r=>r.json());
    const d=r.data;
    $id("chip-engine").textContent="引擎 "+(d.agent.engine||"");
    $id("dot-engine").className="dot "+(d.agent.api_key_set?"on":"off");
    $id("chip-kb").textContent="语料 "+d.kb.items+" 条";
    $id("dot-kb").className="dot "+(d.kb.items>0?"on":"off");
    $id("chip-platform").textContent="闪剧工厂 "+(d.platform.ok?("已连接 · "+d.platform.dramas+" 个项目"):"未启动");
    $id("dot-platform").className="dot "+(d.platform.ok?"on":"off");
  }catch(e){$id("chip-engine").textContent="工作台异常"}
  loadHistory();
}

function renderNodes(nodes){
  $id("nodes").innerHTML=NODES.map((n,i)=>{
    const st=(nodes[n[0]]||{}).status||"pending";
    const ic=st==="done"?"✓":(st==="running"?'<span class="spin"></span>':i+1);
    const stTx=st==="done"?"完成":(st==="running"?"进行中":"排队");
    return `<div class="node ${st}" id="nd-${n[0]}"><div class="idx">${ic}</div><div class="nm">${n[1]}</div><div class="ds">${n[2]}</div><div class="st">${stTx}</div></div>`;
  }).join("");
}

function logLine(ev){
  const box=$id("log");
  const t=new Date().toTimeString().slice(0,8);
  const nm=(NODES.find(n=>n[0]===ev.node)||[ev.node,ev.node])[1];
  const line=document.createElement("div");
  line.innerHTML=`[${t}] <b>${esc(nm)}</b> ${ev.status==="running"?"开始处理…":"✓ 完成"}`;
  box.appendChild(line);box.scrollTop=box.scrollHeight;
}

async function submitTask(){
  const idea=$id("idea").value.trim();
  if(!idea){$id("idea").focus();return}
  $id("btn-go").disabled=true;$id("btn-go").textContent="⏳ 任务提交中…";
  try{
    const r=await fetch("/api/agent/tasks",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({idea,genre:$id("genre").value,hero:$id("hero").value.trim(),episodes:+$id("episodes").value||12})
    }).then(r=>r.json());
    if(!r.success)throw new Error(r.detail||"提交失败");
    curId=r.data.id;seenEv=0;
    $id("log").innerHTML="";$id("pushbar").style.display="none";$id("push-result").innerHTML="";
    renderNodes({});setPill("run","生成中");
    ["outline","script","quality","scenes","storyboard"].forEach(k=>pane(k,'<div class="empty">等待生成…</div>'));
    timer=setInterval(poll,1200);poll();
  }catch(e){alert("提交失败："+e.message)}
  finally{$id("btn-go").disabled=false;$id("btn-go").textContent="⚡ 开始生成（约 1-3 分钟）"}
}

async function poll(){
  if(!curId)return;
  try{
    const r=await fetch("/api/agent/tasks/"+curId).then(r=>r.json());
    if(!r.success)return;
    const t=r.data;
    const evs=t.events||[];
    for(;seenEv<evs.length;seenEv++)logLine(evs[seenEv]);
    renderNodes(t.nodes||{});
    if(t.status==="done"){clearInterval(timer);setPill("ok","已完成");renderResult(t.result)}
    else if(t.status==="error"){clearInterval(timer);setPill("err","失败");pane("outline",`<div class="banner err">生成失败：${esc(t.error)}</div>`)}
  }catch(e){}
}

function setPill(cls,tx){const p=$id("pipe-pill");p.className="pill "+cls;p.textContent=tx}

function pane(k,html){const p=document.querySelector(`.pane[data-t="${k}"]`);if(p)p.innerHTML=html}

function renderResult(res){
  if(!res)return;
  pane("outline",`<div style="margin-bottom:10px;font-size:13px;color:var(--tx2)">《${esc(res.title)}》· ${esc(res.meta.logline||"")} · 规划 ${res.meta.episodes} 集</div><pre class="body">${esc(res.outline)}</pre>`);
  pane("script",`<pre class="body">${esc(res.script_final)}</pre>`);
  pane("quality",renderQuality(res.quality));
  pane("scenes",res.scenes&&res.scenes.length?`<table><tr><th>#</th><th>场景</th><th>时间</th><th>人物</th><th>概要</th></tr>${res.scenes.map(s=>`<tr><td>${esc(s.no)}</td><td>${esc(s.location)}</td><td>${esc(s.time)}</td><td>${esc((s.characters||[]).join("、"))}</td><td>${esc(s.summary)}</td></tr>`).join("")}</table>`:'<div class="empty">无</div>');
  pane("storyboard",res.storyboard&&res.storyboard.length?`<table><tr><th>#</th><th>景别</th><th>运镜</th><th>时长</th><th>画面</th><th>台词</th><th>声音</th></tr>${res.storyboard.map(s=>`<tr><td>${esc(s.no)}</td><td>${esc(s.type)}</td><td>${esc(s.camera)}</td><td>${esc(s.duration)}</td><td>${esc(s.desc)}</td><td>${esc(s.line)}</td><td>${esc(s.sound)}</td></tr>`).join("")}</table>`:'<div class="empty">无</div>');
  $id("pushbar").style.display="flex";
  $id("btn-push").disabled=false;$id("btn-push").textContent="📤 一键写入闪剧工厂";
}

function renderQuality(q){
  if(!q)return'<div class="empty">无</div>';
  const before=q.before_score??"-",after=q.after_score??"-";
  const allPass=after>=80;
  let h=`<div class="score-hero">
    <div class="sc before">${before}<small>精修前（规则分）</small></div><div class="arrow">➜</div>
    <div class="sc after">${after}<small>精修后（规则分）</small></div>
    <span class="pill ${allPass?"ok":"err"}">${allPass?"✓ 达到交付标准（≥80）":"未达 80，建议再精修一轮"}</span></div>`;
  const lr=q.llm_review;
  if(lr&&lr.potential){
    const p=lr.potential;
    h+=`<div style="font-size:13px;margin-top:6px">LLM 爆款潜力 <b style="color:var(--gold2)">${p.score}</b> 分 —— ${esc(p.verdict||"")}</div>`;
    h+=`<div class="bars">${Object.keys(DIMS).map(k=>`<div class="bar"><div class="t"><span>${DIMS[k]}</span><b>${p[k]??"-"}</b></div><div class="tr"><div class="fi" style="width:${p[k]||0}%"></div></div></div>`).join("")}</div>`;
  }
  if(lr&&lr.ai_flavor&&lr.ai_flavor.issues&&lr.ai_flavor.issues.length){
    h+=`<div style="font-size:13px;margin:10px 0 8px">隐性 AI 味（${esc(lr.ai_flavor.level)}）· 精修已自动修复</div>`;
    h+=lr.ai_flavor.issues.map(i=>`<div class="issue">「<span class="q">${esc(i.quote)}</span>」<br>为何像 AI：${esc(i.why)}<br>改法：${esc(i.fix)}</div>`).join("");
  }
  if(q.rules_detail&&q.rules_detail.length){
    h+=`<div style="font-size:13px;margin:12px 0 4px">规则质检 8 项明细</div>`;
    h+=q.rules_detail.map(c=>`<div class="chk"><span class="${c.pass?"ok":"bad"}">${c.pass?"✓":"✗"}</span><b>${esc(c.name)}</b><span style="color:var(--tx2)">${esc(c.detail||"")}</span></div>`).join("");
  }
  if(q.after_summary)h+=`<div style="margin-top:12px;font-size:12.5px;color:var(--tx2)">精修复检：${esc(q.after_summary)}</div>`;
  return h;
}

async function pushToPlatform(){
  if(!curId)return;
  $id("btn-push").disabled=true;$id("btn-push").textContent="⏳ 写入中…";
  try{
    const r=await fetch(`/api/agent/tasks/${curId}/push`,{method:"POST"}).then(r=>r.json());
    if(!r.success)throw new Error(r.detail||"写入失败");
    const d=r.data;
    $id("push-result").innerHTML=`<div class="banner ok">✅ 已写入闪剧工厂：项目《${esc(d.title)}》（ID ${d.drama_id}，${d.episodes} 集，第 1 集含成品剧本）。回到闪剧工厂「项目列表」即可查看。</div>`;
    loadHistory();init();
  }catch(e){$id("push-result").innerHTML=`<div class="banner err">写入失败：${esc(e.message)}。请确认闪剧工厂已启动（端口 5679）。</div>`}
  finally{$id("btn-push").disabled=false;$id("btn-push").textContent="📤 一键写入闪剧工厂"}
}

async function loadHistory(){
  try{
    const r=await fetch("/api/agent/tasks").then(r=>r.json());
    const items=(r.data||[]).filter(x=>x.status!=="running");
    if(!items.length){$id("hist-box").textContent="暂无任务";return}
    $id("hist-box").innerHTML=`<select onchange="openTask(this.value)">${items.map(x=>`<option value="${x.id}">${esc(x.title||x.idea.slice(0,16))} · ${x.status==="done"?(x.pushed?"已入库":"待写入"):"失败"}</option>`).join("")}</select>`;
  }catch(e){}
}

async function openTask(tid){
  if(!tid)return;
  clearInterval(timer);curId=tid;seenEv=1e9;
  const r=await fetch("/api/agent/tasks/"+tid).then(r=>r.json());
  const t=r.data;
  renderNodes(t.nodes||{});
  $id("log").innerHTML=(t.events||[]).map(ev=>{
    const nm=(NODES.find(n=>n[0]===ev.node)||[ev.node,ev.node])[1];
    return `<div>[回放] <b>${esc(nm)}</b> ${ev.status==="running"?"开始处理…":"✓ 完成"}</div>`;}).join("");
  setPill(t.status==="done"?"ok":(t.status==="error"?"err":"run"),t.status==="done"?"已完成":(t.status==="error"?"失败":"生成中"));
  if(t.result)renderResult(t.result);
  if(t.push)$id("push-result").innerHTML=`<div class="banner ok">✅ 已写入闪剧工厂：项目《${esc(t.push.title)}》（ID ${t.push.drama_id}）</div>`;
  else $id("pushbar").style.display=t.status==="done"?"flex":"none";
}

document.querySelectorAll(".tab").forEach(tb=>tb.addEventListener("click",()=>{
  document.querySelectorAll(".tab").forEach(x=>x.classList.remove("on"));
  document.querySelectorAll(".pane").forEach(x=>x.classList.remove("on"));
  tb.classList.add("on");
  document.querySelector(`.pane[data-t="${tb.dataset.t}"]`).classList.add("on");
}));

init();
</script>
</body>
</html>"""


@app.get("/", response_class=HTMLResponse)
async def index():
    return HTML_PAGE


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=5680, log_level="warning")
