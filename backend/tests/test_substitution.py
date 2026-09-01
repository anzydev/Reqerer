"""Tests for the substitution engine."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

import pytest
from substitution import generate_values, substitute, generate_requests, SubstitutionError
from models import TestConfig


def cfg(start=1, end=10, step=1, delay_ms=0, timeout_ms=5000):
    return TestConfig(start=start, end=end, step=step, delay_ms=delay_ms, timeout_ms=timeout_ms)


# ── Single $ ──────────────────────────────────────────────────────────────────

def test_single_marker():
    result = substitute('{"id":"$"}', 42)
    assert result == '{"id":"42"}'


def test_single_marker_in_url():
    result = substitute("GET http://example.com/item/$", 7)
    assert result == "GET http://example.com/item/7"


# ── Multiple $ markers ────────────────────────────────────────────────────────

def test_multiple_markers_same_value():
    result = substitute("?a=$&b=$", 5)
    assert result == "?a=5&b=5"


def test_multiple_markers_different_positions():
    result = substitute("start=$&end=$&val=$", 3)
    assert result == "start=3&end=3&val=3"


# ── Literal $$ escape ─────────────────────────────────────────────────────────

def test_escaped_dollar():
    result = substitute("price: $$ USD, id: $", 10)
    assert result == "price: $ USD, id: 10"


def test_all_escaped():
    result = substitute("$$$$", 99)
    assert result == "$$"


def test_escape_at_end():
    result = substitute("test$$", 1)
    assert result == "test$"


# ── Zero / Negative numbers ───────────────────────────────────────────────────

def test_zero_value():
    result = substitute('{"id":"$"}', 0)
    assert result == '{"id":"0"}'


def test_negative_value():
    result = substitute('{"offset":"$"}', -5)
    assert result == '{"offset":"-5"}'


# ── Range generation ─────────────────────────────────────────────────────────

def test_generate_values_basic():
    values = generate_values(cfg(1, 5, 1))
    assert values == [1, 2, 3, 4, 5]


def test_generate_values_step():
    values = generate_values(cfg(0, 10, 2))
    assert values == [0, 2, 4, 6, 8, 10]


def test_generate_values_single():
    values = generate_values(cfg(5, 5, 1))
    assert values == [5]


def test_generate_values_start_equals_end():
    values = generate_values(cfg(42, 42, 1))
    assert values == [42]


def test_generate_values_large_range():
    values = generate_values(cfg(1, 10000, 1))
    assert len(values) == 10000
    assert values[0] == 1
    assert values[-1] == 10000


def test_invalid_range_raises():
    with pytest.raises(SubstitutionError, match="Start"):
        generate_values(cfg(10, 5, 1))


# ── Full request generation ───────────────────────────────────────────────────

def test_generate_requests():
    pairs = generate_requests('{"id":"$"}', cfg(1, 3, 1))
    assert len(pairs) == 3
    assert pairs[0] == (1, '{"id":"1"}')
    assert pairs[1] == (2, '{"id":"2"}')
    assert pairs[2] == (3, '{"id":"3"}')


def test_generate_requests_with_step():
    pairs = generate_requests("?n=$", cfg(0, 4, 2))
    values = [v for v, _ in pairs]
    assert values == [0, 2, 4]


def test_generate_requests_no_marker():
    """Requests without markers still get generated (all identical)."""
    pairs = generate_requests("GET http://example.com/", cfg(1, 3, 1))
    assert len(pairs) == 3
    assert all(text == "GET http://example.com/" for _, text in pairs)
