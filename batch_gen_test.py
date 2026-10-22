# -*- coding: utf-8 -*-
"""批量生成测试：逐部调用 /api/generate（SSE），汇总质量与性能报告

用法：python batch_gen_test.py [N]   # N 为生成数量，默认全部 10 部
输出：batch_report.json + 控制台摘要表
"""
import json
import re
import sys
import time

import httpx

BASE = "http://127.0.0.1:8765"

CASES = [
    {"idea": "农民工在工地捡到一块古玉，从此能听懂万物说话，引来豪门争夺", "genre": "逆袭/战神", "hero": "陈铁柱", "episodes": 24},
    {"idea": "霸总与秘书契约婚姻三年，离婚当天他先红了眼", "genre": "甜宠", "hero": "苏晚", "episodes": 12},
    {"idea": "千金被继母陷害毁容赶出家门，十年后以顶级设计师身份归来", "genre": "复仇", "hero": "沈清欢", "episodes": 24},
    {"idea": "小区电梯每晚十一点准时停运，保安发现监控里多了一个人影", "genre": "悬疑", "hero": "老周", "episodes": 12},
    {"idea": "社畜穿越成废柴皇子，用现代物理知识在朝堂杀出一条血路", "genre": "穿越", "hero": "李昭", "episodes": 24},
    {"idea": "天才萌宝带妈咪回国认亲，五个舅舅抢着宠还遇上了豪门亲爹", "genre": "萌宝", "hero": "小团子", "episodes": 12},
    {"idea": "退休老中医摆摊被城管赶，一针救下晕倒的豪门老爷子", "genre": "银发", "hero": "秦老爷子", "episodes": 12},
    {"idea": "复读生绑定高考系统，每提一分就能兑换一项黑科技", "genre": "系统", "hero": "江野", "episodes": 24},
    {"idea": "重生的女主拒绝嫁给前世仇人，转身嫁给他的死对头", "genre": "重生", "hero": "温宁", "episodes": 12},
    {"idea": "普通人每天醒来随机获得一项超能力，但午夜十二点会消失", "genre": "都市脑洞", "hero": "何小满", "episodes": 12},
]

# fallback.py 模板特征（用于检测 LLM 不可用被兜底）
FALLBACK_MARKS = ("受辱铺垫", "初遇误会", "含冤而死", "离奇事件", "穿越错位",
                  "绑定系统", "重生睁眼", "天才萌宝登场")
HOOK_WORDS = ["却", "竟", "突然", "下一秒", "这一幕", "神秘", "浮现", "响起", "身影", "名字", "背影", "瞳孔", "僵住", "炸", "倒吸", "收网", "倒计时", "才刚刚"]

# 场次行：场1 / 场次1 / 场次一 / 第一场（兼容 markdown 装饰混排）
SCENE_RE = r"场\s*次?\s*[0-9一二三四五六七八九十百]+|第[0-9一二三四五六七八九十百]+\s*场"
# 大纲集数行：第1集 / 第一集
EP_RE = r"第\s*[0-9一二三四五六七八九十百]+\s*集"


def sse_events(resp):
    buf = ""
    for chunk in resp.iter_bytes():
        buf += chunk.decode("utf-8", errors="replace")
        while "\n\n" in buf:
            block, buf = buf.split("\n\n", 1)
            for line in block.splitlines():
                if line.startswith("data: "):
                    try:
                        yield json.loads(line[6:])
                    except json.JSONDecodeError:
                        pass


