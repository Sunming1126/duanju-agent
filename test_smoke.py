# -*- coding: utf-8 -*-
"""Smoke test: verify all endpoints + full SSE generation pipeline + phase5 corpus platform."""
import json
import time

import httpx

BASE = "http://127.0.0.1:8765"
ok = []

def check(name, cond, detail=""):
    ok.append((name, cond))
    print(("[PASS] " if cond else "[FAIL] ") + name + (" | " + str(detail) if detail else ""))

# 1. health
r = httpx.get(f"{BASE}/api/health", timeout=10)
check("GET /api/health", r.status_code == 200 and r.json().get("status") == "ok", r.json())

# 2. homepage
r = httpx.get(f"{BASE}/", timeout=10)
check("GET / (homepage HTML)", r.status_code == 200 and "启动生成" in r.text, f"len={len(r.text)}")

# 3. corpus
r = httpx.get(f"{BASE}/api/corpus", timeout=10)
d = r.json()
check("GET /api/corpus", r.status_code == 200 and d.get("count", 0) >= 10, f"count={d.get('count')}")

# 4. kb search
r = httpx.get(f"{BASE}/api/corpus/search", params={"q": "逆袭 战神", "top_k": 3},
              headers={"X-Duanju-Site": "china"}, timeout=10)
d = r.json()
hits = d.get("hits", [])
check("GET /api/corpus/search", r.status_code == 200 and len(hits) >= 1,
      "top: " + (hits[0]["title"] if hits else "-"))

# 5. leaderboard
r = httpx.get(f"{BASE}/api/leaderboard", timeout=10)
d = r.json()
check("GET /api/leaderboard", r.status_code == 200 and len(d.get("list", [])) >= 5,
      f"n={len(d.get('list', []))} source={d.get('source')}")

# 5.5 POST /api/collect (real crawl ~15s) then verify merge
r = httpx.post(f"{BASE}/api/collect", timeout=120)
c = r.json()
check("POST /api/collect", r.status_code == 200 and c.get("ok"), c)
r = httpx.get(f"{BASE}/api/corpus", timeout=10)
d = r.json()
check("corpus merged live data", d.get("count", 0) >= 30 and d.get("live"),
      f"count={d.get('count')} live={d.get('live')}")
r = httpx.get(f"{BASE}/api/leaderboard", timeout=10)
d = r.json()
check("leaderboard now live", "实时采集" in d.get("source", ""), f"source={d.get('source')} n={len(d.get('list', []))}")
r = httpx.get(f"{BASE}/api/corpus/search", params={"q": "重生 系统 逆袭", "top_k": 3},
              headers={"X-Duanju-Site": "china"}, timeout=10)
check("kb search over live corpus", len(r.json().get("hits", [])) >= 1,
      "top: " + (r.json()["hits"][0]["title"] if r.json().get("hits") else "-"))

# 6. SSE generation pipeline (core feature)
print("\n--- SSE /api/generate stream ---")
node_events = []
node_data = {}
with httpx.stream("POST", f"{BASE}/api/generate",
                  json={"idea": "外卖小哥获得神秘系统，25年后成为科技集团总裁的逆袭故事",
                        "genre": "逆袭", "episodes": 24},
                  headers={"X-Duanju-Site": "china"}, timeout=180) as resp:
    check("POST /api/generate (SSE headers)",
          resp.status_code == 200 and "text/event-stream" in resp.headers.get("content-type", ""),
          resp.headers.get("content-type"))
    buf = ""
    for chunk in resp.iter_text():
        buf += chunk
        while "\n\n" in buf:
            raw, buf = buf.split("\n\n", 1)
            if raw.startswith("data: "):
                ev = json.loads(raw[6:])
                node_events.append((ev.get("node"), ev.get("status")))
                if ev.get("status") == "done" and ev.get("data"):
                    node_data[ev.get("node")] = ev["data"]
                print(f"  [{ev.get('node')}] {ev.get('status')}")

nodes_seen = [n for n, s in node_events if s in ("running", "done")]
expected = ["parse_idea", "kb_search", "outline", "script", "scenes", "storyboard"]
all_done = all(n in nodes_seen for n in expected)
check("6-node pipeline all executed", all_done, f"seen={sorted(set(nodes_seen))}")

