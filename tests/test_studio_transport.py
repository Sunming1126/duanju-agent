"""Real transport payloads through an offline provider, no paid calls."""
import asyncio
from datetime import datetime,timedelta,timezone
from email.utils import format_datetime

import httpx
import pytest

from agent import llm,llm_transport,studio_stream
from agent.studio_rate_limits import throttle_info


@pytest.mark.parametrize('code,kind',[('TooManyRequests.QuotaExceeded','quota'),('InflightBatchsizeExceeded','concurrency'),('ModelAccountTpmRateLimitExceeded','tokens'),('ModelAccountRpmRateLimitExceeded','requests')])
def test_error_metadata_uses_only_codes_and_retry_header(code,kind):
    r=httpx.Response(429,json={'error':{'code':code,'message':'PRIVATE BODY MUST NOT BE SAVED'}},headers={'Retry-After':'95'})
    info=throttle_info(r)
    assert info['kind']=='rate_limit' and info['limit_type']==kind and info['retry_after_seconds']==95
    assert 'PRIVATE' not in str(info)


@pytest.mark.parametrize('value',['NaN','Infinity','-1','garbage'])
def test_malformed_retry_headers_are_not_forwarded(value):
    assert 'retry_after_seconds' not in throttle_info(httpx.Response(429,headers={'Retry-After':value}))


def test_http_date_retry_header_is_supported():
    r=httpx.Response(429,headers={'Retry-After':format_datetime(datetime.now(timezone.utc)+timedelta(seconds=120))})
    assert 118<=throttle_info(r)['retry_after_seconds']<=120


def test_stream_and_regular_calls_preserve_limit_reason_and_are_single_attempt(monkeypatch):
    calls=[];original=httpx.AsyncClient
    def respond(request):
        calls.append(request)
        return httpx.Response(429,json={'error':{'code':'QuotaExceeded','message':'private'}},headers={'Retry-After':'180'})
    monkeypatch.setattr(httpx,'AsyncClient',lambda **kwargs:original(transport=httpx.MockTransport(respond),**kwargs))
    monkeypatch.setattr(llm,'_refresh_config',lambda:None)
    monkeypatch.setattr(llm,'API_BASE','https://example.invalid')
    monkeypatch.setattr(llm,'API_KEY','offline-only')
    async def check():
        first={};second={}
        assert await llm.chat([{'role':'user','content':'offline'}],retries=1,err_box=first) is None
        async def preview(text):pytest.fail('A rejected stream must not produce preview text')
        assert await studio_stream.chat_outline([{'role':'user','content':'offline'}],on_text=preview,err_box=second) is None
        for info in [first,second]:
            assert info['limit_type']=='quota' and info['retry_after_seconds']==180 and info['attempts']==1
    asyncio.run(check())
    assert len(calls)==2


def test_worker_pool_is_reused_and_closed_and_does_not_escape_its_scope(monkeypatch):
    created=[]
    class Client:
        def __init__(self,**kwargs):self.closed=False;created.append(self)
        async def __aenter__(self):return self
        async def __aexit__(self,*args):self.closed=True
    monkeypatch.setattr(httpx,'AsyncClient',Client)
    async def check():
        async with llm_transport.worker_connections(5):
            async def call():
                async with llm_transport.request_client(240) as client:return client
            first,second=await asyncio.gather(call(),call())
            assert first is second and len(created)==1 and not first.closed
        assert first.closed
        async with llm_transport.request_client(90) as standalone:assert standalone is not first
        assert standalone.closed and len(created)==2
    asyncio.run(check())


def test_regular_timeout_has_distinct_kind_and_no_automatic_retry(monkeypatch):
    calls = []
    async def post(client, url, **kwargs):
        calls.append(kwargs['json'])
        raise httpx.ReadTimeout('PRIVATE UPSTREAM DETAIL')
    monkeypatch.setattr(llm, '_refresh_config', lambda: None)
    monkeypatch.setattr(llm, 'MODEL', 'deepseek-v4.1-flash')
    monkeypatch.setattr(httpx.AsyncClient, 'post', post)
    err = {}
    assert asyncio.run(llm.chat([{'role':'user','content':'offline'}], retries=1, err_box=err)) is None
    assert err == {'kind':'timeout', 'status':0, 'attempts':1} and len(calls) == 1
    # Optional Studio thinking control does not alter legacy callers.
    assert 'thinking' not in calls[0]


def test_stream_truncation_retains_usage_not_reasoning_or_payload(monkeypatch):
    import json
    from agent.studio_generation import failure_details
    packets = [
        {'choices':[{'delta':{'reasoning_content':'PRIVATE REASONING'},'finish_reason':None}]},
        {'choices':[{'delta':{'content':'【粗纲】\n尚未完成的全篇计划'},'finish_reason':None}]},
        {'choices':[{'delta':{},'finish_reason':'length'}]},
        {'choices':[], 'usage':{'prompt_tokens':100,'completion_tokens':24000,
            'completion_tokens_details':{'reasoning_tokens':23500}, 'private':'SECRET'}},
    ]
    body = '\n\n'.join('data: '+json.dumps(p) for p in packets) + '\n\ndata: [DONE]\n\n'
    calls = []; original = httpx.AsyncClient
    def respond(request):
        calls.append(request)
        return httpx.Response(200, content=body.encode())
    monkeypatch.setattr(httpx, 'AsyncClient', lambda **kw:original(transport=httpx.MockTransport(respond), **kw))
    monkeypatch.setattr(llm, '_refresh_config', lambda:None)
    previews = []
    async def preview(text):previews.append(text)
    err = {}
    assert asyncio.run(studio_stream.chat_outline([{'role':'user','content':'offline'}], on_text=preview, err_box=err)) is None
    assert len(calls) == 1 and err['finish_reason'] == 'length'
    assert err['completion_tokens'] == 24000 and err['reasoning_tokens'] == 23500
    assert len(previews) == 1 and 'PRIVATE' not in str(previews)
    assert 'PRIVATE' not in str(err) and 'SECRET' not in str(err)
    assert 'PRIVATE' not in str(failure_details({'kind':'PRIVATE', 'status':'SECRET'}, {}))


def test_stream_timeout_is_not_reported_as_output_truncation(monkeypatch):
    original = httpx.AsyncClient
    def respond(request):raise httpx.ReadTimeout('private')
    monkeypatch.setattr(httpx, 'AsyncClient', lambda **kw:original(transport=httpx.MockTransport(respond), **kw))
    monkeypatch.setattr(llm, '_refresh_config', lambda:None)
    async def preview(text):pytest.fail('No content arrived')
    err = {}
    assert asyncio.run(studio_stream.chat_outline([{'role':'user','content':'offline'}], on_text=preview, err_box=err)) is None
    assert err == {'kind':'timeout', 'status':0, 'attempts':1}
