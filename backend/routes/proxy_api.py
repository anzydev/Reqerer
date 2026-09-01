"""FastAPI routes for the Reqerer Interceptor Proxy."""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import time
import urllib.parse
import uuid

import httpx
from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from proxy_server import CA_CERT_PATH, ProxyHistoryItem, proxy_manager

router = APIRouter(prefix="/api/proxy")


class ToggleBody(BaseModel):
    enabled: bool


class ForwardBody(BaseModel):
    item_id: str
    raw_request: str


class DropBody(BaseModel):
    item_id: str


class OpenBrowserBody(BaseModel):
    url: str = "https://www.google.com"


@router.post("/toggle")
async def toggle_intercept(body: ToggleBody) -> dict:
    """Turn proxy intercept mode ON or OFF."""
    proxy_manager.set_intercept(body.enabled)
    return {"status": "ok", "intercept_enabled": proxy_manager.intercept_enabled}


@router.get("/status")
async def get_proxy_status() -> dict:
    """Get proxy status, active intercepted item, and port info."""
    active_dict = proxy_manager.active_item.to_dict() if proxy_manager.active_item else None
    return {
        "intercept_enabled": proxy_manager.intercept_enabled,
        "proxy_port": 8082,
        "proxy_host": "127.0.0.1",
        "active_item": active_dict,
        "history_count": len(proxy_manager.history),
    }


@router.post("/forward")
async def forward_intercepted(body: ForwardBody) -> dict:
    """Forward an intercepted request with optional user edits."""
    ok = proxy_manager.forward_request(body.item_id, body.raw_request)
    if not ok:
        raise HTTPException(status_code=404, detail="Intercepted request not found or already processed.")
    return {"status": "forwarded", "item_id": body.item_id}


