"""Request scheduler, executor, cancellation, and SSE event streaming."""
from __future__ import annotations

import asyncio
import json
import time
import uuid
from collections.abc import AsyncIterator, Callable

import httpx

from models import ParsedRequest, RequestResult, RequestResultState, RunState, RunStatus, TestConfig
from parser import ParseError, parse_raw_request
from settings import MAX_RESPONSE_BODY_BYTES, MAX_STORED_RUNS, RUN_RETENTION_SECONDS
from substitution import generate_requests


_runs: dict[str, "RunContext"] = {}


def get_run(run_id: str) -> "RunContext | None":
    return _runs.get(run_id)


def list_runs() -> list[str]:
    return list(_runs.keys())


def active_run_count() -> int:
    return sum(
        ctx.status.state in {RunState.PENDING, RunState.RUNNING}
        for ctx in _runs.values()
    )


class RunContext:
    """Owns one run's state, cancellable task, and live subscribers."""

    def __init__(self, run_id: str, raw_request: str, config: TestConfig) -> None:
        self.run_id = run_id
        self.raw_request = raw_request
        self.config = config
        self.status = RunStatus(run_id=run_id, state=RunState.PENDING, total=config.count)
        self.created_at = time.monotonic()
        self.finished_at: float | None = None
        self._cancel_event = asyncio.Event()
        self._subscribers: dict[str, Callable[[RequestResult], None]] = {}
        self._task: asyncio.Task[None] | None = None

    def attach_task(self, task: asyncio.Task[None]) -> None:
        self._task = task

    def cancel(self) -> None:
        """Signal cancellation and interrupt in-flight tasks."""
        self._cancel_event.set()
        task = self._task
        if (
            self.status.state == RunState.RUNNING
            and task
            and not task.done()
            and task is not asyncio.current_task()
        ):
            task.cancel()

    @property
    def is_cancelled(self) -> bool:
        return self._cancel_event.is_set()

    def subscribe(self, callback: Callable[[RequestResult], None]) -> Callable[[], None]:
        subscription_id = str(uuid.uuid4())
        self._subscribers[subscription_id] = callback

        def unsubscribe() -> None:
            self._subscribers.pop(subscription_id, None)

        return unsubscribe

    def notify(self, result: RequestResult) -> None:
        for callback in list(self._subscribers.values()):
            try:
                callback(result)
            except Exception:
                pass


def _is_terminal(ctx: RunContext) -> bool:
    return ctx.status.state in {RunState.COMPLETED, RunState.STOPPED, RunState.ERROR}


def _purge_finished_runs() -> None:
    """Bound in-memory result retention without ever dropping active runs."""
    now = time.monotonic()
    for run_id, ctx in list(_runs.items()):
        if _is_terminal(ctx) and ctx.finished_at and now - ctx.finished_at > RUN_RETENTION_SECONDS:
            _runs.pop(run_id, None)

    finished = sorted(
        ((run_id, ctx) for run_id, ctx in _runs.items() if _is_terminal(ctx)),
        key=lambda item: item[1].finished_at or item[1].created_at,
    )
    while len(_runs) > MAX_STORED_RUNS and finished:
        run_id, _ = finished.pop(0)
        _runs.pop(run_id, None)


def create_run(raw_request: str, config: TestConfig) -> RunContext:
    _purge_finished_runs()
    run_id = str(uuid.uuid4())
    ctx = RunContext(run_id, raw_request, config)
    _runs[run_id] = ctx
    return ctx


def _request_headers(headers: dict[str, str]) -> dict[str, str]:
    """Let httpx calculate framing after substitutions change body length."""
    return {
        name: value
        for name, value in headers.items()
        if name.lower() not in {"content-length", "transfer-encoding"}
    }


async def _read_response_limited(response: httpx.Response) -> tuple[bytes, int, bool]:
    """Capture at most the response body limit without buffering all data."""
    chunks: list[bytes] = []
    captured = 0
    truncated = False

    async for chunk in response.aiter_bytes():
        remaining = MAX_RESPONSE_BODY_BYTES - captured
        if remaining <= 0:
            truncated = True
            break
        if len(chunk) > remaining:
            chunks.append(chunk[:remaining])
            captured += remaining
            truncated = True
            break
        chunks.append(chunk)
        captured += len(chunk)

    try:
        declared_size = int(response.headers.get("content-length", ""))
    except ValueError:
        declared_size = captured
    return b"".join(chunks), declared_size, truncated


def _update_progress(ctx: RunContext, start_wall: float, response_times: list[float]) -> None:
    status = ctx.status
    elapsed_total = (time.monotonic() - start_wall) * 1000
    status.elapsed_ms = round(elapsed_total, 2)
    if response_times:
        status.avg_response_time_ms = round(sum(response_times) / len(response_times), 2)
    remaining = max(0, status.total - status.completed)
    if status.completed:
        status.estimated_remaining_ms = round(remaining * (elapsed_total / status.completed), 2)


async def _wait_between_requests(ctx: RunContext) -> None:
    if not ctx.config.delay_ms or ctx.is_cancelled:
        return
    try:
        await asyncio.wait_for(ctx._cancel_event.wait(), timeout=ctx.config.delay_ms / 1000)
    except asyncio.TimeoutError:
        pass


