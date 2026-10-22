"""Shared library projections: collected references and saved scripts have matching list/detail identities."""
from datetime import datetime, timezone
from urllib.parse import urlsplit

from .market import normalize_item


def _timestamp(value):
    if isinstance(value, (int, float)):
        return value
    try:
        parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        return (parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)).timestamp()
    except (ValueError, TypeError):
        return 0


def reference_from_corpus(source):
    """A collected synopsis/excerpt is a reference, never a complete episode."""
    source = normalize_item(source)
    synopsis = str(source.get('logline') or '')
    excerpt = str(source.get('hook') or '')
    url = str(source.get('source_url') or '')
    try:
        if urlsplit(url).scheme not in {'http', 'https'} or not urlsplit(url).netloc:
            url = ''
    except ValueError:
        url = ''
    return {
        **source,
        'id': 'corpus-' + str(source['id']), 'source_id': str(source['id']),
        'title': source.get('title') or source.get('title_original') or '日本語作品',
        'kind': 'reference', 'record_type': 'source_reference', 'read_only': True,
        'source': source.get('source_platform') or source.get('platform') or '',
        'hero': source.get('hero') or '', 'author': source.get('author') or '',
        'hot_tags': source.get('tags') or [], 'outline': synopsis, 'script': '',
        'excerpt': excerpt if excerpt != synopsis else '', 'source_url': url,
        'created_at': _timestamp(source.get('created_at') or source.get('collected_at')),
        'updated_at': _timestamp(source.get('updated_at') or source.get('collected_at')),
        'script_locale': source['locale'],
    }


def stored_library_item(source, lid):
    item = normalize_item(source)
    item['id'] = lid
    item.setdefault('kind', 'reference')
    item.setdefault('record_type', 'source_reference' if item.get('source') == '知识图谱'
                    or str(item.get('script') or '').startswith('【图谱资料卡】') else 'script')
    item['read_only'] = False
    return item
