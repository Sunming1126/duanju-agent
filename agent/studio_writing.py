"""Compatibility facade routing each type to an independent writing policy."""
from . import studio_novel, studio_drama, studio_region
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
    context = policy(work).writing_context(work)
    if studio_region.regional(work):
        context["成稿类型"] = work["content_type"]
        context["output_locale"] = work["output_locale"]
        context["market"] = work["market"]
    return context


def system_prompt(work):
    return studio_region.system_prompt(work) if studio_region.regional(work) else policy(work).system_prompt(work)


def step_instruction(work, action, number=1, json_chapter=True):
    return studio_region.step_instruction(work, action, number, json_chapter) if studio_region.regional(work) else policy(work).step_instruction(work, action, number, json_chapter)


def validate_chapter_format(content_type, text):
    if content_type == "novel":
        return studio_novel.validate_chapter_format(text)
    return studio_drama.validate_chapter_format(content_type, text)
