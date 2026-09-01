"""Reqerer HTTP/HTTPS Interceptor Proxy Server.

Listens on 127.0.0.1:8082.
Captures live browser/client traffic, allows real-time inspection, editing,
forwarding, and dropping of HTTP/HTTPS requests.
Generates a local Root CA certificate for HTTPS interception.
"""
from __future__ import annotations

import asyncio
import datetime
import json
import os
import sys
import time
import uuid
from typing import Dict, List, Optional

import httpx
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.x509.oid import NameOID


# ── CA Certificate Generator ──────────────────────────────────────────────────

CA_DIR = os.path.dirname(os.path.abspath(__file__))
CA_KEY_PATH = os.path.join(CA_DIR, "reqerer-ca.key")
CA_CERT_PATH = os.path.join(CA_DIR, "reqerer-ca.crt")


def ensure_ca_certificate() -> tuple[rsa.RSAPrivateKey, x509.Certificate]:
    """Load or generate local Root CA certificate and private key."""
    if os.path.exists(CA_KEY_PATH) and os.path.exists(CA_CERT_PATH):
        with open(CA_KEY_PATH, "rb") as f:
            private_key = serialization.load_pem_private_key(f.read(), password=None)
        with open(CA_CERT_PATH, "rb") as f:
            cert = x509.load_pem_x509_certificate(f.read())
        return private_key, cert

    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, "Reqerer Security"),
        x509.NameAttribute(NameOID.COMMON_NAME, "Reqerer Root CA"),
    ])

    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(private_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=1))
        .not_valid_after(datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=3650))
        .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
        .sign(private_key, hashes.SHA256())
    )

    with open(CA_KEY_PATH, "wb") as f:
        f.write(private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption(),
        ))

    with open(CA_CERT_PATH, "wb") as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))

    return private_key, cert


# ── Intercept State & Manager ─────────────────────────────────────────────────

class ProxyHistoryItem:
    def __init__(self, item_id: str, method: str, url: str, host: str, raw_request: str):
        self.id = item_id
        self.method = method
        self.url = url
        self.host = host
        self.raw_request = raw_request
        self.timestamp = time.time()
        self.status_code: Optional[int] = None
        self.response_size: Optional[int] = None
        self.response_time_ms: Optional[float] = None
        self.response_headers: Optional[dict[str, str]] = None
        self.response_body: Optional[str] = None
        self.state: str = "intercepted"  # intercepted | forwarded | dropped | completed
        self.error: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "method": self.method,
            "url": self.url,
            "host": self.host,
            "raw_request": self.raw_request,
            "timestamp": self.timestamp,
            "status_code": self.status_code,
            "response_size": self.response_size,
            "response_time_ms": self.response_time_ms,
            "response_headers": self.response_headers,
            "response_body": self.response_body,
            "state": self.state,
            "error": self.error,
        }


class InterceptManager:
    def __init__(self):
        self.intercept_enabled: bool = False
        self.pending_futures: Dict[str, asyncio.Future[tuple[str, str]]] = {}
        self.history: List[ProxyHistoryItem] = []
        self.active_item: Optional[ProxyHistoryItem] = None
        self.subscribers: set[asyncio.Queue[str]] = set()

    def set_intercept(self, enabled: bool) -> None:
        self.intercept_enabled = enabled
        self.broadcast("status", {"intercept_enabled": self.intercept_enabled})

    def subscribe(self) -> asyncio.Queue[str]:
        q: asyncio.Queue[str] = asyncio.Queue()
        self.subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[str]) -> None:
        self.subscribers.discard(q)

    def broadcast(self, event: str, data: dict) -> None:
        msg = f"event: {event}\ndata: {json.dumps(data)}\n\n"
        for q in list(self.subscribers):
            try:
                q.put_nowait(msg)
            except Exception:
                pass

    def add_history(self, item: ProxyHistoryItem) -> None:
        self.history.insert(0, item)
        if len(self.history) > 200:
            self.history.pop()
        self.broadcast("history_item", item.to_dict())

    def update_history(self, item: ProxyHistoryItem) -> None:
        self.broadcast("history_item", item.to_dict())

    def clear_history(self) -> None:
        self.history.clear()
        self.broadcast("history_cleared", {})

    async def intercept_request(self, item: ProxyHistoryItem) -> tuple[str, str]:
        """Suspend request processing if intercept is ON. Returns (action, modified_raw)."""
        if not self.intercept_enabled:
            return ("forward", item.raw_request)

        item.state = "intercepted"
        self.active_item = item
        self.add_history(item)
        self.broadcast("intercept", item.to_dict())

        loop = asyncio.get_running_loop()
        future: asyncio.Future[tuple[str, str]] = loop.create_future()
        self.pending_futures[item.id] = future

        try:
            action, modified_raw = await future
            return action, modified_raw
        finally:
            self.pending_futures.pop(item.id, None)
            if self.active_item == item:
                self.active_item = None

    def forward_request(self, item_id: str, modified_raw: str) -> bool:
        fut = self.pending_futures.get(item_id)
        if fut and not fut.done():
            fut.set_result(("forward", modified_raw))
            return True
        return False

    def drop_request(self, item_id: str) -> bool:
        fut = self.pending_futures.get(item_id)
        if fut and not fut.done():
            fut.set_result(("drop", ""))
            return True
        return False


proxy_manager = InterceptManager()


# ── Proxy Server Implementation ───────────────────────────────────────────────