has_outline = bool(node_data.get("outline", {}).get("text"))
has_script = bool(node_data.get("script", {}).get("text"))
has_shots = bool(node_data.get("storyboard", {}).get("shots"))
has_scenes = bool(node_data.get("scenes", {}).get("scenes"))
has_hits = bool(node_data.get("kb_search", {}).get("hits"))
check("kb hits returned", has_hits, f"hits={len(node_data.get('kb_search', {}).get('hits', []))}")
check("outline data returned", has_outline, str(node_data.get("outline", {}).get("text", ""))[:60])
check("episode-1 script returned", has_script, str(node_data.get("script", {}).get("text", ""))[:60])
check("scene breakdown returned", has_scenes, f"scenes={len(node_data.get('scenes', {}).get('scenes', []))}")
check("storyboard shots returned", has_shots, f"shots={len(node_data.get('storyboard', {}).get('shots', []))}")

# ================= 阶段5：平台类别 / 知识图谱 / 钩子 / 模板 / 转化 / SLA =================
ts = int(time.time())

# 7. 类别体系（4 维度）
r = httpx.get(f"{BASE}/api/categories", headers={"X-Duanju-Site": "china"}, timeout=10)
d = r.json()
check("GET /api/categories (4dims 20+cats)",
      r.status_code == 200 and len(d.get("dimensions", [])) >= 4 and len(d.get("categories", [])) >= 20,
      f"dims={len(d.get('dimensions', []))} cats={len(d.get('categories', []))}")

r = httpx.post(f"{BASE}/api/categories",
               json={"dimension": "genre", "name": f"冒烟测试类别{ts}", "features": "冒烟", "related_ids": []},
               timeout=10)
new_cid = r.json().get("id", "")
check("POST /api/categories", r.status_code == 200 and new_cid, r.json())
r = httpx.put(f"{BASE}/api/categories/{new_cid}", json={"features": "冒烟-已编辑"}, timeout=10)
check("PUT /api/categories/{cid}", r.status_code == 200 and r.json().get("features") == "冒烟-已编辑")
r = httpx.post(f"{BASE}/api/categories/{new_cid}/archive", json={"archived": True}, timeout=10)
check("POST category archive", r.status_code == 200 and r.json().get("archived"))
r = httpx.get(f"{BASE}/api/categories", params={"include_archived": "false"}, headers={"X-Duanju-Site": "china"}, timeout=10)
check("archived filtered out", new_cid not in [c["id"] for c in r.json().get("categories", [])])

# 8. 知识图谱 overview / cluster / node / path
r = httpx.get(f"{BASE}/api/graph", timeout=10)
g = r.json()
check("GET /api/graph", r.status_code == 200 and len(g.get("nodes", [])) >= 30 and len(g.get("links", [])) >= 20,
      f"nodes={len(g.get('nodes', []))} links={len(g.get('links', []))} ms={g.get('ms')}")
eid = g["nodes"][0]["id"] if g.get("nodes") else ""
r = httpx.get(f"{BASE}/api/graph/cluster", timeout=10)
check("GET /api/graph/cluster", r.status_code == 200 and len(r.json().get("clusters", [])) >= 3,
      f"clusters={len(r.json().get('clusters', []))}")
r = httpx.get(f"{BASE}/api/graph/node/{eid}", timeout=10)
nd = r.json()
check("GET /api/graph/node/{eid}", r.status_code == 200 and nd.get("node", {}).get("id") == eid,
      f"neighbors={len(nd.get('neighbors', []))}")
links = g.get("links", [])
if links:
    r = httpx.get(f"{BASE}/api/graph/path",
                  params={"src": links[0]["src"], "dst": links[0]["dst"]}, timeout=10)
    check("GET /api/graph/path (≤4hops)", r.status_code == 200 and r.json().get("hops", 9) <= 4,
          str(r.json())[:80])
else:
    check("GET /api/graph/path (≤4hops)", False, "no links")

