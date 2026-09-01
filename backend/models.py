from __future__ import annotations
from enum import Enum
from typing import Literal, Optional
from pydantic import BaseModel, Field


class ParsedRequest(BaseModel):
    method: str
    url: str
    headers: dict[str, str]
    body: Optional[str] = None
    raw: str  # The original raw text


class TestConfig(BaseModel):
    # Prevent pytest from mistaking this Pydantic model for a test class when it
    # is imported into test modules.
    __test__ = False

    start: int = Field(1, description="Start value (inclusive)")
    end: int = Field(10, description="End value (inclusive)")
    step: int = Field(1, ge=1, description="Step between values")
    delay_ms: int = Field(0, ge=0, description="Delay between requests in ms")
    timeout_ms: int = Field(10000, ge=500, description="Per-request timeout in ms")
    concurrency: int = Field(5, ge=1, le=100, description="Concurrent worker threads")
    follow_redirects: bool = Field(True, description="Follow HTTP redirects")
    relative_url_scheme: Literal["http", "https"] = Field(
        "http",
        description="Scheme to use when a raw request has a relative URL and Host header",
    )

    @property
    def count(self) -> int:
        if self.start > self.end:
            return 0
        return len(range(self.start, self.end + 1, self.step))

    @property
    def estimated_seconds(self) -> float:
        parallelism = max(1, self.concurrency)
        base_time = (self.count / parallelism) * (self.delay_ms / 1000)
        est_network = (self.count / parallelism) * (self.timeout_ms / 1000 * 0.05)
        return round(base_time + est_network, 2)


class RunRequest(BaseModel):
    raw_request: str
    config: TestConfig


class RequestResultState(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    ERROR = "error"
    CANCELLED = "cancelled"


class RequestResult(BaseModel):
    index: int
    value: int
    state: RequestResultState = RequestResultState.PENDING
    status_code: Optional[int] = None
    response_time_ms: Optional[float] = None
    response_size: Optional[int] = None
    request_headers: Optional[dict[str, str]] = None
    request_body: Optional[str] = None
    response_headers: Optional[dict[str, str]] = None
    response_body: Optional[str] = None
    response_truncated: bool = False
    error: Optional[str] = None
    url: Optional[str] = None
    method: Optional[str] = None


class RunState(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    STOPPED = "stopped"
    ERROR = "error"


class RunStatus(BaseModel):
    run_id: str
    state: RunState
    results: list[RequestResult] = Field(default_factory=list)
    total: int = 0
    completed: int = 0
    successful: int = 0
    failed: int = 0
    cancelled: int = 0
    avg_response_time_ms: Optional[float] = None
    elapsed_ms: Optional[float] = None
    estimated_remaining_ms: Optional[float] = None
    error: Optional[str] = None


class ParseResponse(BaseModel):
    parsed: ParsedRequest
    substitution_count: int
    warnings: list[str] = Field(default_factory=list)


class PreviewResponse(BaseModel):
    target: str
    method: str
    count: int
    estimated_seconds: float
    substitution_params: list[str]
    first_request: Optional[str] = None
    last_request: Optional[str] = None
