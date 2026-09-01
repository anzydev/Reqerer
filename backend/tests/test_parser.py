"""Tests for the HTTP request parser."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pytest
from parser import parse_raw_request, ParseError, count_substitution_markers


# ── Valid requests ─────────────────────────────────────────────────────────────

def test_parse_full_url_post():
    raw = "POST http://localhost:8000/api/test HTTP/1.1\nContent-Type: application/json\n\n{\"id\":\"$\"}"
    req = parse_raw_request(raw)
    assert req.method == "POST"
    assert req.url == "http://localhost:8000/api/test"
    assert req.headers["Content-Type"] == "application/json"
    assert req.body == '{"id":"$"}'


def test_parse_get_no_body():
    raw = "GET http://example.com/users HTTP/1.1\nAccept: application/json"
    req = parse_raw_request(raw)
    assert req.method == "GET"
    assert req.body is None


def test_parse_relative_url_with_host_header():
    raw = "GET /users?id=$ HTTP/1.1\nHost: example.com"
    req = parse_raw_request(raw)
    assert req.url == "http://example.com/users?id=$"


def test_parse_relative_url_uses_selected_scheme():
    raw = "GET /users?id=$ HTTP/1.1\nHost: example.com"
    req = parse_raw_request(raw, relative_url_scheme="https")
    assert req.url == "https://example.com/users?id=$"


def test_parse_without_http_version():
    raw = "DELETE http://example.com/item/5"
    req = parse_raw_request(raw)
    assert req.method == "DELETE"


def test_parse_form_body():
    raw = "POST http://example.com/login\nContent-Type: application/x-www-form-urlencoded\n\nuser=$&pass=test"
    req = parse_raw_request(raw)
    assert req.body == "user=$&pass=test"


def test_parse_plain_text_body():
    raw = "POST http://example.com/echo\nContent-Type: text/plain\n\nHello world $"
    req = parse_raw_request(raw)
    assert "$" in req.body


def test_parse_preserves_payload_whitespace_and_trailing_newline():
    raw = "POST http://example.com/echo\r\nContent-Type: text/plain\r\n\r\n  payload $  \r\n"
    req = parse_raw_request(raw)
    assert req.body == "  payload $  \r\n"


def test_parse_headers():
    raw = "GET http://example.com/\nAuthorization: Bearer token123\nX-Custom: value"
    req = parse_raw_request(raw)
    assert req.headers["Authorization"] == "Bearer token123"
    assert req.headers["X-Custom"] == "value"


def test_parse_query_params_preserved():
    raw = "GET http://example.com/search?q=test&page=$"
    req = parse_raw_request(raw)
    assert "q=test" in req.url
    assert "page=$" in req.url


# ── Invalid requests ──────────────────────────────────────────────────────────

def test_empty_request_raises():
    with pytest.raises(ParseError, match="empty"):
        parse_raw_request("")


def test_missing_url_raises():
    with pytest.raises(ParseError):
        parse_raw_request("POST")


def test_unknown_method_raises():
    with pytest.raises(ParseError, match="Unknown HTTP method"):
        parse_raw_request("FETCH http://example.com/")


def test_malformed_header_raises():
    raw = "GET http://example.com/\nBadHeader"
    with pytest.raises(ParseError, match="Malformed header"):
        parse_raw_request(raw)


def test_relative_url_without_host_raises():
    raw = "GET /users"
    with pytest.raises(ParseError, match="Host"):
        parse_raw_request(raw)


def test_invalid_json_raises():
    raw = "POST http://example.com/\nContent-Type: application/json\n\n{invalid json"
    with pytest.raises(ParseError, match="JSON"):
        parse_raw_request(raw)


def test_json_with_substitution_marker_does_not_raise():
    """JSON validation should be skipped when $ markers are present."""
    raw = 'POST http://example.com/\nContent-Type: application/json\n\n{"id":"$"}'
    req = parse_raw_request(raw)
    assert req.body is not None


# ── Substitution marker counting ──────────────────────────────────────────────

def test_count_markers_none():
    assert count_substitution_markers("GET http://example.com/") == 0


def test_count_markers_single():
    assert count_substitution_markers('{"id":"$"}') == 1


def test_count_markers_multiple():
    assert count_substitution_markers("?a=$&b=$") == 2


def test_count_markers_escaped():
    assert count_substitution_markers("price: $$ USD, id: $") == 1


def test_count_markers_all_escaped():
    assert count_substitution_markers("$$$$") == 0
