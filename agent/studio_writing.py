"""Compatibility facade routing each type to an independent writing policy."""
from . import studio_novel, studio_drama
from .studio_novel import NovelSettings
from .studio_drama import DramaSettings


def canonical_mode(content_type, mode=""):
    if mode in {"灵感策划", "灵感创作"}:
        return "灵感创作"
    if content_type == "novel":
        return "小说创作"
    return mode if mode in {"小说改编", "剧本改写"} else "剧本创作"


def normalized_work(work):
    # Normalize old metadata only in the prompt copy, never in stored prose.
    return {**work, "mode": canonical_mode(work["content_type"], work.get("mode", ""))}


def policy(work):
    return studio_novel if work["content_type"] == "novel" else studio_drama


def writing_context(work):
    return policy(work).writing_context(work)


def system_prompt(work):
    return policy(work).system_prompt(work)


def step_instruction(work, action, number=1, json_chapter=True):
    return policy(work).step_instruction(work, action, number, json_chapter)


def validate_chapter_format(content_type, text):
    if content_type == "novel":
        return studio_novel.validate_chapter_format(text)
    return studio_drama.validate_chapter_format(content_type, text)
