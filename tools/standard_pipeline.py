# -*- coding: utf-8 -*-
"""标准化剧本生成与自动评估流水线（可复现 / 可离线复评）

两个子命令：
  gen   全新生成：走真实 HTTP 链路（stage1 前半 + stage2 续写）→ 导出 txt/json → 自动量化评估
  eval  离线复评：对已有导出目录重跑自动评估（不调 LLM，秒级）

用法示例：
  python tools/standard_pipeline.py gen --idea "..." --genre 悬疑 --hero "..." \
      --episodes 4 --first-half 2 --tags 悬疑,温情,反转 --out "导出目录"
  python tools/standard_pipeline.py eval --dir "导出目录"

自动评估评分表（总分 100，≥80 且无硬伤为 PASS）：
  完整性 30：末集收束标记 20 + 每集片尾钩 10
  连贯性 25：规则质检 pass 比例 10 + 复审分均值 15
  一致性 20：角色名报警（单集说话人>6 / 孤立人名）扣分制
  合理性 15：复审 AI 味 issues 计数折算
  表达   10：动作套话/模板词超频扫描扣分制
"""
import argparse
import json
import re
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

from agent.quality import ACTION_CLICHE_WORDS, TEMPLATE_WORDS, check_script  # noqa: E402

# 说话人行：「角色（情绪）：」
SPEAKER_RE = re.compile(r"^([^\s（(：:【】]{1,6})[（(][^）)]*[）)][：:]", re.M)
EP_MARK_RE = re.compile(r"第\s*(\d+)\s*集")
FULL_END_MARK = ("全剧终", "大结局")
TAIL_HOOK_RE = re.compile(r"【钩子】|【尾钩】|钩子[：:]|片尾[：:]")
# 泛称白名单：无姓氏的通用称谓，不可能与主角色名发生别名混淆，不计报警
GENERIC_ROLES = {
    "男人", "女人", "男孩", "女孩", "老人", "老者", "大爷", "大妈", "大婶", "大叔",
    "老板", "老板娘", "店员", "服务员", "司机", "保安", "手下", "路人", "医生", "护士",
    "同学", "老师", "老太太", "老大爷", "侍者", "小哥", "大姐", "大哥", "阿姨", "顾客",
    "警察", "医生", "中介", "房东", "同事", "领导", "客户", "乘客",
}


# ---------------- 导出与自动评估 ----------------

def collect_episodes(out_dir: Path):
    """从导出目录收集 {no: {text, score, pass, review}}（兼容单集 txt / 元数据 json）"""
    eps = {}
    txt_map = {}  # no -> txt 路径（文件名含「第N集」即可，允许任意前缀如「原始生成_」）
    for p in sorted(out_dir.glob("*第*集*.txt")):
        m = EP_MARK_RE.search(p.stem)
        if m:
            txt_map.setdefault(int(m.group(1)), p)
    meta_p = out_dir / "生成元数据.json"
    if meta_p.exists():
        meta = json.load(open(meta_p, encoding="utf-8"))
        for e in meta.get("episodes", []):
            eps[int(e.get("no", 0))] = {"text": e.get("text", ""),
                                        "score": e.get("score"),
                                        "pass": e.get("pass"),
                                        "review": e.get("review") or {}}
    if not eps:  # 无元数据：直接用单集 txt
        for no, p in txt_map.items():
            eps[no] = {"text": p.read_text(encoding="utf-8"),
                       "score": None, "pass": None, "review": {}}
    else:  # 元数据缺正文时用单集 txt 补
        for no, e in eps.items():
            if not (e.get("text") or "").strip() and no in txt_map:
                e["text"] = txt_map[no].read_text(encoding="utf-8")
    return dict(sorted((k, v) for k, v in eps.items() if (v.get("text") or "").strip()))


def speakers_of(text: str):
    return [m.group(1) for m in SPEAKER_RE.finditer(text)]