class ProxyServer:
    def __init__(self, host: str = "127.0.0.1", port: int = 8082):
        self.host = host
        self.port = port
        self.server: Optional[asyncio.Server] = None
        self.ca_key, self.ca_cert = ensure_ca_certificate()

    async def start(self) -> None:
        self.server = await asyncio.start_server(self.handle_client, self.host, self.port)

    async def stop(self) -> None:
        if self.server:
            self.server.close()
            await self.server.wait_closed()

    async def handle_client(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            # Read request head line
            initial_data = await reader.readuntil(b"\r\n\r\n")
        except Exception:
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass
            return

        raw_head = initial_data.decode("utf-8", errors="replace")
        lines = raw_head.splitlines()
        if not lines:
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass
            return

        req_line = lines[0]
        parts = req_line.split()
        if len(parts) < 2:
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass
            return

        method = parts[0].upper()
        target = parts[1]

        # ── HTTPS CONNECT Tunneling ──────────────────────────────────────────
        if method == "CONNECT":
            host_port = target.split(":")
            remote_host = host_port[0]
            remote_port = int(host_port[1]) if len(host_port) > 1 else 443

            try:
                remote_reader, remote_writer = await asyncio.wait_for(
                    asyncio.open_connection(remote_host, remote_port),
                    timeout=10.0,
                )
            except Exception as e:
                try:
                    writer.write(f"HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\n\r\n".encode("utf-8"))
                    await writer.drain()
                except Exception:
                    pass
                finally:
                    writer.close()
                    try:
                        await writer.wait_closed()
                    except Exception:
                        pass
                return

            try:
                writer.write(b"HTTP/1.1 200 Connection Established\r\n\r\n")
                await writer.drain()
            except Exception:
                remote_writer.close()
                writer.close()
                return

            # Record CONNECT history
            item_id = str(uuid.uuid4())[:8]
            item = ProxyHistoryItem(
                item_id=item_id,
                method="CONNECT",
                url=f"https://{target}",
                host=remote_host,
                raw_request=f"CONNECT {target} HTTP/1.1\r\nHost: {target}\r\n\r\n",
            )
            item.state = "completed"
            item.status_code = 200
            proxy_manager.add_history(item)

            # Bidirectional stream piping
            async def forward_stream(src_reader: asyncio.StreamReader, dst_writer: asyncio.StreamWriter):
                try:
                    while True:
                        data = await src_reader.read(65536)
                        if not data:
                            break
                        dst_writer.write(data)
                        await dst_writer.drain()
                except Exception:
                    pass
                finally:
                    try:
                        dst_writer.close()
                    except Exception:
                        pass

            try:
                await asyncio.gather(
                    forward_stream(reader, remote_writer),
                    forward_stream(remote_reader, writer),
                    return_exceptions=True,
                )
            finally:
                try:
                    remote_writer.close()
                    writer.close()
                except Exception:
                    pass
            return

        # ── Standard HTTP Interception & Forwarding ──────────────────────────
        content_length = 0
        headers_dict: dict[str, str] = {}
        for line in lines[1:]:
            if ":" in line:
                k, v = line.split(":", 1)
                headers_dict[k.strip()] = v.strip()
                if k.strip().lower() == "content-length":
                    try:
                        content_length = int(v.strip())
                    except ValueError:
                        pass

        body_bytes = b""
        if content_length > 0:
            try:
                body_bytes = await reader.readexactly(content_length)
            except Exception:
                body_bytes = await reader.read(content_length)

        raw_request_text = raw_head + body_bytes.decode("utf-8", errors="replace")

        host = headers_dict.get("Host") or headers_dict.get("host") or ""
        if target.startswith("http://") or target.startswith("https://"):
            full_url = target
        else:
            full_url = f"http://{host}{target}" if host else target

        item_id = str(uuid.uuid4())[:8]
        item = ProxyHistoryItem(
            item_id=item_id,
            method=method,
            url=full_url,
            host=host,
            raw_request=raw_request_text,
        )

        action, final_raw = await proxy_manager.intercept_request(item)

        if action == "drop":
            item.state = "dropped"
            proxy_manager.update_history(item)
            writer.write(b"HTTP/1.1 502 Bad Gateway (Request Dropped by Reqerer Intercept)\r\nContent-Type: text/plain\r\n\r\nRequest dropped by user.")
            await writer.drain()
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass
            return

        item.state = "forwarding"
        item.raw_request = final_raw
        start_time = time.monotonic()

        try:
            from parser import parse_raw_request
            parsed = parse_raw_request(final_raw)

            async with httpx.AsyncClient(timeout=15.0, follow_redirects=False) as client:
                res = await client.request(
                    method=parsed.method,
                    url=parsed.url,
                    headers=parsed.headers,
                    content=parsed.body.encode("utf-8") if parsed.body else None,
                )

                elapsed_ms = (time.monotonic() - start_time) * 1000
                res_body = res.text
                res_bytes = res.content

                item.state = "completed"
                item.status_code = res.status_code
                item.response_time_ms = round(elapsed_ms, 1)
                item.response_size = len(res_bytes)
                item.response_headers = dict(res.headers)
                item.response_body = res_body[:100000]
                proxy_manager.update_history(item)

                status_line = f"HTTP/1.1 {res.status_code} {res.reason_phrase}\r\n"
                writer.write(status_line.encode("utf-8"))

                for k, v in res.headers.items():
                    if k.lower() not in ("transfer-encoding", "content-encoding"):
                        writer.write(f"{k}: {v}\r\n".encode("utf-8"))
                writer.write(b"\r\n")
                writer.write(res_bytes)
                await writer.drain()

        except Exception as e:
            item.state = "error"
            item.error = str(e)
            proxy_manager.update_history(item)

            writer.write(f"HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain\r\n\r\nProxy error: {e}".encode("utf-8"))
            await writer.drain()

        finally:
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass


proxy_server_instance = ProxyServer()
