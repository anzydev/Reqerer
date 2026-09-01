# Reqerer

Reqerer is a high-performance HTTP request testing and benchmarking platform. It provides concurrent load testing, raw HTTP syntax editing, real-time SSE streaming, and a local proxy engine.

## Features

- **Intruder Load Tester**: Send requests concurrently with a configurable worker pool (1–100 threads) or sequentially with custom delays.
- **Flexible Payload Injection**: Inject incrementing numeric values at `$` markers, or omit markers to benchmark identical requests repeatedly. Write `$$` for a literal dollar sign.
- **Live Streamed Results**: Inspect response status, duration, response size, headers, and formatted JSON bodies via Server-Sent Events (SSE).
- **Mute Logs Mode**: Toggle log rendering off during high-volume benchmarks for maximum throughput without browser lag.
- **HTTP Proxy & History**: Built-in proxy on `127.0.0.1:8082` with HTTPS CONNECT tunneling, CA certificate generation, request hold/forward/drop, and traffic categorization (API, JS, CSS, Media, HTML, Tunnels). *(Intercept view is currently marked under maintenance).*
- **Safety Controls**: Graceful cancellation of active network tasks, backend disconnect toggle, and safety shutdown slider.

## Quick Start

```bash
./start.sh
```

- Frontend: <http://localhost:5173>
- Backend API: <http://127.0.0.1:8001>
- Proxy Port: `127.0.0.1:8082`

For backend auto-reload during development:

```bash
REQERER_DEV_RELOAD=1 ./start.sh
```

To run backend and frontend separately:

```bash
# Backend
cd backend
python3 -m uvicorn main:app --host 127.0.0.1 --port 8001

# Frontend
cd frontend
npm run dev
```

## Configuration

Environment variables:

| Variable | Description | Default |
| :--- | :--- | :--- |
| `REQERER_MAX_RESPONSE_BODY_BYTES` | Maximum captured response body size | `65536` |
| `REQERER_RUN_RETENTION_SECONDS` | In-memory retention for completed runs | `900` |
| `REQERER_MAX_STORED_RUNS` | Maximum completed runs kept in memory | `25` |
| `REQERER_MAX_ACTIVE_RUNS` | Maximum concurrent test runs allowed | `1` |
| `REQERER_ENABLE_PC_SHUTDOWN` | Set to `1` to enable local system shutdown action | `0` |
| `REQERER_ALLOWED_ORIGINS` | Comma-separated allowed CORS origins | `http://localhost:5173` |

## Testing

```bash
# Backend unit tests (54 tests)
python3 -m pytest backend/tests -v

# Frontend typecheck and production build
cd frontend && npx tsc --noEmit && npm run build
```

## Tech Stack

- **Frontend**: React 19, TypeScript, CodeMirror 6, Vite
- **Backend**: FastAPI, Uvicorn, httpx, asyncio, pytest