def evaluate(out_dir: Path) -> dict:
    """量化评估：返回 {score_total, pass, report}"""
    eps = collect_episodes(out_dir)
    if not eps:
        return {"score_total": 0, "pass": False, "report": "未找到任何剧集文本，评估失败"}

    nos = sorted(eps)
    last_no = nos[-1]
    last_text = eps[last_no]["text"]

    # ---- 1 完整性 30：末集收束 20 + 片尾钩 10 ----
    ended = any(m in last_text for m in FULL_END_MARK)
    c_end = 20 if ended else 0
    hook_ok = [1 for n in nos if TAIL_HOOK_RE.search(eps[n]["text"])]
    c_hook = round(10 * len(hook_ok) / len(nos))

    # ---- 2 连贯性 25：规则 pass 比例 10 + 复审均值 15 ----
    scores = [eps[n].get("score") for n in nos if isinstance(eps[n].get("score"), (int, float))]
    rule_pass_ratio = (sum(1 for n in nos if eps[n].get("pass")) / len(nos)) if nos else 0
    c_rule = round(10 * rule_pass_ratio)
    rev_scores = []
    for n in nos:
        rv = eps[n].get("review") or {}
        s = rv.get("score")
        if isinstance(s, (int, float)) and rv.get("potential"):  # ep1 复审结构 {potential:{score}}
            s = rv["potential"].get("score")
        if isinstance(s, (int, float)):
            rev_scores.append(s)
    c_rev = round(15 * (sum(rev_scores) / len(rev_scores) / 100)) if rev_scores else 8  # 无复审给中性分

    # ---- 3 一致性 20：角色名报警（硬报警扣分；软提示仅交终审，不计分） ----
    per_ep_speakers = {n: speakers_of(eps[n]["text"]) for n in nos}
    all_speakers = [s for n in nos for s in per_ep_speakers[n]]
    alarms, soft_notes = [], []
    for n in nos:
        uniq = set(per_ep_speakers[n])
        if len(uniq) > 6:
            alarms.append(f"第{n}集说话人过多（{len(uniq)}人）：{ '、'.join(sorted(uniq)) }")
    from collections import Counter
    cnt = Counter(all_speakers)
    freq = [s for s, c in cnt.items() if c >= 2]
    lonely = [s for s, c in cnt.items() if c == 1 and not s.isdigit() and s not in ("旁白", "画外音")]
    for s in lonely:
        if s in GENERIC_ROLES:
            continue  # 泛称无别名混淆风险
        if any(set(s) & set(f) for f in freq):  # 与常驻角色共享用字 → 疑似简称/别名（硬报警）
            alarms.append(f"孤立人名「{s}」与常驻角色共享用字，疑似别名/误名")
        else:
            soft_notes.append(f"{s}（仅出现1次，疑似一过性配角，终审确认）")
    c_char = max(0, 20 - 5 * len(alarms))

    # ---- 4 合理性 15：复审 AI 味 issues 计数 ----
    issues_n = 0
    for n in nos:
        rv = eps[n].get("review") or {}
        if isinstance(rv.get("ai_issues_n"), (int, float)):
            issues_n += int(rv["ai_issues_n"])
        elif rv.get("ai_flavor", {}).get("issues"):  # ep1 完整结构
            issues_n += len(rv["ai_flavor"]["issues"])
    c_plot = 15 if issues_n == 0 else 11 if issues_n == 1 else 7 if issues_n == 2 else 4

    # ---- 5 表达 10：动作套话 + 模板词（全稿扫描，每词至多1次） ----
    full_text = "\n".join(eps[n]["text"] for n in nos)
    over = {}
    for w in ACTION_CLICHE_WORDS + TEMPLATE_WORDS:
        c = full_text.count(w)
        if c > 1:
            over[w] = c
    c_expr = max(0, 10 - 2 * sum(c - 1 for c in over.values()))

    total = c_end + c_hook + c_rule + c_rev + c_char + c_plot + c_expr
    hard_ok = ended and not alarms
    verdict = "PASS（达到标准化生产标准）" if (total >= 80 and hard_ok) else "FAIL（未达标，需进入修复闭环）"

    # ---- 报告 ----
    lines = [
        "剧本自动量化评估报告",
        f"生成时间：{time.strftime('%Y-%m-%d %H:%M:%S')}    评估对象：{out_dir.name}",
        f"剧集范围：第{nos[0]}集 ~ 第{last_no}集（共{len(nos)}集）",
        "",
        "【评分表】（满分 100）",
        f"  完整性   {c_end + c_hook:3d}/30   末集收束标记：{'有' if ended else '无（硬伤）'}；片尾钩 {len(hook_ok)}/{len(nos)} 集",
        f"  连贯性   {c_rule + c_rev:3d}/25   规则pass比例 {rule_pass_ratio:.0%}；复审均值 {sum(rev_scores)/len(rev_scores):.1f}" if rev_scores else f"  连贯性   {c_rule + c_rev:3d}/25   规则pass比例 {rule_pass_ratio:.0%}；复审缺失",
        f"  一致性   {c_char:3d}/20   角色名报警 {len(alarms)} 项",
        f"  合理性   {c_plot:3d}/15   复审AI味 issues 共 {issues_n} 条",
        f"  表达     {c_expr:3d}/10   超频套话/模板词 {len(over)} 项",
        "",
        f"总分：{total}/100    判定：{verdict}",
        "",
    ]
    if alarms:
        lines.append("【一致性硬报警明细】")
        lines += [f"  - {a}" for a in alarms]
        lines.append("")
    if soft_notes:
        lines.append("【一致性软提示】（不计分，终审确认）")
        lines += [f"  - {s}" for s in soft_notes]
        lines.append("")
    if over:
        lines.append("【超频词明细】（每词至多1次）")
        lines += [f"  - {w}×{c}" for w, c in sorted(over.items(), key=lambda x: -x[1])]
        lines.append("")
    lines.append("【各集概览】")
    for n in nos:
        rv = eps[n].get("review") or {}
        rev_s = rv.get("score") if not rv.get("potential") else rv["potential"].get("score")
        lines.append(f"  第{n}集：规则 {eps[n].get('score', '-')} / 复审 {rev_s if rev_s is not None else '-'}"
                     f" / 说话人 {'、'.join(sorted(set(per_ep_speakers[n]))) or '无'}")
    report = "\n".join(lines)

    (out_dir / "评估报告_自动.txt").write_text(report, encoding="utf-8")
    return {"score_total": total, "pass": total >= 80 and hard_ok, "report": report}


