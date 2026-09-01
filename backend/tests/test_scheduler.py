"""Tests for the request scheduler."""
import os
import sys
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import asyncio
import httpx
import pytest

from models import RequestResultState, RunState, TestConfig
from scheduler import MAX_RESPONSE_BODY_BYTES, create_run, execute_run


def cfg(start=1, end=3, step=1, delay_ms=0, timeout_ms=5000, follow_redirects=False, concurrency=1):
    return TestConfig(
        start=start,
        end=end,
        step=step,
        delay_ms=delay_ms,
        timeout_ms=timeout_ms,
        concurrency=concurrency,
        follow_redirects=follow_redirects,
    )


RAW = "GET http://example.test/get?n=$"


class FakeResponse:
    def __init__(self, status=200, content=b'{"ok":true}', headers=None):
        self.status_code = status
        self.content = content
        self.headers = headers or {"content-type": "application/json"}

    async def aiter_bytes(self):
        yield self.content


class BlockingResponse(FakeResponse):
    def __init__(self):
        super().__init__()
        self.started = asyncio.Event()
        self.release = asyncio.Event()

    async def aiter_bytes(self):
        self.started.set()
        await self.release.wait()
        yield self.content


class ResponseContext:
    def __init__(self, response_or_error):
        self.response_or_error = response_or_error

    async def __aenter__(self):
        if isinstance(self.response_or_error, Exception):
            raise self.response_or_error
        return self.response_or_error

    async def __aexit__(self, *_args):
        return False


class FakeClient:
    def __init__(self, responses):
        self.responses = list(responses)
        self.sent = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return False

    def stream(self, **kwargs):
        self.sent.append(kwargs)
        return ResponseContext(self.responses.pop(0))


@pytest.mark.asyncio
async def test_results_in_order():
    ctx = create_run(RAW, cfg(1, 3))
    fake_client = FakeClient([FakeResponse() for _ in range(3)])

    with patch("scheduler.httpx.AsyncClient", return_value=fake_client):
        await execute_run(ctx)

    assert ctx.status.state == RunState.COMPLETED
    assert [result.value for result in ctx.status.results] == [1, 2, 3]
    assert ctx.status.successful == 3


@pytest.mark.asyncio
async def test_failed_requests_do_not_crash_run():
    ctx = create_run(RAW, cfg(1, 3))
    fake_client = FakeClient([
        FakeResponse(200),
        httpx.ConnectError("refused"),
        FakeResponse(404),
    ])

    with patch("scheduler.httpx.AsyncClient", return_value=fake_client):
        await execute_run(ctx)

    assert ctx.status.state == RunState.COMPLETED
    assert ctx.status.completed == 3
    assert [result.state for result in ctx.status.results] == [
        RequestResultState.SUCCESS,
        RequestResultState.ERROR,
        RequestResultState.SUCCESS,
    ]


@pytest.mark.asyncio
async def test_timeout_marks_result_as_error():
    ctx = create_run(RAW, cfg(1, 2))
    fake_client = FakeClient([httpx.TimeoutException("timeout"), httpx.TimeoutException("timeout")])

    with patch("scheduler.httpx.AsyncClient", return_value=fake_client):
        await execute_run(ctx)

    assert all(result.state == RequestResultState.ERROR for result in ctx.status.results)
    assert all("timed out" in (result.error or "") for result in ctx.status.results)


@pytest.mark.asyncio
async def test_cancellation_interrupts_an_inflight_request():
    ctx = create_run(RAW, cfg(1, 10))
    response = BlockingResponse()
    fake_client = FakeClient([response])

    with patch("scheduler.httpx.AsyncClient", return_value=fake_client):
        task = asyncio.create_task(execute_run(ctx))
        ctx.attach_task(task)
        await asyncio.wait_for(response.started.wait(), timeout=0.2)
        ctx.cancel()
        await asyncio.wait_for(task, timeout=0.2)

    assert ctx.status.state == RunState.STOPPED
    assert ctx.status.cancelled == 1
    assert ctx.status.results[0].state == RequestResultState.CANCELLED


@pytest.mark.asyncio
async def test_cancellation_before_a_task_starts_reaches_stopped_state():
    ctx = create_run(RAW, cfg(1, 2))
    fake_client = FakeClient([FakeResponse(), FakeResponse()])

    with patch("scheduler.httpx.AsyncClient", return_value=fake_client):
        task = asyncio.create_task(execute_run(ctx))
        ctx.attach_task(task)
        ctx.cancel()
        await asyncio.wait_for(task, timeout=0.2)

    assert ctx.status.state == RunState.STOPPED
    assert ctx.status.completed == 0
    assert not ctx.status.results


@pytest.mark.asyncio
async def test_scheduler_removes_stale_content_length_and_caps_response_body():
    raw = (
        "POST http://example.test/items\n"
        "Content-Length: 1\n"
        "Content-Type: text/plain\n\n"
        "$"
    )
    ctx = create_run(raw, cfg(100, 100))
    large_body = b"x" * (MAX_RESPONSE_BODY_BYTES + 10)
    fake_client = FakeClient([FakeResponse(200, large_body)])

    with patch("scheduler.httpx.AsyncClient", return_value=fake_client):
        await execute_run(ctx)

    result = ctx.status.results[0]
    assert "Content-Length" not in fake_client.sent[0]["headers"]
    assert fake_client.sent[0]["content"] == b"100"
    assert result.response_truncated is True
    assert "truncated" in (result.response_body or "")


@pytest.mark.asyncio
async def test_stats_track_responses_separately_from_transport_failures():
    ctx = create_run(RAW, cfg(1, 4))
    fake_client = FakeClient([
        FakeResponse(200),
        FakeResponse(200),
        httpx.ConnectError("refused"),
        FakeResponse(500),
    ])

    with patch("scheduler.httpx.AsyncClient", return_value=fake_client):
        await execute_run(ctx)

    assert ctx.status.successful == 3  # A response arrived, including HTTP 500.
    assert ctx.status.failed == 1
    assert ctx.status.completed == 4


@pytest.mark.asyncio
async def test_concurrent_worker_execution():
    ctx = create_run(RAW, cfg(1, 10, concurrency=5))
    fake_client = FakeClient([FakeResponse(200) for _ in range(10)])

    with patch("scheduler.httpx.AsyncClient", return_value=fake_client):
        await execute_run(ctx)

    assert ctx.status.state == RunState.COMPLETED
    assert ctx.status.completed == 10
    assert ctx.status.successful == 10
    assert len(fake_client.sent) == 10
