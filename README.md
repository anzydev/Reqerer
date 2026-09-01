# Reqerer

A fast, browser-based HTTP request testing and benchmarking platform. Write raw HTTP requests, inject dynamic payload values, and stream concurrent attack runs in real time.

---

## Key Features

- **Raw HTTP Editor**: Write and edit requests with full syntax highlighting powered by CodeMirror 6.
- **Payload Injection**: Insert `$` markers (e.g. `{"id": "$2$"}` or `/user?id=$`) to substitute incrementing values across requests. Use `$$` for a literal dollar sign.
- **Concurrent Worker Pool**: Execute attacks across 1–100 threads with custom delays (ms) and timeout limits.
- **Live Streamed Results**: Stream response status, latency, headers, and formatted JSON bodies via Server-Sent Events (SSE).
- **Mute Logs Mode**: Suppress individual log rendering during large-scale benchmarks to maximize browser performance.
- **Cloud & Local Support**: Runs directly in the browser with auto-connect to the cloud API, or fully offline on `localhost`.

---

## Local Development

Start both frontend and backend with a single command:

```bash
./start.sh
```

- **Frontend**: `http://localhost:5173`
- **Backend API**: `http://127.0.0.1:8001`
- **Proxy Port**: `127.0.0.1:8082`

### Running Separately

**Backend (FastAPI)**:
```bash
cd backend
python3 -m uvicorn main:app --host 127.0.0.1 --port 8001 --reload
```

**Frontend (React + Vite)**:
```bash
cd frontend
npm install
npm run dev
```

---

## How It Works

1. **Craft Request**: Enter your raw HTTP request in the left panel. Add a `$` marker where you want numeric values injected:
   ```http
   POST /api/items HTTP/1.1
   Host: example.com
   Content-Type: application/json

   {"id": "$1$", "name": "Item"}
   ```
2. **Configure Attack**:
   - **Total Requests**: Total number of requests to fire (`> 0`).
   - **Concurrency (Threads)**: Number of parallel workers (`1–100`).
   - **Delay (ms)**: Pause duration between requests (`>= 0`).
3. **Run & Inspect**: Click **▶ Start Run**. Results stream live into the results table with expandable request/response inspection.

---

## Environment Variables

| Variable | Description | Default |
| :--- | :--- | :--- |
| `VITE_API_BASE_URL` | Frontend backend API URL | `https://reqerer-backend.onrender.com` (prod) / `http://127.0.0.1:8001` (local) |
| `REQERER_ALLOWED_ORIGINS` | Comma-separated CORS allowed origins | `https://reqerer.vercel.app,http://localhost:5173` |
| `REQERER_MAX_RESPONSE_BODY_BYTES` | Maximum captured response body size | `65536` (64 KB) |
| `REQERER_MAX_ACTIVE_RUNS` | Maximum concurrent runs per backend | `1` |
| `REQERER_MAX_STORED_RUNS` | Maximum historical runs retained in memory | `25` |
| `REQERER_RUN_RETENTION_SECONDS` | In-memory run retention TTL | `900` (15 min) |

---

## Testing & Verification

```bash
# Run backend test suite (54 unit & integration tests)
python3 -m pytest backend/tests -v

# Run frontend typecheck and build
cd frontend && npx tsc --noEmit && npm run build
```

---

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite, CodeMirror 6
- **Backend**: FastAPI, Uvicorn, httpx (HTTP/2 connection pooling), asyncio
- **Deployment**: Vercel (Edge Frontend), Render (Cloud API)