# 9. 增量知识抽取（规则模式，不依赖 LLM key）
r = httpx.post(f"{BASE}/api/graph/extract", json={"limit": 3, "use_llm": False}, timeout=120)
check("POST /api/graph/extract (rule)", r.status_code == 200, str(r.json())[:100])

# 10. 灵感索引（多维过滤 + ≤300ms）
r = httpx.get(f"{BASE}/api/inspire", params={"theme": "逆袭", "q": "逆袭", "top_k": 5}, headers={"X-Duanju-Site": "china"}, timeout=10)
d = r.json()
check("GET /api/inspire (theme+q)", r.status_code == 200 and d.get("count", 0) >= 1,
      f"count={d.get('count')} ms={d.get('ms')}")
check("inspire latency ≤300ms", d.get("ms", 9999) <= 300, f"ms={d.get('ms')}")

# 11. 关联推荐 + 剧本关联度（≤300ms）
r = httpx.get(f"{BASE}/api/inspire/related", params={"eid": eid}, timeout=10)
check("GET /api/inspire/related", r.status_code == 200 and len(r.json().get("related", [])) >= 1,
      f"n={len(r.json().get('related', []))}")
r = httpx.get(f"{BASE}/api/related_dramas/{eid}", timeout=10)
d = r.json()
check("GET /api/related_dramas (breakdown)", r.status_code == 200 and d.get("count", 0) >= 1
      and "breakdown" in (d.get("items") or [{}])[0], f"count={d.get('count')} ms={d.get('ms')}")
check("related latency ≤300ms", d.get("ms", 9999) <= 300, f"ms={d.get('ms')}")

# 12. 剧本对比（差异高亮 + 相似度）
r = httpx.get(f"{BASE}/api/corpus", timeout=10)
ids = [it["id"] for it in r.json().get("items", [])][:2]
r = httpx.post(f"{BASE}/api/compare", json={"a": ids[0], "b": ids[1]}, timeout=10)
d = r.json()
check("POST /api/compare", r.status_code == 200 and "similarity" in d and "a_marked" in d.get("diff", {}),
      f"sim={d.get('similarity')}")

# 13. 溯源（前述 SSE 生成已自动写入 trace）
r = httpx.get(f"{BASE}/api/traces", headers={"X-Duanju-Site": "china"}, timeout=10)
d = r.json()
check("GET /api/traces", r.status_code == 200 and d.get("count", 0) >= 1, f"count={d.get('count')}")
tid = (d.get("items") or [{}])[0].get("trace_id", "")
if tid:
    r = httpx.get(f"{BASE}/api/traces/{tid}", timeout=10)
    d = r.json()
    check("GET /api/traces/{tid} citations", r.status_code == 200 and len(d.get("citations", [])) >= 1,
          f"citations={len(d.get('citations', []))} paths={len(d.get('graph_paths', []))}")
else:
    check("GET /api/traces/{tid} citations", False, "trace 未生成（SSE 失败）")

# 14. 钩子 CRUD + 版本 + 审核
r = httpx.post(f"{BASE}/api/hooks",
               json={"name": f"冒烟钩子{ts}", "text": "她死而复生，回到了三年前",
                     "category": "悬念钩", "position": "open", "mechanism": "悬念",
                     "intensity": 4, "tags": ["测试"]}, timeout=10)
h = r.json()
hid = h.get("id", "")
check("POST /api/hooks v1", r.status_code == 200 and hid, h)
r = httpx.put(f"{BASE}/api/hooks/{hid}",
              json={"text": "她死而复生，睁开眼回到了三年前的婚礼现场", "note": "冒烟编辑"}, timeout=10)
h2 = r.json()
check("PUT /api/hooks version+1", r.status_code == 200 and len(h2.get("versions", [])) == 2,
      f"versions={len(h2.get('versions', []))}")
r = httpx.post(f"{BASE}/api/hooks/{hid}/review", json={"approved": True, "reviewer": "smoke"}, timeout=10)
check("POST hook review approve", r.status_code == 200 and r.json().get("status") == "approved")
r = httpx.get(f"{BASE}/api/hooks", params={"status": "approved"}, timeout=10)
check("GET /api/hooks?status=approved", r.status_code == 200 and r.json().get("count", 0) >= 1,
      f"n={r.json().get('count')}")

