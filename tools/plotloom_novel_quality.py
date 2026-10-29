"""Opt-in, bounded novel comparison through the public API or isolated JobStore.

Run from the repository root. Each case makes exactly two chapter requests,
with fixed original planning inputs. Existing reports are never rerun; inspect
the recorded IDs/results after interruption instead of resubmitting paid calls.
"""
import argparse
import asyncio
import hashlib
import json
import os
import sys
import time
import uuid
from pathlib import Path
from urllib.parse import urlsplit


CASES = [
    {
        "id": "well", "title": "荒驿的第一桶水",
        "premise": "架空古代，失势公主沈蘅带十二名随员抵达盐碱河谷的废驿。现有饮水只够一天，下一车水三日后才到。她必须取得可用水，又不能得罪掌管运输的内侍。她不懂水利和医药，只会查账、识字。",
        "characters": "沈蘅：被迁出王庭的公主，习惯问清数字再决定，不懂井工，不轻易指控他人。郑福：负责交接的内侍，怕担延误之责，也怕擅动旧驿被追责，言语客气，未设定为凶手。伍成：在此修路二十年的匠人，懂淘井，但不保证旧井水可以饮用。阿禾：照料公主的侍女，想保住随员口粮，说话直接。",
        "outline": "【粗纲】\n沈蘅先查清用水与运输限制，向伍成请教旧井状况，以自己签字承担修驿责任换取工具。翌日清淤发现渗水，暂不饮用，分配余水并托运输者取样请人检查。她获得一项有限进展，也背下了修井的责任。\n【章节大纲】\n第1章：黄昏抵达。沈蘅盘点剩水，查看废井，听伍成说风险。她问郑福交接文书由谁签字，以承担修缮责任换工具，决定翌日清井。停在工具交接，不抢写出水。\n第2章：翌日清井。承接工具、余水和签字责任。伍成清淤见渗水，但不能凭气味或颜色确认可饮。沈蘅分配有限饮水，安排送样与后续运输，不突然发明净水术。以随员先领到现有定量水、井水仍待确认收束。",
    },
    {
        "id": "medicine", "title": "药匣上的封签",
        "premise": "架空古代，刚被送到边地的县主许照发现随行药匣换过封签。她没有中毒证据，也不识药材；今晚仍须决定是否服用医官开的旧方。她只能通过交接记录和当面核对争取安全，不能直接给药定性。",
        "characters": "许照：县主，识字会核对记录，怕连累侍从，面对冲突先问经手过程。陈衡：随行医官，熟悉旧方但未见封签更换过程，不愿用自己的名声给未知药包作保。余顺：管药的内侍，因药匣淋雨曾换封签却漏记，怕受罚，是否还有隐情尚无证据。采青：侍女，记得雨天停宿处，关心许照能否安睡。",
        "outline": "【粗纲】\n许照察觉封签与记录不符，逐人核对经手过程。余顺承认雨中换签，陈衡只能确认方子，不能确认每一包药。许照请陈衡复核、把未知药包另存并留记录，付出得罪余顺和等待的代价。事件暂以重新配药、交接共同签字收束，不能证明谋杀也未消除全部戒心。\n【章节大纲】\n第1章：晚饭后许照查看药匣发现封签不同，请采青找记录，与余顺核对更换经过。余顺先回避，因记录对不上才承认淋雨换签。许照请陈衡来核对，停在人到齐，尚未给药定性。\n第2章：当夜在同屋核对。陈衡区分原方和药包来源，余顺顾虑受罚，许照提出记录各人实际经手范围，暂缓不明药包、重新配药。以签字和重新取药的实际行动收束，不揭露无铺垫幕后主使。",
    },
    {
        "id": "grain", "title": "少了七袋的粮车",
        "premise": "架空古代，女官陆宁奉命接管边县赈粮，到场发现交接簿写三十袋，车上只有二十三袋。百姓等粮，旧吏催她签收。她须厘清短缺并先应付今晚，不掌握任何人贪污的证据。",
        "characters": "陆宁：初任女官，会核账，不熟悉边县运输，想把事情做好又怕首日得罪全县。冯录：旧吏，知道七袋留在渡口，但没有拿到凭条；怕陆宁追责，想先签收再补。赵嫂：押车人，为腾车接运陷车的后队，将七袋粮临时寄在渡口，随后随前队先到县里，未拿凭条；想尽快回去照顾病儿，有自己的时间代价。程伯：领粥老人，关心今日能否开锅，不替女官喊口号。",
        "outline": "【粗纲】\n陆宁先点现粮，再核对运输和接收各自凭据，没有把数字差额直接定为贪污。赵嫂补充渡口转运经过，但空口不能结账。陆宁分开记录已收与待收，先按现粮开粥，派人索回缺粮与凭条，承担暂缓结清被上司询问的风险。次日补回六袋，最后一袋破损损耗，实记原因，不以一场打脸解决制度。\n【章节大纲】\n第1章：傍晚粮车到场，陆宁点袋，与冯录争论是否先签三十袋，再听赵嫂讲渡口。她记录实收二十三袋和待核七袋，安排按现粮开粥，停在派人去渡口。\n第2章：次日上午，接续昨日已发粮、未结凭条。带回六袋与破袋残粮，陆宁核对损耗，让有关人各记经手事实；冯录为难但能保住有据可查的交接。以补记损耗和下一次交接安排收束，不突然抓出巨贪。",
    },
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--real-model", action="store_true")
    parser.add_argument("--transport", choices=("api", "isolated"), required=True)
    parser.add_argument("--label", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--case", choices=[c["id"] for c in CASES], action="append")
    parser.add_argument("--base", default="https://jubencn.onesay.top/api/backend/studio")
    parser.add_argument("--config-file", type=Path)
    parser.add_argument("--thinking", choices=("provider-default", "disabled"), default="provider-default")
    args = parser.parse_args()
    if not args.real_model:
        parser.error("--real-model required: two paid chapter calls per selected case")
    if args.transport == "isolated" and not args.config_file:
        parser.error("isolated mode requires a server-local --config-file")
    if args.transport == "api" and args.thinking != "provider-default":
        parser.error("thinking overrides are isolated experiments only")
    args.output.mkdir(parents=True, exist_ok=True)
    report_path = args.output / "report.json"
    if report_path.exists():
        parser.error("Report exists; inspect saved IDs/results. No paid call was repeated.")
    cases = [c for c in CASES if not args.case or c["id"] in args.case]
    report = {"label": args.label, "transport": args.transport, "planned_calls": len(cases) * 2,
              "submitted_calls": 0, "thinking": args.thinking, "provider_calls": [], "results": [], "ok": False}

    def save(event):
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps({"event": event, "label": args.label, "calls": report["submitted_calls"]}, ensure_ascii=False), flush=True)

    def payload(case):
        return {"title": f"质量对照·{args.label}·{case['title']}", "content_type": "novel", "genre": "古代权谋与生存",
                "mode": "小说创作", "units": 2, "words_per_chapter": 1000, "audience": "female",
                "market": "china", "output_locale": "zh-CN", "premise": case["premise"],
                "characters": case["characters"], "outline": case["outline"],
                "novel_settings": {"form": "short_story", "perspective": "third_limited", "prose_style": "natural", "pacing": "balanced"}}

    def record(entry, number, result, elapsed):
        lines = [line.strip() for line in result["text"].splitlines() if line.strip()]
        stats = {"characters": len(result["text"]), "nonempty_lines": len(lines),
                 "short_lines_le_20": sum(len(line) <= 20 for line in lines), "max_line_characters": max(map(len, lines), default=0)}
        entry["chapters"].append({"number": number, "text": result["text"], "summary": result.get("summary"),
                                  "elapsed_seconds": round(elapsed, 2), "descriptive_stats_not_quality_score": stats})
        (args.output / f"{entry['case']}-{number}.txt").write_text(result["text"], encoding="utf-8")
        save(f"{entry['case']} chapter {number} saved")

    async def isolated():
        # Never point any imported studio component at the production DB.
        os.environ["DUANJU_STUDIO_DB"] = str(args.output.resolve() / "studio.sqlite3")
        from agent import studio_api as api, studio_novel
        from agent.studio_jobs import JobInput, JobStore, execute
        from agent.studio_store import StudioStore
        config_hash = hashlib.sha256(args.config_file.read_bytes()).hexdigest()
        api.llm._CFG_PATH = args.config_file
        api.llm._CFG_MTIME = args.config_file.stat().st_mtime
        api.llm._apply_cfg(json.loads(args.config_file.read_text(encoding="utf-8")))
        report["model"] = api.llm.MODEL
        if args.thinking == "disabled" and not (api.llm.MODEL.startswith(("deepseek-v4.1-flash", "deepseek-v4-1-flash"))
                                                 and urlsplit(api.llm.API_BASE).hostname == "ark.cn-beijing.volces.com"):
            raise RuntimeError("Thinking experiment requires the verified Ark DeepSeek V4.1 Flash route")
        report["novel_policy_sha256"] = hashlib.sha256(Path(studio_novel.__file__).read_bytes()).hexdigest()
        store = StudioStore(args.output / "studio.sqlite3")
        api.store = store
        # Fix planning inputs and omit live retrieval for a comparable experiment.
        api.reference_context = lambda work: []
        jobs = JobStore(store)
        for case in cases:
            work = store.create_work(api.WorkInput.model_validate(payload(case)).model_dump())
            entry = {"case": case["id"], "input": payload(case), "work_id": work["id"], "jobs": [], "chapters": []}
            report["results"].append(entry)
            for number in (1, 2):
                job = jobs.create(work["id"], JobInput(action="chapter", number=number, revision=work["revision"], request_key=str(uuid.uuid4())))
                entry["jobs"].append(job["id"])
                report["submitted_calls"] += 1
                save(f"{case['id']} chapter {number} submitted")
                start = time.monotonic()
                async def traced_generate(messages, **kwargs):
                    # Capture only this experiment's prompts/prose, never headers,
                    # configuration or raw transport exceptions.
                    trace = args.output / f"{case['id']}-{number}-request.json"
                    trace.write_text(json.dumps(messages, ensure_ascii=False, indent=2), encoding="utf-8")
                    original_client = api.llm.httpx.AsyncClient
                    class DiagnosticClient(original_client):
                        async def post(self, *positional, **options):
                            if args.thinking == "disabled":
                                options["json"] = {**options["json"], "thinking": {"type": "disabled"}}
                            response = await super().post(*positional, **options)
                            if response.status_code == 200:
                                data = response.json()
                                usage = data.get("usage", {})
                                detail = usage.get("completion_tokens_details") or {}
                                report["provider_calls"].append({"case": case["id"], "chapter": number,
                                    "finish_reason": data["choices"][0].get("finish_reason"),
                                    "tokens": {k: v for k, v in usage.items() if isinstance(v, int)},
                                    "reasoning_tokens": detail.get("reasoning_tokens")})
                            return response
                    api.llm.httpx.AsyncClient = DiagnosticClient
                    try:
                        raw = await api.llm.chat(messages, **kwargs)
                    finally:
                        api.llm.httpx.AsyncClient = original_client
                    (args.output / f"{case['id']}-{number}-response.txt").write_text(raw or "", encoding="utf-8")
                    report["last_response_kind"] = kwargs.get("err_box", {}).get("kind", "returned")
                    return raw
                done = await execute(jobs, jobs.claim(job["id"]), generate=traced_generate)
                if done["status"] != "completed":
                    entry["failed_job"] = {"id": job["id"], "error": done["error"]}
                    raise RuntimeError(f"Recorded job failed: {job['id']}")
                record(entry, number, done["results"][0], time.monotonic() - start)
                work = jobs.adopt(job["id"])
            store.archive_work(work["id"], True, work["revision"])
            entry["archived"] = True
        report["config_unchanged"] = hashlib.sha256(args.config_file.read_bytes()).hexdigest() == config_hash
        if not report["config_unchanged"]:
            raise RuntimeError("Configuration changed during comparison; do not treat runs as matched")

    def public_api():
        import httpx
        origin = "{0.scheme}://{0.netloc}".format(urlsplit(args.base))
        with httpx.Client(timeout=40, headers={"X-Duanju-Site": "china", "Origin": origin}) as client:
            def call(path, body=None, method=None):
                response = client.request(method or ("POST" if body is not None else "GET"), args.base.rstrip("/") + path, json=body)
                if response.status_code >= 400:
                    raise RuntimeError(f"HTTP {response.status_code} at {path}; inspect recorded IDs, no retry")
                return response.json()
            assert call("/session")["isolated"]
            # Keep only this newly created QA identity, privately, so an interrupted
            # run can be inspected/archived without creating another paid job.
            cookie_path = args.output / "space-cookie.json"
            descriptor = os.open(cookie_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                json.dump(dict(client.cookies), handle)
            status = call("/status")
            assert status["llm_ready"]
            report["platform_status"] = status
            for case in cases:
                work = call("/works", payload(case))
                entry = {"case": case["id"], "input": payload(case), "work_id": work["id"], "jobs": [], "chapters": []}
                report["results"].append(entry)
                save(f"{case['id']} isolated browser-space work created")
                for number in (1, 2):
                    job = call(f"/works/{work['id']}/jobs", {"action": "chapter", "number": number,
                               "revision": work["revision"], "request_key": str(uuid.uuid4())})
                    entry["jobs"].append(job["id"])
                    report["submitted_calls"] += 1
                    save(f"{case['id']} chapter {number} submitted")
                    start = time.monotonic()
                    while time.monotonic() - start < 600:
                        job = call(f"/jobs/{job['id']}")
                        if job["status"] not in {"queued", "running", "stopping"}:
                            break
                        time.sleep(3)
                    if job["status"] != "completed":
                        raise RuntimeError(f"Recorded job unfinished/failed: {job['id']}; no retry")
                    record(entry, number, job["results"][0], time.monotonic() - start)
                    work = call(f"/jobs/{job['id']}/adopt", {})
                call(f"/works/{work['id']}/archive", {"revision": work["revision"], "archived": True}, "PATCH")
                entry["archived"] = True

    save("started")
    try:
        if args.transport == "isolated":
            asyncio.run(isolated())
        else:
            public_api()
        report["ok"] = True
    except Exception as error:
        # Do not persist raw provider exceptions, configuration or credentials.
        report["error_type"] = type(error).__name__
        raise SystemExit("Comparison stopped; inspect saved report and job IDs. No automatic retry.") from None
    finally:
        save("finished")


if __name__ == "__main__":
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    main()
