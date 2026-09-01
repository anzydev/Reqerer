"""Route-level safety tests for lifecycle and validation guards."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from fastapi.testclient import TestClient
from unittest.mock import patch

from main import app
from settings import MAX_ACTIVE_RUNS, MAX_REQUESTS_PER_RUN


client = TestClient(app)


def test_config_reports_non_sensitive_feature_flags():
    response = client.get("/api/config")
    assert response.status_code == 200
    assert response.json()["max_requests_per_run"] == MAX_REQUESTS_PER_RUN
    assert response.json()["max_active_runs"] == MAX_ACTIVE_RUNS
    assert "pc_shutdown_enabled" in response.json()


def test_run_accepts_requests_without_a_payload_marker():
    response = client.post(
        "/api/run",
        json={
            "raw_request": "GET http://example.test/ HTTP/1.1",
            "config": {"start": 1, "end": 2, "step": 1, "delay_ms": 0, "timeout_ms": 500},
        },
    )
    assert response.status_code == 200
    assert "run_id" in response.json()


def test_run_accepts_large_number_of_requests():
    response = client.post(
        "/api/run",
        json={
            "raw_request": "GET http://example.test/?n=$ HTTP/1.1",
            "config": {
                "start": 1,
                "end": 1001,
                "step": 1,
                "delay_ms": 0,
                "timeout_ms": 500,
            },
        },
    )
    assert response.status_code == 200
    assert "run_id" in response.json()


def test_run_rejects_when_another_run_is_active():
    with patch("routes.api.active_run_count", return_value=MAX_ACTIVE_RUNS):
        response = client.post(
            "/api/run",
            json={
                "raw_request": "GET http://example.test/?n=$ HTTP/1.1",
                "config": {"start": 1, "end": 1, "step": 1, "delay_ms": 0, "timeout_ms": 500},
            },
        )

    assert response.status_code == 409
    assert "active run" in response.json()["detail"]


def test_pc_shutdown_endpoint():
    with patch("subprocess.Popen"):
        response = client.post("/api/shutdown-pc")
        assert response.status_code == 200
        assert response.json()["status"] == "pc_shutting_down"


def test_cors_allows_only_the_local_frontend_origin():
    allowed = client.options(
        "/api/run",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "POST",
        },
    )
    denied = client.options(
        "/api/run",
        headers={
            "Origin": "https://untrusted.example",
            "Access-Control-Request-Method": "POST",
        },
    )

    assert allowed.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert denied.status_code == 400