# 15. 钩子智能抽取（规则模式）
r = httpx.post(f"{BASE}/api/hooks/extract",
               json={"text": "没想到下一秒，总裁直接撕碎了离婚协议。就在这时，门外传来急促的脚步声。", "save": False},
               timeout=10)
d = r.json()
check("POST /api/hooks/extract (rule)", r.status_code == 200 and len(d.get("found", [])) >= 1,
      f"found={len(d.get('found', []))}")

# 16. 结构模板 CRUD（标准 3 + 自定义）
r = httpx.get(f"{BASE}/api/templates", timeout=10)
d = r.json()
check("GET /api/templates (3标准)", r.status_code == 200 and d.get("count", 0) >= 3, f"n={d.get('count')}")
r = httpx.post(f"{BASE}/api/templates",
               json={"name": f"冒烟结构{ts}", "description": "测试",
                     "beats": [{"name": "开局", "pct": 10}, {"name": "反转", "pct": 60}, {"name": "爆点", "pct": 90}],
                     "kind": "custom"}, timeout=10)
new_tid = r.json().get("id", "")
check("POST /api/templates", r.status_code == 200 and new_tid)
r = httpx.put(f"{BASE}/api/templates/{new_tid}", json={"description": "测试-已编辑"}, timeout=10)
check("PUT /api/templates/{tid}", r.status_code == 200)
r = httpx.delete(f"{BASE}/api/templates/{new_tid}", timeout=10)
check("DELETE /api/templates/{tid}", r.status_code == 200 and r.json().get("deleted"))

# 17. 小说 → 短剧转化（auto 模式）
r = httpx.post(f"{BASE}/api/convert",
               json={"title": "冒烟转化", "mode": "auto",
                     "text": "林深推开门，屋内一片漆黑。他握紧手中的钥匙，三年前的记忆如潮水般涌来。"
                             "没想到，桌上那封信的落款，竟然是他自己的名字。"}, timeout=60)
d = r.json()
check("POST /api/convert (auto)", r.status_code == 200 and d.get("mode") == "auto" and d.get("converted"),
      f"hooks_saved={d.get('hooks_saved')}")

# 18. 系统指标（图谱 SLA）
r = httpx.get(f"{BASE}/api/stats", timeout=10)
d = r.json()
q = d.get("graph", {})
check("GET /api/stats graph SLA", r.status_code == 200 and q.get("accuracy", 0) >= 95
      and q.get("relation_complete", 0) >= 98,
      f"accuracy={q.get('accuracy')} complete={q.get('relation_complete')}")

# 19. 扩展接口位 ≥2
r = httpx.get(f"{BASE}/api/extensions", timeout=10)
d = r.json()
n_ext = (len(d.get("platform_adapters", [])) if isinstance(d.get("platform_adapters"), list) else 0) \
    + (1 if d.get("scheduler_hooks") is not None else 0) + (1 if d.get("export_api") else 0)
check("GET /api/extensions (≥2 slots)", r.status_code == 200 and n_ext >= 2,
      f"adapters={d.get('platform_adapters')} sched={d.get('scheduler_hooks')}")

# 20. 24h 数据新鲜度：手动刷新链路
r = httpx.post(f"{BASE}/api/refresh", timeout=120)
check("POST /api/refresh", r.status_code == 200 and r.json().get("ok"), str(r.json())[:100])

