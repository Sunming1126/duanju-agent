"""Paid-comparison guardrails, using a fake transport without model calls."""
import importlib.util
import json
from pathlib import Path
import stat
import sys

import httpx
import pytest


spec = importlib.util.spec_from_file_location("novel_quality_runner", Path(__file__).resolve().parents[1] / "tools/plotloom_novel_quality.py")
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class Transport:
    def __init__(self, fail_poll=False):
        self.cookies = {"plotloom_space": "offline-qa-identity"}
        self.calls = []
        self.works = {}
        self.jobs = {}
        self.fail_poll = fail_poll

    def __enter__(self):
        return self

    def __exit__(self, *args):
        pass

    def request(self, method, url, json=None):
        path = url.split("/studio", 1)[1]
        self.calls.append((method, path))
        status = 200
        if path == "/session":
            data = {"isolated": True}
        elif path == "/status":
            data = {"llm_ready": True, "model": "offline"}
        elif path == "/works":
            ident = str(len(self.works) + 1)
            data = {**json, "id": ident, "revision": 1}
            self.works[ident] = data
        elif path.startswith("/works/") and path.endswith("/jobs"):
            ident = str(len(self.jobs) + 1)
            data = {"id": ident, "work_id": path.split("/")[2], "status": "queued"}
            self.jobs[ident] = data
        elif path.startswith("/jobs/"):
            job = self.jobs[path.split("/")[2]]
            if path.endswith("/adopt"):
                data = self.works[job["work_id"]]
                data["revision"] += 1
            elif self.fail_poll:
                status, data = 503, {}
            else:
                data = {**job, "status": "completed", "results": [{"text": "她把账页折好，交给对方。\n“明日再核。”\n对方点了点头。", "summary": "双方约定明日核对。"}]}
        elif path.endswith("/archive"):
            data = {"archived": True}
        else:
            raise AssertionError((method, path))
        return httpx.Response(status, json=data)


def arguments(monkeypatch, path, *extras):
    monkeypatch.setattr(sys, "argv", ["quality", "--transport", "api", "--label", "offline-test", "--output", str(path), *extras])


def test_explicit_flag_and_existing_report_prevent_any_network(tmp_path, monkeypatch):
    monkeypatch.setattr(httpx, "Client", lambda **kwargs: pytest.fail("unexpected network"))
    arguments(monkeypatch, tmp_path)
    with pytest.raises(SystemExit):
        runner.main()
    (tmp_path / "report.json").write_text('{"interrupted":true}')
    arguments(monkeypatch, tmp_path, "--real-model")
    with pytest.raises(SystemExit):
        runner.main()
    assert json.loads((tmp_path / "report.json").read_text()) == {"interrupted": True}


def test_three_cases_use_six_jobs_and_archive_only_their_own_works(tmp_path, monkeypatch):
    transport = Transport()
    monkeypatch.setattr(httpx, "Client", lambda **kwargs: transport)
    arguments(monkeypatch, tmp_path, "--real-model")
    runner.main()
    report = json.loads((tmp_path / "report.json").read_text())
    assert report["ok"] and report["submitted_calls"] == report["planned_calls"] == 6
    assert len(transport.jobs) == 6 and len(transport.works) == 3
    assert [path for method, path in transport.calls if method == "PATCH"] == [f"/works/{i}/archive" for i in (1, 2, 3)]
    assert all(len(case["chapters"]) == 2 and case["archived"] for case in report["results"])
    assert len(list(tmp_path.glob("*.txt"))) == 6
    assert stat.S_IMODE((tmp_path / "space-cookie.json").stat().st_mode) == 0o600
    assert "offline-qa-identity" not in (tmp_path / "report.json").read_text()


def test_poll_failure_preserves_identity_and_job_id_without_resubmission(tmp_path, monkeypatch):
    transport = Transport(fail_poll=True)
    monkeypatch.setattr(httpx, "Client", lambda **kwargs: transport)
    arguments(monkeypatch, tmp_path, "--real-model")
    with pytest.raises(SystemExit, match="No automatic retry"):
        runner.main()
    report = json.loads((tmp_path / "report.json").read_text())
    assert not report["ok"] and report["submitted_calls"] == 1
    assert report["results"][0]["jobs"] == ["1"]
    assert len(transport.jobs) == 1 and (tmp_path / "space-cookie.json").exists()


