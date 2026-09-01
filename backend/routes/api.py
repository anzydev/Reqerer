"""FastAPI routes for the HTTP Request Testing Platform."""
from __future__ import annotations

import asyncio
import os
import platform
import subprocess
import signal
import time
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from models import (
    ParseResponse,
    PreviewResponse,
    RunRequest,
    RunState,
    RunStatus,
    TestConfig,
)
from parser import ParseError, count_substitution_markers, parse_raw_request
from scheduler import active_run_count, create_run, execute_run, get_run, stop_all_runs, stream_run_events
from settings import MAX_ACTIVE_RUNS, MAX_REQUESTS_PER_RUN, PC_SHUTDOWN_ENABLED
from substitution import (
    extract_substitution_param_names,
    generate_values,
    substitute,
)

router = APIRouter(prefix="/api")


def _validate_run_config(config: TestConfig) -> None:
    if config.count == 0:
        raise HTTPException(status_code=422, detail="Configuration produces 0 requests.")


# ── Parse ─────────────────────────────────────────────────────────────────────


class ParseBody(BaseModel):
    raw_request: str


@router.post("/parse", response_model=ParseResponse)
async def parse_request(body: ParseBody) -> ParseResponse:
    """Parse and validate a raw HTTP request."""
    try:
        parsed = parse_raw_request(body.raw_request)
    except ParseError as e:
        raise HTTPException(status_code=422, detail=str(e))

    marker_count = count_substitution_markers(body.raw_request)
    warnings: list[str] = []
    if marker_count == 0:
        warnings.append("No $ substitution markers found in the request.")

    return ParseResponse(
        parsed=parsed,
        substitution_count=marker_count,
        warnings=warnings,
    )


# ── Preview ───────────────────────────────────────────────────────────────────


class PreviewBody(BaseModel):
    raw_request: str
    config: TestConfig


@router.post("/preview", response_model=PreviewResponse)
async def preview_test(body: PreviewBody) -> PreviewResponse:
    """Generate a preview of the test without executing it."""
    try:
        parsed = parse_raw_request(body.raw_request, body.config.relative_url_scheme)
    except ParseError as e:
        raise HTTPException(status_code=422, detail=str(e))

    config = body.config
    _validate_run_config(config)
    values = generate_values(config)
    count = len(values)

    base_overhead_s = 0.1
    estimated_seconds = count * (config.delay_ms / 1000 + base_overhead_s)

    params = extract_substitution_param_names(body.raw_request)

    first_req = substitute(body.raw_request, values[0]) if values else None
    last_req = substitute(body.raw_request, values[-1]) if len(values) > 1 else None

    parsed_url = urlparse(parsed.url)
    target = parsed_url.netloc or parsed.url

    return PreviewResponse(
        target=target,
        method=parsed.method,
        count=count,
        estimated_seconds=round(estimated_seconds, 1),
        substitution_params=params,
        first_request=first_req,
        last_request=last_req,
    )


# ── Run ───────────────────────────────────────────────────────────────────────


class StartRunResponse(BaseModel):
    run_id: str


@router.post("/run", response_model=StartRunResponse)
async def start_run(body: RunRequest) -> StartRunResponse:
    """Start a new test run. Returns run_id immediately."""
    try:
        parse_raw_request(body.raw_request, body.config.relative_url_scheme)
    except ParseError as e:
        raise HTTPException(status_code=422, detail=str(e))

    _validate_run_config(body.config)
    if active_run_count() >= MAX_ACTIVE_RUNS:
        raise HTTPException(
            status_code=409,
            detail=f"Only {MAX_ACTIVE_RUNS} active run(s) are allowed at once.",
        )

    ctx = create_run(body.raw_request, body.config)
    task = asyncio.create_task(_run_task(ctx), name=f"reqerer-run-{ctx.run_id}")
    ctx.attach_task(task)
    return StartRunResponse(run_id=ctx.run_id)


async def _run_task(ctx) -> None:
    try:
        await execute_run(ctx)
    except asyncio.CancelledError:
        ctx.cancel()
        ctx.status.state = RunState.STOPPED
        ctx.status.estimated_remaining_ms = 0
        ctx.finished_at = time.monotonic()
    except Exception as exc:
        ctx.status.state = RunState.ERROR
        ctx.status.error = f"Unexpected run error: {exc}"
        ctx.finished_at = time.monotonic()


@router.get("/run/{run_id}/stream")
async def stream_run(run_id: str):
    """SSE endpoint: streams live results for a test run."""
    ctx = get_run(run_id)
    if ctx is None:
        raise HTTPException(status_code=404, detail="Run not found.")

    async def event_generator():
        async for chunk in stream_run_events(ctx):
            yield chunk

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/run/{run_id}/stop")
async def stop_run(run_id: str) -> dict:
    """Cancel a running test."""
    ctx = get_run(run_id)
    if ctx is None:
        raise HTTPException(status_code=404, detail="Run not found.")
    ctx.cancel()
    return {"status": "stopping", "run_id": run_id}


# ── System Control Routes ─────────────────────────────────────────────────────


class AppConfigResponse(BaseModel):
    pc_shutdown_enabled: bool
    max_requests_per_run: int
    max_active_runs: int


@router.get("/config", response_model=AppConfigResponse)
async def app_config() -> AppConfigResponse:
    """Expose only non-sensitive feature flags needed by the local UI."""
    return AppConfigResponse(
        pc_shutdown_enabled=PC_SHUTDOWN_ENABLED,
        max_requests_per_run=MAX_REQUESTS_PER_RUN,
        max_active_runs=MAX_ACTIVE_RUNS,
    )


@router.post("/kill-all")
async def kill_all() -> dict:
    """Kill all active runs."""
    stopped = stop_all_runs()
    return {"status": "ok", "stopped_runs": stopped}


@router.post("/shutdown")
async def shutdown_backend() -> dict:
    """Stop all active runs and shutdown the backend server process."""
    stop_all_runs()
    asyncio.get_running_loop().call_later(0.5, lambda: os.kill(os.getpid(), signal.SIGTERM))
    return {"status": "shutting_down"}


@router.post("/shutdown-pc")
async def shutdown_pc() -> dict:
    """Kill all runs and issue OS shutdown command for Mac or Windows."""
    stop_all_runs()

    sys_name = platform.system().lower()
    cmd: list[str] = []

    if "darwin" in sys_name or "mac" in sys_name:
        mac_script = (
            'try\n'
            '  tell application "Finder" to shut down\n'
            'on error\n'
            '  tell application "System Events" to shut down\n'
            'end try'
        )
        cmd = ["osascript", "-e", mac_script]
    elif "windows" in sys_name:
        cmd = ["shutdown", "/s", "/t", "0"]
    else:
        cmd = ["shutdown", "-h", "now"]

    try:
        subprocess.Popen(cmd)
        return {"status": "pc_shutting_down", "os": sys_name, "cmd": " ".join(cmd)}
    except Exception as e:
        return {
            "status": "cloud_or_restricted",
            "message": "All test runs stopped. Physical PC shutdown is only available when running locally on your computer.",
            "detail": str(e),
        }


@router.get("/run/{run_id}", response_model=RunStatus)
async def get_run_status(run_id: str) -> RunStatus:
    """Get current state and results for a run."""
    ctx = get_run(run_id)
    if ctx is None:
        raise HTTPException(status_code=404, detail="Run not found.")
    return ctx.status
