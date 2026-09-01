"""Central, environment-backed limits for the local Reqerer service."""
from __future__ import annotations

import os


def _positive_int(name: str, default: int, *, minimum: int = 1) -> int:
    try:
        return max(minimum, int(os.getenv(name, default)))
    except ValueError:
        return default


MAX_REQUESTS_PER_RUN = _positive_int("REQERER_MAX_REQUESTS_PER_RUN", 1_000)
MAX_RESPONSE_BODY_BYTES = _positive_int("REQERER_MAX_RESPONSE_BODY_BYTES", 64 * 1024)
RUN_RETENTION_SECONDS = _positive_int("REQERER_RUN_RETENTION_SECONDS", 900)
MAX_STORED_RUNS = _positive_int("REQERER_MAX_STORED_RUNS", 25)
MAX_ACTIVE_RUNS = _positive_int("REQERER_MAX_ACTIVE_RUNS", 1)

# Powering off a computer from an HTTP route is intentionally disabled unless a
# local operator explicitly enables it before starting the backend.
PC_SHUTDOWN_ENABLED = os.getenv("REQERER_ENABLE_PC_SHUTDOWN", "").lower() in {
    "1", "true", "yes",
}


def allowed_origins() -> list[str]:
    configured = os.getenv("REQERER_ALLOWED_ORIGINS", "")
    if configured:
        return [origin.strip() for origin in configured.split(",") if origin.strip()]
    return ["http://localhost:5173", "http://127.0.0.1:5173"]
