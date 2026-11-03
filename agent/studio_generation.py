"""Budgets for persistent Studio calls, separate from legacy/Japanese services."""
from urllib.parse import urlsplit

from . import llm


def request_options(work, step, *, continuation=False):
    llm._refresh_config()
    host = (urlsplit(llm.API_BASE).hostname or "").lower()
    # Only the verified Ark DeepSeek V4 family gets provider-specific changes.
    # Unknown providers/endpoints retain their existing request contract.
    supported = host.endswith(".volces.com") and llm.MODEL.lower().startswith(("deepseek-v4.1-", "deepseek-v4-1-"))
    options = {"max_tokens": 12000, "timeout": 240}
    if not supported:
        return options
    if step["action"] == "chapter":
        target = work["words_per_chapter"]
        if continuation:
            original = next((c["content"] for c in work["chapters"] if c["number"] == step["number"]), "")
            # Returning the complete original is part of the continuation contract.
            target += len(original)
        required = target * 3 + 2048  # prose, JSON escaping and factual summary
        if required > 32768:
            raise ValueError("本章续写后预计超过单次输出预算，请缩短原稿或拆分章节；原稿和已完成内容保留。")
        options.update(max_tokens=max(12000, required), thinking=False)
    elif step["action"] == "outline":
        # Planning keeps provider-default reasoning; allow for the entire plan.
        options["max_tokens"] = min(65536, max(24000, 8000 + work["units"] * 280))
    else:
        options["max_tokens"] = 24000
    options["timeout"] = max(240, min(900, options["max_tokens"] // 50))
    return options


def failure_details(error, options):
    """Do not persist provider payloads, exception text, prompts or credentials."""
    info = {"max_tokens": options.get("max_tokens", 12000), "timeout": options.get("timeout", 240)}
    for key in ("status", "attempts", "prompt_tokens", "completion_tokens", "total_tokens", "reasoning_tokens"):
        value = error.get(key)
        if type(value) is int and value >= 0:
            info[key] = value
    if error.get("kind") in {"incomplete", "empty_content", "timeout", "rate_limit", "http_error", "error"}:
        info["kind"] = error["kind"]
    if error.get("finish_reason") in {"length", "stop", "content_filter", "tool_calls", "function_call"}:
        info["finish_reason"] = error["finish_reason"]
    return info


def failure_message(error):
    if error.get("kind") == "incomplete":
        if error.get("finish_reason") == "length":
            return "模型达到本步输出额度，结果被截断"
        if error.get("finish_reason") == "content_filter":
            return "模型服务未通过本步内容检查"
        return "模型输出未正常结束"
    return {"rate_limit": "模型限流", "http_error": "模型服务拒绝请求", "error": "模型连接失败",
            "timeout": "模型生成超时", "empty_content": "模型正常结束但未返回正文"}.get(error.get("kind"), "模型没有返回有效内容")