def test_isolated_runner_uses_temporary_database_and_single_calls(tmp_path, monkeypatch):
    from agent import studio_api as api
    # Register original values with monkeypatch before the runner replaces them.
    monkeypatch.setattr(api, "store", api.store)
    monkeypatch.setattr(api, "reference_context", api.reference_context)
    for name in ("_CFG_PATH", "_CFG_MTIME", "API_KEY", "API_BASE", "MODEL"):
        monkeypatch.setattr(api.llm, name, getattr(api.llm, name))
    monkeypatch.setenv("DUANJU_STUDIO_DB", str(tmp_path / "before.sqlite3"))
    calls = []
    async def generate(messages, **kwargs):
        calls.append(kwargs)
        return json.dumps({"text": "她把账页翻到昨天的记录，照着上面的数字又核了一遍。对面的人没有催她，伸手挪开了灯，好让她看清页角。\n“这里还没写完。”她说。", "summary": "双方在灯下核对记录，尚未确认结果。"}, ensure_ascii=False)
    monkeypatch.setattr(api.llm, "chat", generate)
    config = tmp_path / "fake-config.json"
    config.write_text('{"api_key":"offline-only","model":"offline-test"}')
    output = tmp_path / "isolated"
    monkeypatch.setattr(sys, "argv", ["quality", "--transport", "isolated", "--label", "offline-test",
                        "--output", str(output), "--config-file", str(config), "--case", "well", "--real-model"])
    runner.main()
    report = json.loads((output / "report.json").read_text())
    assert report["ok"] and report["config_unchanged"] and report["submitted_calls"] == 2
    assert len(calls) == 2 and all(call["retries"] == 1 for call in calls)
    assert (output / "studio.sqlite3").exists()
    assert not (tmp_path / "before.sqlite3").exists()
    assert "offline-only" not in (output / "report.json").read_text()


@pytest.mark.parametrize("thinking", ["provider-default", "disabled"])
def test_thinking_experiment_is_explicit_and_records_only_usage(tmp_path, monkeypatch, thinking):
    from agent import studio_api as api
    monkeypatch.setattr(api, "store", api.store)
    monkeypatch.setattr(api, "reference_context", api.reference_context)
    for name in ("_CFG_PATH", "_CFG_MTIME", "API_KEY", "API_BASE", "MODEL"):
        monkeypatch.setattr(api.llm, name, getattr(api.llm, name))
    monkeypatch.setenv("DUANJU_STUDIO_DB", str(tmp_path / "unused.sqlite3"))
    payloads = []
    async def post(client, url, **options):
        payloads.append(options["json"])
        text = "她在账页上圈出尚未核清的一行，把笔搁在旁边。门外的人等了片刻，终于走进来，亲自查看那张被雨水打湿的收条。"
        return httpx.Response(200, request=httpx.Request("POST", "https://offline.invalid"), json={
            "choices": [{"finish_reason": "stop", "message": {"content": json.dumps({"text": text, "summary": "两人开始核对受潮收条。"})}}],
            "usage": {"total_tokens": 80, "completion_tokens_details": {"reasoning_tokens": 0}},
        })
    monkeypatch.setattr(httpx.AsyncClient, "post", post)
    config = tmp_path / "fake-config.json"
    config.write_text('{"api_key":"private-offline-key","model":"deepseek-v4.1-flash","api_base":"https://ark.cn-beijing.volces.com/api/v3"}')
    output = tmp_path / "experiment"
    monkeypatch.setattr(sys, "argv", ["quality", "--transport", "isolated", "--label", "offline-test", "--output", str(output),
                        "--config-file", str(config), "--case", "well", "--real-model", "--thinking", thinking])
    runner.main()
    report = json.loads((output / "report.json").read_text())
    assert report["ok"] and len(payloads) == len(report["provider_calls"]) == 2
    assert all((payload.get("thinking") == {"type": "disabled"}) == (thinking == "disabled") for payload in payloads)
    assert all(call["reasoning_tokens"] == 0 and call["tokens"] == {"total_tokens": 80} for call in report["provider_calls"])
    assert "private-offline-key" not in (output / "report.json").read_text()