def analyze(case, events, wall):
    node_t, last_run, data, err = {}, {}, {}, None
    for e in events:
        n, st = e.get("node"), e.get("status")
        if st == "running":
            last_run[n] = time.time()
        elif st == "done":
            data[n] = e.get("data", {})
            if n in last_run:
                node_t[n] = round(time.time() - last_run[n], 1)
        elif st == "error":
            err = e.get("data", {}).get("message", "unknown")

    parsed = data.get("parse_idea", {})
    # 精修节点存在时，统计以精修后成品文本为准
    script = data.get("refine", {}).get("text") or data.get("script", {}).get("text", "")
    outline = data.get("outline", {}).get("text", "")
    scenes = data.get("scenes", {}).get("scenes", [])
    shots = data.get("storyboard", {}).get("shots", [])
    hits = data.get("kb_search", {}).get("hits", [])
    qc = data.get("quality_check", {})
    rf = data.get("refine", {})

    fallback_used = bool(parsed.get("_engine")) or any(m in script[:120] for m in FALLBACK_MARKS)
    scene_marks = len(re.findall(SCENE_RE, script))
    dialogue_lines = len(re.findall(r"[：:]", script))
    tail = script[-200:]
    tail_hook = any(w in tail for w in HOOK_WORDS)

    return {
        "idea": case["idea"][:18] + "…",
        "genre": case["genre"],
        "ok": not err and bool(script),
        "err": err,
        "wall_s": round(wall, 1),
        "node_s": node_t,
        "logline": parsed.get("logline", ""),
        "hero": parsed.get("hero", ""),
        "kb_hits": len(hits),
        "kb_titles": [h.get("title", "")[:14] for h in hits],
        "outline_chars": len(outline),
        "outline_eps": len(re.findall(EP_RE, outline)),
        "script_chars": len(script),
        "script_scenes": scene_marks,
        "script_dialogue": dialogue_lines,
        "tail_hook": tail_hook,
        "scenes_n": len(scenes),
        "shots_n": len(shots),
        "qc_score": qc.get("score", "-"),
        "qc_summary": qc.get("summary", ""),
        "refine_score": rf.get("after_score", "-"),
        "refine_changes": sum(c.get("count", 0) for c in rf.get("changes", [])),
        "refine_engine": rf.get("engine", "-"),
        "fallback": fallback_used,
        "script_head": script[:60].replace("\n", " "),
        "script_tail": script[-80:].replace("\n", " "),
    }


def main():
    n = int(sys.argv[1]) if len(sys.argv) > 1 else len(CASES)
    cases = CASES[:n]
    results = []
    t_all = time.time()
    with httpx.Client(timeout=300, trust_env=False) as cli:
        for i, case in enumerate(cases, 1):
            print(f"[{i}/{n}] 生成中：{case['idea'][:24]}…", flush=True)
            t0 = time.time()
            events = []
            try:
                with cli.stream("POST", f"{BASE}/api/generate", json=case) as r:
                    for ev in sse_events(r):
                        if ev.get("status") == "running":
                            print(f"    ▶ {ev.get('node')}", flush=True)
                        events.append(ev)
            except Exception as e:
                events.append({"node": "_error", "status": "error", "data": {"message": str(e)}})
            rep = analyze(case, events, time.time() - t0)
            results.append(rep)
            print(f"    ✓ {rep['wall_s']}s | 剧本{rep['script_chars']}字 | 场次{rep['script_scenes']} | "
                  f"大纲{rep['outline_eps']}集 | 兜底={rep['fallback']} | 钩子={rep['tail_hook']}", flush=True)

    total = round(time.time() - t_all, 1)
    ok_n = sum(1 for r in results if r["ok"])
    fb_n = sum(1 for r in results if r["fallback"])
    hook_n = sum(1 for r in results if r["tail_hook"])
    avg_wall = round(sum(r["wall_s"] for r in results) / len(results), 1)

    print("\n========== 批量生成汇总 ==========")
    print(f"成功 {ok_n}/{len(cases)} | 兜底 {fb_n} | 结尾钩子 {hook_n}/{len(cases)} | 平均耗时 {avg_wall}s | 总耗时 {total}s")
    print(f"{'#':<3}{'题材':<8}{'耗时':>6}{'剧本字数':>8}{'场次':>5}{'大纲集':>6}{'场景表':>6}{'分镜':>5}{'KB':>4}{'质检':>6}{'精修':>6}{'修改':>5}{'兜底':>5}{'钩子':>5}")
    for i, r in enumerate(results, 1):
        print(f"{i:<3}{r['genre']:<8}{r['wall_s']:>6}{r['script_chars']:>8}{r['script_scenes']:>5}"
              f"{r['outline_eps']:>6}{r['scenes_n']:>6}{r['shots_n']:>5}{r['kb_hits']:>4}"
              f"{str(r['qc_score']):>6}{str(r['refine_score']):>6}{r['refine_changes']:>5}"
              f"{str(r['fallback']):>5}{str(r['tail_hook']):>5}")

    with open("batch_report.json", "w", encoding="utf-8") as f:
        json.dump({"summary": {"ok": ok_n, "fallback": fb_n, "hook": hook_n,
                               "avg_wall_s": avg_wall, "total_s": total},
                   "results": results}, f, ensure_ascii=False, indent=1)
    print("\n报告已写入 batch_report.json")


if __name__ == "__main__":
    main()