# ---------------- 全新生成（gen 子命令） ----------------

def run_gen(args) -> Path:
    from fastapi.testclient import TestClient
    import main as main_mod

    out_dir = Path(args.out) if args.out else ROOT.parent / "剧本生成评估" / f"标准化回归_{time.strftime('%m%d_%H%M')}"
    out_dir.mkdir(parents=True, exist_ok=True)

    client = TestClient(main_mod.app)

    def wait_terminal(tid: str, timeout: int, since: float, phase: str):
        t0 = time.time()
        while time.time() - t0 < timeout:
            data = client.get(f"/api/writer/tasks/{tid}").json()
            task = data.get("task") or data
            last = task if task.get("status") else (data or {})
            status = last.get("status")
            if status != "running" and last.get("updated_at", 0) > since:
                return task
            time.sleep(3)
        raise TimeoutError(f"{phase} 超时（{timeout}s）")

    # stage1：前半生成
    body = {"idea": args.idea, "genre": args.genre, "hero": args.hero,
            "episodes": args.episodes, "first_half": args.first_half,
            "hot_tags": [t.strip() for t in (args.tags or "").split(",") if t.strip()]}
    since = time.time()
    r = client.post("/api/writer/tasks", json=body)
    r.raise_for_status()
    tid = (r.json().get("task") or r.json()).get("task_id") or (r.json().get("task") or r.json()).get("tid")
    print(f"[gen] stage1 已受理 tid={tid}，等待完成…")
    task = wait_terminal(tid, 600, since, "stage1")
    print(f"[gen] stage1 完成：{task.get('stage')} / {task.get('status')}")

    # stage2：续写到大结局
    since = time.time()
    r = client.post(f"/api/writer/tasks/{tid}/continue", json={"target": args.episodes})
    r.raise_for_status()
    print("[gen] stage2 已受理，等待完成…")
    task = wait_terminal(tid, 1200, since, "stage2")
    if task.get("stage") != "done" or task.get("status") != "completed":
        print(f"[gen] 警告：stage2 终态为 {task.get('stage')}/{task.get('status')}（限流挂起时已完成集仍导出）")

    # 导出
    agg = task.get("agg") or {}
    eps = [e for e in (task.get("cont") or {}).get("episodes", []) if e.get("text")]
    ep1 = {"no": 1, "text": agg.get("ep1_script", ""),
           "score": (agg.get("ep1_qc") or {}).get("score"),
           "pass": (agg.get("ep1_qc") or {}).get("pass"),
           "review": (agg.get("ep1_qc") or {}).get("llm_review") or {}}
    all_eps = ([ep1] if ep1["text"] else []) + \
              [{"no": e.get("no"), "text": e.get("text", ""), "score": e.get("score"),
                "pass": e.get("pass"), "review": e.get("review") or {}} for e in eps]

    meta = {"task_id": tid, "req": body, "title": agg.get("title", ""),
            "story": agg.get("story", ""), "outline_text": agg.get("outline_text", ""),
            "episodes": all_eps}
    (out_dir / "生成元数据.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    merged = [f"《{agg.get('title', '未命名')}》标准化生成合并稿",
              f"创意：{args.idea}", f"题材：{args.genre}    目标：{args.episodes}集    导出：{time.strftime('%Y-%m-%d %H:%M')}", ""]
    for e in all_eps:
        rv = e["review"] or {}
        rev_s = rv.get("score") if not rv.get("potential") else rv["potential"].get("score")
        merged += [f"{'=' * 30} 第{e['no']}集（规则 {e.get('score', '-')} / 复审 {rev_s if rev_s is not None else '-'}）{'=' * 30}",
                   e["text"], ""]
        (out_dir / f"第{e['no']:02d}集.txt").write_text(e["text"], encoding="utf-8")
    (out_dir / "合并全文.txt").write_text("\n".join(merged), encoding="utf-8")
    print(f"[gen] 已导出 {len(all_eps)} 集 → {out_dir}")
    return out_dir


def main():
    ap = argparse.ArgumentParser(description="标准化剧本生成与自动评估流水线")
    sub = ap.add_subparsers(dest="cmd", required=True)

    g = sub.add_parser("gen", help="全新生成 → 导出 → 自动评估")
    g.add_argument("--idea", required=True)
    g.add_argument("--genre", default="悬疑")
    g.add_argument("--hero", default="")
    g.add_argument("--episodes", type=int, default=4)
    g.add_argument("--first-half", dest="first_half", type=int, default=2)
    g.add_argument("--tags", default="")
    g.add_argument("--out", default="")

    e = sub.add_parser("eval", help="对已有导出目录离线复评")
    e.add_argument("--dir", required=True)

    args = ap.parse_args()
    if args.cmd == "gen":
        out = run_gen(args)
    else:
        out = Path(args.dir)
    result = evaluate(out)
    print(result["report"])
    print(f"\n[评估完成] 总分 {result['score_total']}/100，判定 {'PASS' if result['pass'] else 'FAIL'}")


if __name__ == "__main__":
    main()
