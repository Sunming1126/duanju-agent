# -*- coding: utf-8 -*-
"""Probe 13: dump detail page _ROUTER_DATA structure + data-fn-args attributes."""
import httpx
import json
import re
import html as htmllib

H = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    "Accept-Language": "zh-CN,zh;q=0.9",
}

sid = "7685224734895655960"
r = httpx.get(f"https://hongguoduanju.com/detail?series_id={sid}", headers=H, timeout=25, follow_redirects=True)
t = r.text
print("len:", len(t), "| series_intro in html:", t.count("series_intro"))

# all assignment sites, print each parsed top-level
for m in re.finditer(r"_ROUTER_DATA\s*=\s*(?={)", t):
    try:
        data, end = json.JSONDecoder().raw_decode(t[m.end():])
        s = json.dumps(data, ensure_ascii=False)
        print(f"\n== assignment @{m.start()} parsed, jsonlen={len(s)}")
        print("  head:", s[:400])
    except Exception as e:
        print(f"\n== assignment @{m.start()} DECODE FAIL: {str(e)[:60]}")

# data-fn-args
args_found = re.findall(r'data-fn-args="([^"]*)"', t)
print("\ndata-fn-args attrs:", len(args_found))
for i, a in enumerate(args_found[:5]):
    u = htmllib.unescape(a)
    print(f"  [{i}] len={len(u)}: {u[:200]}")
    try:
        arr = json.loads(u)
        for x in arr if isinstance(arr, list) else [arr]:
            if isinstance(x, str) and x.startswith("{"):
                inner = json.loads(x)
                print("      inner keys:", list(inner.keys())[:15])
                print("      inner head:", json.dumps(inner, ensure_ascii=False)[:300])
    except Exception as e:
        print("      parse err:", str(e)[:60])
