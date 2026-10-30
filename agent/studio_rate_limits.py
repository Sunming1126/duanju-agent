"""Sanitized provider throttling metadata; never include response text or secrets."""
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import math
import re


def throttle_info(response, *, streaming=False):
    result = {"kind": "rate_limit" if response.status_code == 429 else "http_error", "status": response.status_code}
    try:
        body = response.json() if not streaming else {}
        error = body.get("error", {}) if isinstance(body, dict) else {}
        code = str(error.get("code", "")) if isinstance(error, dict) else ""
        if re.fullmatch(r"[A-Za-z0-9_.:-]{1,160}", code):
            result["provider_code"] = code
            if "QuotaExceeded" in code:
                result["limit_type"] = "quota"
            elif "Inflight" in code:
                result["limit_type"] = "concurrency"
            elif "Tpm" in code or "TPM" in code:
                result["limit_type"] = "tokens"
            elif "Rpm" in code or "RPM" in code:
                result["limit_type"] = "requests"
    except (ValueError, TypeError):
        pass
    value = response.headers.get("Retry-After", "")
    try:
        seconds = float(value)
    except ValueError:
        try:
            date = parsedate_to_datetime(value)
            if date.tzinfo is None:
                date = date.replace(tzinfo=timezone.utc)
            seconds = (date - datetime.now(timezone.utc)).total_seconds()
        except (ValueError, TypeError, OverflowError):
            seconds = 0
    if math.isfinite(seconds) and seconds > 0:
        result["retry_after_seconds"] = min(86400, math.ceil(seconds))
    return result
