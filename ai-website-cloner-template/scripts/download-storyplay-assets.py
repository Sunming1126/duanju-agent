"""Download publicly observed reference assets; no source bundles are used as app code."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.request import Request, urlopen
import json

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "public/sites/storyplay"
base = "https://storyplay.cn/"
assets = {
 "logo.png": base + "assets/logo-white-en-Duoshdyn.png",
 "new.png": base + "material/home-lapian-new.png?v2",
 "hot.png": base + "material/home-lapian-hot.png?v2",
 "footer-bg.png": base + "material/home-bg.png",
}
covers = [
 ("2026-09-07", "31600967a5a2487c864b165594abf9d9.jpg"),
 ("2026-09-07", "f60960e306de472ca626199d6cd3ed31.jpg"),
 ("2026-09-07", "80b0ab8331ec411d9887f6db2c174c48.jpg"),
 ("2026-09-07", "65b3f328e8114aa78f4bb30aca216675.jpg"),
 ("2026-09-07", "de986a95490b44308df047740f5f1075.jpg"),
 ("2026-08-22", "f229d9991ef8405a8c51baf3efe8e55b.jpeg"),
 ("2026-08-22", "81cc4c96458346e497695b6136082df1.jpeg"),
 ("2026-08-22", "d39803c9c7864011a99fee63814e643d.jpeg"),
 ("2026-08-22", "335d0724e6a847048c83f903ef8bc43a.jpeg"),
 ("2026-08-22", "f720ea7f96ee479d878a282d0e86d846.jpeg"),
]
for i, (day, name) in enumerate(covers, 1):
 assets[f"cover-{i:02}.jpg"] = f"https://storyplay-admin.oss-cn-hangzhou.aliyuncs.com/lapian/{day}/13500009404/{name}?x-oss-process=image/resize,w_880"
for i in range(1,15):
 assets[f"provider-{i:02}.webp"] = base + f"material/provider/ap-{i:02}.webp?v2"
for name in ["10", "23", "06"]:
 assets[f"avatar-{name}.webp"] = base + f"avatar/{name}.webp"

def download(item):
 name, url = item
 with urlopen(Request(url, headers={"User-Agent":"Mozilla/5.0"}), timeout=45) as response:
  content_type = response.headers.get("Content-Type", "")
  if not content_type.startswith("image/"):
   raise ValueError(f"Unexpected content type: {name}: {content_type}")
  data = response.read()
  (OUT / name).write_bytes(data)
  return {"file": "/sites/storyplay/" + name, "source": url, "content_type": content_type, "bytes": len(data)}
OUT.mkdir(parents=True, exist_ok=True)
with ThreadPoolExecutor(max_workers=6) as pool:
 result = list(pool.map(download, assets.items()))
(ROOT / "docs/research/storyplay/assets.json").write_text(json.dumps(result, ensure_ascii=False, indent=2))
print(f"Downloaded and checked {len(result)} public image assets.")
