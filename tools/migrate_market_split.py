# -*- coding: utf-8 -*-
"""市场拆站数据迁移：给历史数据补 market 字段（一次性执行，幂等可重跑）

规则（推荐方案）：
- hooks.json：全部归 china（钩子库 1151 条均为中文内容）
- templates.json：全部归 china
- categories.json：名称含日文（假名）判 japan，否则 china
- graph.json 实体：名称/props 含假名 → japan；trope/style/theme/emotion 等抽象类型 → common；其余 → china
- inspirations.json（旧版单文件）：不迁移，按市场重建时自动落 inspirations_china/japan.json
- library/ 与 writer_tasks/：读取层已有 china 缺省，无需迁移
用法：python3 tools/migrate_market_split.py [--dry]
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
KANA = re.compile(r"[぀-ヿ]")  # 平假名+片假名


def has_kana(text: str) -> bool:
    return bool(KANA.search(str(text or "")))


def load(path: Path):
    if not path.exists():
        return None
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save(path: Path, d):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(d, f, ensure_ascii=False, indent=1)


def main(dry: bool = False):
    stats = {}

    # 1) hooks：全归 china
    p = DATA / "hooks.json"
    d = load(p)
    if d:
        n = 0
        for h in d.get("hooks", []):
            if not h.get("market"):
                h["market"] = "china"
                n += 1
        if not dry and n:
            save(p, d)
        stats["hooks"] = f"{n} 条 → china"

    # 2) templates：日本模板（id 前缀 jp- 或含假名）→ japan，其余 → china
    p = DATA / "templates.json"
    d = load(p)
    if d:
        n_c = n_j = 0
        for t in d.get("templates", []):
            if t.get("market"):
                continue
            blob = str(t.get("id", "")) + str(t.get("name", ""))
            m = "japan" if blob.startswith("tpl:jp-") or has_kana(blob) else "china"
            t["market"] = m
            n_c, n_j = (n_c + 1, n_j) if m == "china" else (n_c, n_j + 1)
        if not dry and (n_c or n_j):
            save(p, d)
        stats["templates"] = f"china {n_c} / japan {n_j}"

    # 3) categories：含假名 → japan，否则 china
    p = DATA / "categories.json"
    d = load(p)
    if d:
        n_c = n_j = 0
        for c in d.get("categories", []):
            if c.get("market"):
                continue
            m = "japan" if has_kana(c.get("name")) or has_kana(c.get("features")) else "china"
            c["market"] = m
            n_c, n_j = (n_c + 1, n_j) if m == "china" else (n_c, n_j + 1)
        if not dry and (n_c or n_j):
            save(p, d)
        stats["categories"] = f"china {n_c} / japan {n_j}"

    # 4) graph 实体
    p = DATA / "graph.json"
    d = load(p)
    if d:
        COMMON_TYPES = {"trope", "style", "theme", "emotion"}
        n_c = n_j = n_com = 0
        for e in d.get("entities", []):
            if e.get("market"):
                continue
            if e.get("type") in COMMON_TYPES:
                m = "common"
            else:
                blob = e.get("name", "") + json.dumps(e.get("props", {}), ensure_ascii=False)
                m = "japan" if has_kana(blob) else "china"
            e["market"] = m
            if m == "china":
                n_c += 1
            elif m == "japan":
                n_j += 1
            else:
                n_com += 1
        if not dry and (n_c or n_j or n_com):
            save(p, d)
        stats["graph"] = f"china {n_c} / japan {n_j} / common {n_com}"

    for k, v in stats.items():
        print(f"{k}: {v}")
    print("迁移完成" + ("（dry-run 未写盘）" if dry else ""))


if __name__ == "__main__":
    main(dry="--dry" in sys.argv)
