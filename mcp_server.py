# -*- coding: utf-8 -*-
"""短剧产能 MCP Server —— 把 duanju-agent 全链路能力封装为标准 MCP 工具

对标 Codex / WorkBuddy 类 agent 的 skill 能力：任何 MCP 客户端
（Trae / Claude Desktop / Codex CLI / Cline 等）挂载本 server 后，
即可直接调用：语料采集 → BM25 检索 → 剧本生成 → 双层质检 → 精修 → 分场/分镜。

启动方式（stdio）：python mcp_server.py
客户端挂载配置见 docs/04_mcp_server.md
"""
import sys
import builtins
from pathlib import Path

# ---------- stdio 协议保护（必须在导入业务模块之前完成） ----------
# MCP stdio 模式下 stdout 只能承载 JSON-RPC 消息；
# 业务模块（llm/collector 等）内部的 print 必须全部改道 stderr，否则协议崩坏。
_print = builtins.print

def _eprint(*args, **kwargs):
    kwargs.setdefault("file", sys.stderr)
    _print(*args, **kwargs)

builtins.print = _eprint

# Windows 下强制 UTF-8，避免 GBK 文本层毁坏中文剧本
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

sys.path.insert(0, str(Path(__file__).resolve().parent))  # 允许从任意 cwd 启动

from mcp.server.fastmcp import FastMCP  # noqa: E402

from agent import pipeline as pipeline_mod, quality, collector, llm  # noqa: E402
from agent import refine as refine_mod, llm_review as review_mod  # noqa: E402
from agent.knowledge import get_kb, reset_kb  # noqa: E402

mcp = FastMCP(
    "duanju-agent",
    instructions=(
        "短剧全链路产能引擎（红果/晋江爆款语料驱动）。"
        "核心能力：generate_script 一键产出质检达标的第1集成品剧本；"
        "check_script / refine_script 可单独质检或精修任意剧本；"
        "collect_materials / search_materials / beat_template 提供爆款语料与节拍模板。"
    ),
)


# ============================ 工具层 ============================

