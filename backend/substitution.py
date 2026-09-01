"""Substitution Engine.

Replaces $ markers in raw HTTP request text with numeric values.

Supports:
  - Enclosed markers: $2$, $100$, $val$
  - Single dollar markers: $
  - Literal dollar escaping: $$
"""
from __future__ import annotations

import re
from models import TestConfig


class SubstitutionError(Exception):
    """Raised when substitution configuration is invalid."""


def detect_initial_marker_value(template: str) -> int | None:
    """Detect if template contains a numerical marker like $2$ or $100$."""
    PH = "\x00LITERAL_DOLLAR\x00"
    cleaned = template.replace("$$", PH)

    match = re.search(r"\$(-?\d+)\$", cleaned)
    if match:
        try:
            return int(match.group(1))
        except ValueError:
            pass
    return None


def generate_values(config: TestConfig, template: str | None = None) -> list[int]:
    """Generate the list of substitution values from config and optional template."""
    if config.step <= 0:
        raise SubstitutionError("Step must be >= 1.")
    if config.start > config.end:
        raise SubstitutionError(
            f"Start ({config.start}) must be <= End ({config.end})."
        )

    start = config.start
    end = config.end
    step = config.step

    if template:
        initial_val = detect_initial_marker_value(template)
        if initial_val is not None and config.start == 1 and config.end == 10:
            count = max(1, config.end - config.start + 1)
            start = initial_val
            end = start + (count - 1) * step

    return list(range(start, end + 1, step))


def substitute(template: str, value: int) -> str:
    """Substitute all $...$ and single $ markers in template with value.

    $$ is treated as a literal $.
    """
    val_str = str(value)
    PH = "\x00LITERAL_DOLLAR\x00"
    text = template.replace("$$", PH)

    # Replace enclosed $CONTENT$ markers (e.g. $2$, $100$)
    text = re.sub(r"\$([^\$\s&/?]+)\$", val_str, text)

    # Replace any remaining single $ markers
    text = text.replace("$", val_str)

    # Restore literal dollars
    return text.replace(PH, "$")


def generate_requests(template: str, config: TestConfig) -> list[tuple[int, str]]:
    """Generate (value, substituted_text) pairs for all values in config."""
    values = generate_values(config, template)
    return [(v, substitute(template, v)) for v in values]


def extract_substitution_param_names(raw: str) -> list[str]:
    """Extract param names near $ markers."""
    params: list[str] = []
    seen: set[str] = set()

    for line in raw.splitlines():
        if "$" not in line:
            continue

        matches = re.findall(r'"([\w_-]+)"\s*:\s*"?\$[^\$]*\$?"?', line)
        for m in matches:
            if m not in seen:
                params.append(m)
                seen.add(m)

        matches = re.findall(r'[?&]([\w_-]+)=\$[^\$]*\$?', line)
        for m in matches:
            if m not in seen:
                params.append(m)
                seen.add(m)

    if not params:
        params = ["value"]

    return params
