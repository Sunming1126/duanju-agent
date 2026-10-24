"""Explicit, read-only legacy snapshot adapter. Never infers missing markets."""
import hashlib
import json
import os
from pathlib import Path
from fastapi import HTTPException
from .studio_store import export_work_text


def records():
    folder = os.environ.get("PLOTLOOM_LEGACY_DIR")
    if not folder:
        return []
    result = []
    for file in Path(folder).glob('*.json'):
        try:
            task = json.loads(file.read_text(encoding='utf-8'))
            req = task.get('req') or {}
            if req.get('market') != 'china' or req.get('output_locale', 'zh-CN') != 'zh-CN':
                continue
            agg = task.get('agg') or {}
            chapters = {int(e['no']): {'number': int(e['no']), 'title': f"第{e['no']}集", 'content': e['text']}
                        for e in (task.get('cont') or {}).get('episodes', []) if isinstance(e, dict) and e.get('text') and str(e.get('no', '')).isdigit()}
            if agg.get('ep1_script') and 1 not in chapters:
                chapters[1] = {'number': 1, 'title': '第一集', 'content': agg['ep1_script']}
            ident = hashlib.sha256(file.name.encode()).hexdigest()[:24]
            payload = dict(title=agg.get('title') or req.get('idea', '')[:50] or '旧站作品', content_type=req.get('content_type', 'short_drama'),
                           genre=agg.get('genre') or req.get('genre') or '其他', mode='旧站显式导入',
                           units=max(int(req.get('episodes') or 12), max(chapters, default=1)),
                           premise=agg.get('story') or req.get('idea') or '', characters=agg.get('characters') or agg.get('hero') or '',
                           outline='\n'.join(filter(None, [agg.get('outline_text', ''), (task.get('cont') or {}).get('outline_ext', '')])),
                           chapters=sorted(chapters.values(), key=lambda c: c['number']), legacy_id='server-history:' + str(task.get('tid') or ident))
            result.append({'id': ident, 'title': payload['title'], 'chapters': len(chapters), 'status': task.get('status', ''), 'payload': payload})
        except (ValueError, KeyError, TypeError, OSError):
            continue
    return result


def find(ident):
    for record in records():
        if record['id'] == ident:
            return record
    raise HTTPException(404, '中文历史记录不存在；缺少明确市场归属的记录保留待核对')