# ================= 双市场 / 三语改造：日本市场 + 日文输出 + CSV 导入 =================
# 21. 日本市场 · 日文输出的 SSE 生成（LLM 未配置时走日文兜底，同样必须过日文结构标记）
print("\n--- SSE /api/generate (japan / ja-JP) ---")
ja_events = []
ja_data = {}
with httpx.stream("POST", f"{BASE}/api/generate",
                  json={"idea": "離婚届を出した日、冷徹な御曹司に出会った",
                        "genre": "人生再生/恋愛", "hero": "高橋蓮", "episodes": 12,
                        "market": "japan", "output_locale": "ja-JP",
                        "content_type": "short_drama"}, timeout=180) as resp:
    check("POST /api/generate (ja, SSE)", resp.status_code == 200, resp.status_code)
    buf = ""
    for chunk in resp.iter_text():
        buf += chunk
        while "\n\n" in buf:
            raw, buf = buf.split("\n\n", 1)
            if raw.startswith("data: "):
                ev = json.loads(raw[6:])
                ja_events.append((ev.get("node"), ev.get("status")))
                if ev.get("status") == "done" and ev.get("data"):
                    ja_data[ev["node"]] = ev["data"]
ja_script = ja_data.get("script", {}).get("text", "")
check("ja script has localized scene marker", "シーン" in ja_script or "第1話" in ja_script,
      ja_script[:60])
check("ja script has tail hook marker", "【フック】" in ja_script or "次回予告" in ja_script,
      ja_script[-60:])
ja_qc = ja_data.get("quality_check", {})
check("ja script passes QC (语言一致性)", ja_qc.get("score", 0) >= 60,
      f"score={ja_qc.get('score')} fails={[c['item'] for c in ja_qc.get('checks', []) if not c['ok']]}")

# 22. 溯源记录含 market/output_locale
r = httpx.get(f"{BASE}/api/traces", timeout=10)
d = r.json()
# trace 列表最新在最前；校验最近一次（ja）生成的请求字段
last_req = (d.get("items") or [{}])[0].get("req", {})
check("trace req carries market/locale", last_req.get("market") == "japan" and last_req.get("output_locale") == "ja-JP",
      f"market={last_req.get('market')} locale={last_req.get('output_locale')}")

# 23. 日本市场语料检索过滤
r = httpx.get(f"{BASE}/api/corpus/search", params={"q": "転生", "market": "japan", "top_k": 5}, timeout=10)
d = r.json()
check("corpus search market=japan", r.status_code == 200,
      f"hits={len(d.get('hits', []))}")

# 24. CSV 灵感导入（hub/import，manual 语料隔离：源类型 manual，不被每日更新覆盖）
ts2 = str(int(time.time()))
csv_content = (
    "title,genre,简介,钩子,标签\n"
    f"冒烟CSV灵感{ts2},人生再生/恋愛,退職した翌日に古民家でパン屋を始める,突然の退職者が店内に現れる,スローライフ\n"
)
r = httpx.post(f"{BASE}/api/hub/import",
               files={"files": (f"smoke_{ts2}.csv", csv_content.encode("utf-8"), "text/csv")},
               data={"target": "inspiration", "market": "japan", "locale": "ja-JP", "content_type": "inspiration"},
               timeout=30)
d = r.json()
check("POST /api/hub/import (.csv japan)", r.status_code == 200 and d["results"][0]["ok"],
      d["results"][0] if d.get("results") else d)
r = httpx.get(f"{BASE}/api/inspirations", timeout=10)
cards = r.json().get("cards", [])
csv_card = next((c for c in cards if c["title"] == f"冒烟CSV灵感{ts2}"), None)
check("csv inspiration imported to japan market", csv_card is not None and csv_card.get("market") == "japan",
      csv_card and {k: csv_card.get(k) for k in ("market", "locale", "content_type", "source_type")})

# 25. AI 编剧任务接受 market/output_locale/content_type（后台生成，不等待完成）
r = httpx.post(f"{BASE}/api/writer/tasks",
               json={"idea": "婚約破棄された令嬢は、実は王国一の商人だった", "genre": "ざまぁ/復讐",
                     "hero": "シャーロット", "episodes": 6, "first_half": 2, "hot_tags": ["ざまぁ"],
                     "market": "japan", "output_locale": "ja-JP", "content_type": "short_drama"},
               timeout=30)
d = r.json()
check("POST /api/writer/tasks (ja)", r.status_code == 200 and d.get("ok") and d.get("tid"), d.get("tid"))

passed = sum(1 for _, c in ok if c)
print(f"\n===== {passed}/{len(ok)} checks passed =====")
raise SystemExit(0 if passed == len(ok) else 1)