async def execute_run(ctx: RunContext) -> None:
    """Run requests concurrently with worker tasks and always reach a terminal status."""
    status = ctx.status
    status.state = RunState.RUNNING
    start_wall = time.monotonic()
    response_times: list[float] = []

    try:
        if ctx.is_cancelled:
            return

        pairs = generate_requests(ctx.raw_request, ctx.config)
        status.total = len(pairs)
        concurrency = max(1, ctx.config.concurrency)

        item_queue: asyncio.Queue[tuple[int, int, str]] = asyncio.Queue()
        for index, (val, raw) in enumerate(pairs):
            item_queue.put_nowait((index, val, raw))

        async with httpx.AsyncClient(
            timeout=ctx.config.timeout_ms / 1000,
            follow_redirects=ctx.config.follow_redirects,
            limits=httpx.Limits(max_connections=concurrency * 2, max_keepalive_connections=concurrency),
        ) as client:

            async def worker():
                while not item_queue.empty():
                    if ctx.is_cancelled:
                        break
                    try:
                        index, value, substituted_raw = item_queue.get_nowait()
                    except asyncio.QueueEmpty:
                        break

                    if ctx.is_cancelled:
                        break

                    result = RequestResult(index=index + 1, value=value, state=RequestResultState.RUNNING)
                    status.results.append(result)
                    ctx.notify(result)

                    try:
                        parsed: ParsedRequest = parse_raw_request(
                            substituted_raw,
                            ctx.config.relative_url_scheme,
                        )
                    except ParseError as exc:
                        result.state = RequestResultState.ERROR
                        result.error = f"Parse error: {exc}"
                        status.completed += 1
                        status.failed += 1
                        _update_progress(ctx, start_wall, response_times)
                        ctx.notify(result)
                        item_queue.task_done()
                        if ctx.config.delay_ms > 0:
                            await _wait_between_requests(ctx)
                        continue

                    result.url = parsed.url
                    result.method = parsed.method
                    result.request_headers = _request_headers(parsed.headers)
                    result.request_body = parsed.body

                    request_started = time.monotonic()
                    try:
                        body = parsed.body.encode() if parsed.body is not None else None
                        async with client.stream(
                            method=parsed.method,
                            url=parsed.url,
                            headers=result.request_headers,
                            content=body,
                        ) as response:
                            content, response_size, truncated = await _read_response_limited(response)
                            result.status_code = response.status_code
                            result.response_time_ms = round((time.monotonic() - request_started) * 1000, 2)
                            result.response_size = response_size
                            result.response_headers = dict(response.headers)
                            result.response_body = _safe_decode(content, truncated)
                            result.response_truncated = truncated
                            result.state = RequestResultState.SUCCESS
                            status.successful += 1
                            response_times.append(result.response_time_ms)
                    except httpx.TimeoutException:
                        result.state = RequestResultState.ERROR
                        result.error = "Request timed out."
                        status.failed += 1
                    except httpx.ConnectError as exc:
                        result.state = RequestResultState.ERROR
                        result.error = f"Connection error: {exc}"
                        status.failed += 1
                    except httpx.RequestError as exc:
                        result.state = RequestResultState.ERROR
                        result.error = f"Request error: {exc}"
                        status.failed += 1

                    status.completed += 1
                    _update_progress(ctx, start_wall, response_times)
                    ctx.notify(result)
                    item_queue.task_done()

                    if ctx.config.delay_ms > 0:
                        await _wait_between_requests(ctx)

            num_workers = min(concurrency, max(1, len(pairs)))
            worker_tasks = [asyncio.create_task(worker()) for _ in range(num_workers)]
            await asyncio.gather(*worker_tasks, return_exceptions=True)

    except asyncio.CancelledError:
        ctx._cancel_event.set()
    except Exception as exc:
        status.state = RunState.ERROR
        status.error = f"Unexpected run error: {exc}"
    finally:
        for result in status.results:
            if result.state == RequestResultState.RUNNING:
                result.state = RequestResultState.CANCELLED
                status.completed += 1
                status.cancelled += 1
                ctx.notify(result)

        if status.state != RunState.ERROR:
            status.state = RunState.STOPPED if ctx.is_cancelled else RunState.COMPLETED
        status.elapsed_ms = round((time.monotonic() - start_wall) * 1000, 2)
        status.estimated_remaining_ms = 0
        ctx.finished_at = time.monotonic()


def stop_all_runs() -> int:
    count = 0
    for ctx in list(_runs.values()):
        if ctx.status.state in (RunState.PENDING, RunState.RUNNING):
            ctx.cancel()
            count += 1
    return count


async def stream_run_events(ctx: RunContext) -> AsyncIterator[str]:
    """Replay captured results, then stream updates until the run is terminal."""
    queue: asyncio.Queue[RequestResult] = asyncio.Queue()
    for existing_result in list(ctx.status.results):
        queue.put_nowait(existing_result)

    unsubscribe = ctx.subscribe(queue.put_nowait)
    try:
        while True:
            if _is_terminal(ctx):
                while not queue.empty():
                    yield _sse_event("result", (await queue.get()).model_dump())
                yield _sse_event("done", ctx.status.model_dump())
                return
            try:
                result = await asyncio.wait_for(queue.get(), timeout=1.0)
                yield _sse_event("result", result.model_dump())
            except asyncio.TimeoutError:
                yield _sse_event("progress", ctx.status.model_dump())
    finally:
        unsubscribe()


def _sse_event(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


def _safe_decode(content: bytes, truncated: bool = False) -> str:
    text = content.decode("utf-8", errors="replace")
    if truncated:
        text += f"\n\n[... response truncated after {MAX_RESPONSE_BODY_BYTES} bytes ...]"
    return text