@mcp.tool()
async def generate_script(idea: str, genre: str = "逆袭/战神", hero: str = "", episodes: int = 12) -> dict:
    """【核心交付】短剧全链路生成：创意 → 大纲 → 第1集剧本 → 双层质检 → 精修复检 → 分场 → 分镜。

    Args:
        idea: 一句话创意，如「豪门弃妇离婚当天被 three 大佬争抢」。
        genre: 题材标签（逆袭/战神、赘婿、闪婚、萌宝、重生、穿越 等）。
        hero: 主角名，留空自动兜底。
        episodes: 规划总集数（大纲展示前 8 集）。

    耗时约 1-3 分钟（8 个 LLM 节点串行）。返回 script_final（精修后成品）、
    quality（质检 before/after 分数 + LLM 潜力五维 + 隐性 AI 味）、
    refine_changes（精修改动明细）、scenes（分场表）、storyboard（分镜脚本）。
    """
    req = {"idea": idea, "genre": genre, "hero": hero, "episodes": episodes}
    events: list[dict] = []

    async def emit(ev: dict):
        events.append(ev)

    await pipeline_mod.run_pipeline(req, emit)

    nodes: dict[str, dict] = {}
    for ev in events:
        if ev.get("status") == "done" and isinstance(ev.get("data"), dict):
            nodes[ev["node"]] = ev["data"]

    qc = nodes.get("quality_check", {})
    rf = nodes.get("refine", {})
    return {
        "meta": {"idea": idea, "genre": genre, "hero": req.get("hero", ""), "episodes": episodes},
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


@mcp.tool()
async def check_script(script: str) -> dict:
    """纯质检（不修改剧本）：规则 8 项 + LLM 爆款潜力分 + 隐性 AI 味定位。

    规则 8 项：模板词/AI味、空话动作、万能旁白、台词书面腔、场次≥3、片尾强钩、前3秒钩子、体量≥300字。
    LLM 层：潜力五维（hook/cool/pacing/paywall/emotion 加权总分）+ 隐性 AI 味逐条（原文引用/为何像AI/改法）。
    LLM 不可用时自动降级纯规则。返回 {score, pass, checks, llm_review}。
    """
    if not script or len(script.strip()) < 50:
        return {"error": "剧本过短（<50 字），无法质检"}
    qc = quality.check_script(script)
    qc["llm_review"] = await review_mod.review(script, {})
    return qc


@mcp.tool()
async def refine_script(script: str, hero: str = "主角", genre: str = "逆袭") -> dict:
    """精修任意已有剧本：先质检拿问题清单 → LLM 改写 + 规则确定性修复 → 复检 before/after 对比。

    修复内容：去模板词/AI味、口语化替换书面词、删万能旁白、补片尾钩子、补场次（不足3场时）。
    返回 script_final（精修后正文）、changes（改动明细）、before_score → after_score。
    """
    if not script or len(script.strip()) < 50:
        return {"error": "剧本过短（<50 字），无法精修"}
    parsed = {"hero": hero, "genre": genre}
    qc = quality.check_script(script)
    qc["llm_review"] = await review_mod.review(script, parsed)
    refined, data = await refine_mod.refine_script(script, parsed, qc)
    data["script_final"] = refined
    return data


@mcp.tool()
def collect_materials() -> dict:
    """采集最新爆款语料并重建知识库：红果短剧榜 + 晋江四榜（总分/月度/季度/半年）。

    去重落盘 data/corpus_live.json，并重建 BM25 索引。耗时约 15-40 秒。
    返回各源采集状态与语料总量；明细条目不回传（落盘后用 search_materials 检索）。
    """
    result = collector.collect()
    result.pop("items", None)  # 800+ 条明细不回传，避免撑爆上下文
    reset_kb()
    result["kb_total"] = len(get_kb().items)
    return result


@mcp.tool()
def search_materials(query: str, top_k: int = 5) -> dict:
    """BM25 检索爆款语料库（800+ 条：红果短剧榜 + 晋江四榜）。

    Args:
        query: 自然语言，题材/桥段/钩子均可，如「重生复仇 打脸 婚礼」。
        top_k: 返回条数（1-10）。

    返回命中条目：片名/题材/热度/钩子/节拍/反转/金句 + 命中依据（_matched）。
    生成剧本前先检索，可把爆款钩子套路注入 prompt。
    """
    hits = get_kb().search(query, top_k=max(1, min(int(top_k), 10)))
    return {"query": query, "count": len(hits), "hits": hits}


@mcp.tool()
def beat_template(genre: str) -> dict:
    """查询题材节拍模板：该题材热度 Top3 语料归纳的常见节拍 + 创作铁律 + 参考片名 + 金句。

    写大纲/剧本前先查询，可对齐该题材观众的预期节奏（如「逆袭」的三段式：受辱→隐忍→打脸）。
    """
    return get_kb().beat_template(genre)


@mcp.tool()
def server_status() -> dict:
    """诊断 server 状态：LLM 模型名、API Key 是否配置、知识库语料条数与更新时间、可用采集源。"""
    kb = get_kb()
    return {
        "server": "duanju-agent",
        "engine": llm.MODEL,
        "api_base": llm.API_BASE,
        "api_key_set": bool(llm.API_KEY),
        "kb_items": len(kb.items),
        "kb_live_meta": kb.live_meta,
        "adapters": sorted(collector._ADAPTERS.keys()),
    }


# ============================ Prompt（skill 流程指引） ============================

@mcp.prompt()
def deliver_short_drama(idea: str) -> str:
    """完整交付一部短剧第1集的工作流指引（对标 agent skill 的流程编排）"""
    return f"""目标：把创意「{idea}」交付为质检达标的短剧第 1 集成品剧本。按以下步骤组合工具：

1. server_status —— 确认 LLM 已配置、语料库就绪（kb_items>0）。
2. beat_template(genre) —— 查该题材节拍模板与创作铁律。
3. search_materials(query=题材关键词) —— 检索同类爆款的钩子/反转/金句作参考。
4. generate_script(idea=...) —— 全链路生成（约 1-3 分钟）。
5. 检查返回的 quality.after_score：≥80 且 after_summary 无未达标项即视为交付级；
   否则把 script_final 交给 refine_script 再打磨一轮。
6. 交付物：script_final 正文（含场次行、台词行、「【钩子】片尾」尾钩）、
   附 scenes 分场表与 storyboard 分镜脚本。

注意：剧本台词须全部口语化；禁止「就在这时/与此同时」式转场；动作必须具体可拍摄。"""


# ============================ 入口 ============================

if __name__ == "__main__":
    mcp.run(transport="stdio")