@router.post("/drop")
async def drop_intercepted(body: DropBody) -> dict:
    """Drop an intercepted request."""
    ok = proxy_manager.drop_request(body.item_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Intercepted request not found or already processed.")
    return {"status": "dropped", "item_id": body.item_id}


@router.get("/history")
async def get_proxy_history() -> list[dict]:
    """Get list of captured requests and responses."""
    return [item.to_dict() for item in proxy_manager.history]


@router.post("/clear-history")
async def clear_proxy_history() -> dict:
    """Clear all captured HTTP proxy history."""
    proxy_manager.clear_history()
    return {"status": "cleared"}


@router.get("/ca.crt")
async def download_ca_cert():
    """Download the generated Root CA Certificate for browser trust."""
    if not os.path.exists(CA_CERT_PATH):
        from proxy_server import ensure_ca_certificate
        ensure_ca_certificate()

    return FileResponse(
        CA_CERT_PATH,
        media_type="application/x-x509-ca-cert",
        filename="reqerer-ca.crt",
    )


@router.get("/stream")
async def stream_proxy_events():
    """SSE stream for live proxy events (intercepted requests, history updates)."""
    q = proxy_manager.subscribe()

    async def event_generator():
        try:
            while True:
                msg = await q.get()
                yield msg
        finally:
            proxy_manager.unsubscribe(q)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/open-browser")
async def open_proxy_browser(body: OpenBrowserBody) -> dict:
    """Launch a standalone Chromium/Chrome browser window pre-configured with proxy 127.0.0.1:8082."""
    target_url = body.url if body.url.startswith("http") else f"https://{body.url}"
    proxy_arg = "--proxy-server=http://127.0.0.1:8082"
    user_data_arg = "--user-data-dir=/tmp/reqerer_browser_profile"

    candidates = []
    if sys.platform == "darwin":
        candidates = [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
            "/Applications/Arc.app/Contents/MacOS/Arc",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        ]
    elif sys.platform == "win32":
        candidates = [
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe",
        ]
    else:  # Linux
        candidates = ["google-chrome", "chromium-browser", "chromium", "brave-browser"]

    launched = False
    for executable in candidates:
        if os.path.exists(executable) or shutil.which(executable):
            try:
                subprocess.Popen(
                    [
                        executable,
                        "--new-window",
                        "--no-first-run",
                        proxy_arg,
                        user_data_arg,
                        "--ignore-certificate-errors",
                        target_url,
                    ],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                )
                launched = True
                break
            except Exception:
                continue

    if not launched:
        if sys.platform == "darwin":
            subprocess.Popen(["open", "-na", "Google Chrome", "--args", proxy_arg, user_data_arg, "--ignore-certificate-errors", target_url])
        else:
            import webbrowser
            webbrowser.open(target_url)

    return {
        "status": "launched",
        "proxy": "127.0.0.1:8082",
        "target_url": target_url,
    }


def _normalize_target_url(raw_url: str) -> str:
    """Normalize target URLs and append frame-compatible flags for Google."""
    url = raw_url.strip()
    if not url.startswith("http://") and not url.startswith("https://"):
        url = f"https://{url}"

    parsed = urllib.parse.urlparse(url)
    host = parsed.netloc.lower()

    if "google." in host:
        path = parsed.path
        query = parsed.query
        params = urllib.parse.parse_qs(query)

        if "igu" not in params:
            params["igu"] = ["1"]
            new_query = urllib.parse.urlencode(params, doseq=True)
            if path in ("", "/"):
                path = "/webhp"
            url = urllib.parse.urlunparse((
                parsed.scheme,
                parsed.netloc,
                path,
                parsed.params,
                new_query,
                parsed.fragment,
            ))

    return url


@router.api_route("/view", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"])
async def proxy_view_target(request: Request, url: str):
    """Proxy tunnel endpoint for embedded target web browser frame."""
    if not url:
        raise HTTPException(status_code=400, detail="Target URL required")

    url = _normalize_target_url(url)
    parsed_target = urllib.parse.urlparse(url)

    # Self-framing recursion guard: Disallow proxying Reqerer's own UI
    if parsed_target.netloc in ("localhost:5173", "127.0.0.1:5173", "localhost:8001", "127.0.0.1:8001"):
        return Response(
            content="Self-proxying Reqerer UI inside itself is disabled.",
            status_code=400,
            media_type="text/plain",
        )

    method = request.method
    headers_dict = dict(request.headers)

    body_bytes = await request.body()
    body_text = body_bytes.decode("utf-8", errors="replace") if body_bytes else None

    # Format raw HTTP string for Intercept Engine
    raw_lines = [f"{method} {url} HTTP/1.1"]
    if parsed_target.netloc:
        raw_lines.append(f"Host: {parsed_target.netloc}")

    for k, v in headers_dict.items():
        if k.lower() not in ("host", "connection", "accept-encoding", "content-length", "referer", "origin", "sec-fetch-dest", "sec-fetch-mode"):
            raw_lines.append(f"{k}: {v}")

    raw_request_text = "\r\n".join(raw_lines)
    if body_text:
        raw_request_text += f"\r\n\r\n{body_text}"
    else:
        raw_request_text += "\r\n\r\n"

    item_id = str(uuid.uuid4())[:8]
    item = ProxyHistoryItem(
        item_id=item_id,
        method=method,
        url=url,
        host=parsed_target.netloc or "target",
        raw_request=raw_request_text,
    )

    # Pass through Intercept Engine!
    action, final_raw = await proxy_manager.intercept_request(item)

    if action == "drop":
        item.state = "dropped"
        proxy_manager.update_history(item)
        return Response(
            content="Request dropped by user in Intercept Mode.",
            status_code=502,
            media_type="text/plain",
        )

    # Forward request to target
    item.state = "forwarding"
    item.raw_request = final_raw
    start_time = time.monotonic()

    try:
        from parser import parse_raw_request
        parsed = parse_raw_request(final_raw)

        headers = dict(parsed.headers)
        if "User-Agent" not in headers and "user-agent" not in headers:
            headers["User-Agent"] = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            res = await client.request(
                method=parsed.method,
                url=parsed.url,
                headers=headers,
                content=parsed.body.encode("utf-8") if parsed.body else None,
            )

            elapsed_ms = (time.monotonic() - start_time) * 1000
            res_bytes = res.content
            content_type = res.headers.get("content-type", "text/html")

            item.state = "completed"
            item.status_code = res.status_code
            item.response_time_ms = round(elapsed_ms, 1)
            item.response_size = len(res_bytes)
            item.response_headers = dict(res.headers)
            item.response_body = res.text[:100000]
            proxy_manager.update_history(item)

            clean_headers = {}
            for k, v in res.headers.items():
                if k.lower() not in (
                    "x-frame-options",
                    "content-security-policy",
                    "content-security-policy-report-only",
                    "frame-options",
                    "cross-origin-opener-policy",
                    "cross-origin-embedder-policy",
                    "cross-origin-resource-policy",
                    "content-encoding",
                    "transfer-encoding",
                ):
                    clean_headers[k] = v

            if "text/html" in content_type.lower():
                target_origin = f"{parsed_target.scheme}://{parsed_target.netloc}"
                html_text = res.text

                inject_script = (
                    f'<base href="{target_origin}/" target="_self">\n'
                    f'<script>'
                    f'document.addEventListener("submit", function(e) {{'
                    f'  var f = e.target;'
                    f'  var act = f.getAttribute("action") || "";'
                    f'  if (!act.startsWith("http")) act = "{target_origin}" + (act.startsWith("/") ? "" : "/") + act;'
                    f'  e.preventDefault();'
                    f'  var urlObj = new URL(act);'
                    f'  var fd = new FormData(f);'
                    f'  for (var p of fd.entries()) {{ urlObj.searchParams.set(p[0], p[1]); }}'
                    f'  if (urlObj.hostname.includes("google.") && !urlObj.searchParams.has("igu")) {{ urlObj.searchParams.set("igu", "1"); }}'
                    f'  window.location.href = "/api/proxy/view?url=" + encodeURIComponent(urlObj.toString());'
                    f'}}, true);'
                    f'document.addEventListener("click", function(e) {{'
                    f'  var a = e.target.closest("a");'
                    f'  if (a && a.href && !a.href.startsWith("javascript:") && !a.href.includes("/api/proxy/view")) {{'
                    f'    e.preventDefault();'
                    f'    var targetHref = a.href;'
                    f'    try {{'
                    f'      var u = new URL(targetHref);'
                    f'      if (u.hostname.includes("google.") && !u.searchParams.has("igu")) {{ u.searchParams.set("igu", "1"); targetHref = u.toString(); }}'
                    f'    }} catch(err) {{}}'
                    f'    window.location.href = "/api/proxy/view?url=" + encodeURIComponent(targetHref);'
                    f'  }}'
                    f'}}, true);'
                    f'</script>'
                )

                if "<head>" in html_text:
                    html_text = html_text.replace("<head>", f"<head>\n{inject_script}", 1)
                elif "<HEAD>" in html_text:
                    html_text = html_text.replace("<HEAD>", f"<HEAD>\n{inject_script}", 1)
                else:
                    html_text = f"{inject_script}\n{html_text}"

                res_bytes = html_text.encode("utf-8")

            return Response(
                content=res_bytes,
                status_code=res.status_code,
                headers=clean_headers,
                media_type=content_type,
            )

    except Exception as e:
        item.state = "error"
        item.error = str(e)
        proxy_manager.update_history(item)
        return Response(
            content=f"Proxy error connecting to target: {e}",
            status_code=502,
            media_type="text/plain",
        )
