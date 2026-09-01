"""HTTP Request Parser.

Parses raw HTTP request text into a structured ParsedRequest.
Handles: method, URL, headers, cookies, body (JSON/form/plain-text).
"""
from __future__ import annotations

import re
from urllib.parse import urlparse

from models import ParsedRequest


class ParseError(Exception):
    """Raised when the HTTP request cannot be parsed."""


def parse_raw_request(raw: str, relative_url_scheme: str = "http") -> ParsedRequest:
    """Parse a raw HTTP request string into a ParsedRequest.

    Accepts two common formats:
      - Full URL:  POST http://host/path HTTP/1.1
      - Host-relative: POST /path HTTP/1.1  (requires Host header)

    Raises ParseError on invalid input.
    """
    if not raw or not raw.strip():
        raise ParseError("Request is empty.")

    # Split only the HTTP head from the body.
    separator = re.search(r"\r?\n\r?\n", raw)
    if separator:
        header_block = raw[:separator.start()]
        body = raw[separator.end():] or None
    else:
        header_block = raw
        body = None

    lines = header_block.splitlines()
    if not lines:
        raise ParseError("Request is empty.")

    # ── Request line ──────────────────────────────────────────────────────────
    request_line = lines[0].strip()
    parts = request_line.split()

    if len(parts) < 2:
        raise ParseError(
            f"Invalid request line: {request_line!r}. "
            "Expected: METHOD URL [HTTP/version]"
        )

    method = parts[0].upper()
    url_part = parts[1]

    valid_methods = {
        "GET", "POST", "PUT", "PATCH", "DELETE",
        "HEAD", "OPTIONS", "TRACE", "CONNECT",
    }
    if method not in valid_methods:
        raise ParseError(
            f"Unknown HTTP method: {method!r}. "
            f"Supported: {', '.join(sorted(valid_methods))}"
        )

    # ── Headers ───────────────────────────────────────────────────────────────
    headers: dict[str, str] = {}
    for i, line in enumerate(lines[1:], start=1):
        if line.strip() == "":
            break
        if ":" not in line:
            raise ParseError(
                f"Malformed header on line {i + 1}: {line!r}. "
                "Headers must be in 'Name: Value' format."
            )
        name, _, value = line.partition(":")
        name = name.strip()
        value = value.strip()
        if not name:
            raise ParseError(f"Empty header name on line {i + 1}.")
        headers[name] = value

    # ── Resolve URL ───────────────────────────────────────────────────────────
    url = _resolve_url(url_part, headers, relative_url_scheme)

    # ── Validate ──────────────────────────────────────────────────────────────
    _validate_body(method, body, headers)

    return ParsedRequest(
        method=method,
        url=url,
        headers=headers,
        body=body,
        raw=raw,
    )


def count_substitution_markers(raw: str) -> int:
    """Count non-escaped payload markers ($VAL$, $2$, or $)."""
    if not raw:
        return 0
    # Enclosed markers like $VAL$ or $2$ (word characters/numbers)
    double_matches = len(re.findall(r"\$([\w\-]+)\$", raw))
    if double_matches > 0:
        return double_matches

    # Single dollar markers not escaped as $$
    PH = "\x00ESCAPED_DOLLAR\x00"
    text = raw.replace("$$", PH)
    return text.count("$")


def _resolve_url(url_part: str, headers: dict[str, str], relative_url_scheme: str) -> str:
    """Turn a possibly host-relative URL into an absolute URL."""
    if url_part.startswith("http://") or url_part.startswith("https://"):
        parsed = urlparse(url_part)
        if not parsed.netloc:
            raise ParseError(f"URL is missing a host: {url_part!r}")
        return url_part

    if url_part.startswith("/"):
        # Relative path — look for Host header
        host = headers.get("Host") or headers.get("host")
        if not host:
            raise ParseError(
                "Relative URL given but no 'Host' header found. "
                "Add a Host header or use a full URL (http://...)."
            )

        return f"{relative_url_scheme}://{host}{url_part}"

    # Maybe the user omitted the scheme but provided a host+path
    if re.match(r"^[\w\-\.]+(/|$)", url_part):
        return f"{relative_url_scheme}://{url_part}"

    raise ParseError(f"Cannot resolve URL from: {url_part!r}")


def _validate_body(method: str, body: str | None, headers: dict[str, str]) -> None:
    """Light validation: warn if body is present for bodyless methods."""
    bodyless = {"GET", "HEAD", "OPTIONS", "TRACE"}
    if method in bodyless and body:
        pass

    content_type = headers.get("Content-Type") or headers.get("content-type") or ""

    if body and "application/json" in content_type:
        import json
        try:
            masked = re.sub(r'(:\s*)(\$)(?=[,}\s]|$)', r'\1"__PAYLOAD_MARKER__"', body)
            json.loads(masked)
        except Exception:
            try:
                json.loads(body)
            except Exception as e:
                raise ParseError(f"Invalid JSON body: {e}")
