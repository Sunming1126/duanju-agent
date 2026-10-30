"""Safety gates for the opt-in paid probe; no network or real credentials."""
import json
from types import SimpleNamespace

import pytest
from tools import plotloom_llm_concurrency_probe as probe


def test_default_dry_run_never_creates_output_or_opens_a_client(tmp_path, monkeypatch, capsys):
    target=tmp_path/'not-created'
    monkeypatch.setattr('sys.argv',['probe','--report-dir',str(target)])
    monkeypatch.setattr(probe.httpx,'AsyncClient',lambda **kwargs:pytest.fail('Dry run must not construct a network client'))
    probe.main()
    result=json.loads(capsys.readouterr().out)
    assert result['dry_run'] is True
    assert result['stages']==[3,5,10,20,30,50,50]
    assert result['maximum_requests_if_all_stages_pass']==168
    assert result['retries']==0
    assert not target.exists()


@pytest.mark.parametrize('flags',[['--max-concurrency','51'],['--max-concurrency','0'],['--round-interval','60']])
def test_unsafe_limits_are_refused_before_any_model_access(tmp_path,monkeypatch,flags):
    monkeypatch.setattr('sys.argv',['probe','--real-model','--report-dir',str(tmp_path/'report'),*flags])
    with pytest.raises(SystemExit) as error:probe.arguments()
    assert error.value.code==2
    assert not (tmp_path/'report').exists()


def test_error_codes_cannot_contain_provider_error_messages_or_headers():
    assert probe.safe_code('TooManyRequests.ModelAccountRpmRateLimitExceeded')=='TooManyRequests.ModelAccountRpmRateLimitExceeded'
    assert probe.safe_code('Authorization: Bearer secret')=='unspecified'
    assert probe.safe_code('line\nwith\nsecret')=='unspecified'


def test_failed_round_stops_higher_concurrency_and_never_retries(tmp_path,monkeypatch):
    import asyncio
    data=tmp_path/'data';(data/'studio').mkdir(parents=True)
    (data/'llm_config.json').write_text('{}')
    output=tmp_path/'report';output.mkdir()
    args=SimpleNamespace(report_dir=output,max_concurrency=5,round_interval=61)
    report={'stages':[3,5,5],'rounds':[],'requests_submitted':0,'total_tokens_reported':0}
    original_sleep=asyncio.sleep
    seen=[];active=0;peak=0
    class Client:
        def __init__(self,**kwargs):pass
        async def __aenter__(self):return self
        async def __aexit__(self,*args):pass
        async def post(self,url,headers,json):
            nonlocal active,peak
            index=len(seen);seen.append(json);active+=1;peak=max(peak,active)
            await original_sleep(0)
            active-=1
            if index==1:return SimpleNamespace(status_code=429,headers={},json=lambda:{'error':{'code':'RateLimitExceeded'}})
            return SimpleNamespace(status_code=200,headers={},json=lambda:{'choices':[{'message':{'content':'OK'},'finish_reason':'stop'}],'usage':{'total_tokens':8}})
    monkeypatch.setattr(probe.httpx,'AsyncClient',Client)
    monkeypatch.setattr(probe,'queue_busy',lambda _:False)
    llm=SimpleNamespace(API_BASE='https://example.invalid',API_KEY='offline-dummy',MODEL='offline-dummy')
    asyncio.run(probe.probe(args,llm,data/'studio/studio.sqlite3',report))
    assert len(seen)==3 and peak==3
    assert report['stop_reason']=='first_unsuccessful_round_no_retry'
    assert len(report['rounds'])==1 and report['rounds'][0]['success']==2
    assert report['production_config_unchanged'] is True
    assert 'offline-dummy' not in (output/'report.json').read_text()
