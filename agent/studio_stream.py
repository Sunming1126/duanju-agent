"""One non-retrying streaming request for Chinese outline previews only."""
import asyncio
import json

import httpx
from . import llm


async def chat_outline(messages, *, on_text, temperature=0.8, max_tokens=12000, timeout=240, err_box=None):
    llm._refresh_config()
    payload = {"model": llm.MODEL, "messages": messages, "temperature": temperature, "max_tokens": max_tokens, "stream": True}
    if llm.MODEL.startswith("doubao"):
        payload["thinking"] = {"type": "disabled"}
    if err_box is not None:
        err_box.clear()

    async def request():
        text, reason = "", None
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream("POST", f"{llm.API_BASE}/chat/completions", json=payload, headers={"Authorization": f"Bearer {llm.API_KEY}", "Content-Type": "application/json"}) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[5:].strip()
                    if data == "[DONE]":
                        break
                    if not data:
                        continue
                    event = json.loads(data)
                    if event.get("error"):
                        raise ValueError("Provider stream failed")
                    for choice in event.get("choices", []):
                        delta = choice.get("delta", {}).get("content")
                        if isinstance(delta, str) and delta:
                            text += delta
                            if len(text) > 100000:
                                raise ValueError("Outline stream exceeded capacity")
                            await on_text(text)
                        if choice.get("finish_reason"):
                            reason = choice["finish_reason"]
        if reason != "stop":
            if err_box is not None:
                err_box.update(kind="incomplete", status=200, attempts=1)
            return None
        return text

    try:
        return await asyncio.wait_for(request(), timeout)
    except httpx.HTTPStatusError as error:
        status = error.response.status_code
        if err_box is not None:
            err_box.update(kind="rate_limit" if status == 429 else "http_error", status=status, attempts=1)
    except (httpx.HTTPError, ValueError, asyncio.TimeoutError):
        if err_box is not None:
            err_box.update(kind="error", status=0, attempts=1)
    return None
