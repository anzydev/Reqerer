export interface AppConfig {
  features: {
    shutdown: boolean;
  };
}

export interface ParsedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
  raw: string;
}

export interface TestConfig {
  start: number;
  end: number;
  step: number;
  delay_ms: number;
  timeout_ms: number;
  concurrency: number;
  follow_redirects: boolean;
  relative_url_scheme: 'http' | 'https';
}

export interface RequestResult {
  index: number;
  value: number;
  state: 'pending' | 'running' | 'success' | 'error' | 'cancelled';
  status_code: number | null;
  response_time_ms: number | null;
  response_size: number | null;
  request_headers: Record<string, string> | null;
  request_body: string | null;
  response_headers: Record<string, string> | null;
  response_body: string | null;
  response_truncated: boolean;
  error: string | null;
  url: string | null;
  method: string | null;
}

export interface RunStatus {
  run_id: string;
  state: 'pending' | 'running' | 'completed' | 'stopped' | 'error';
  results: RequestResult[];
  total: number;
  completed: number;
  successful: number;
  failed: number;
  cancelled: number;
  avg_response_time_ms?: number | null;
  elapsed_ms?: number | null;
  estimated_remaining_ms?: number | null;
  error?: string | null;
}

export interface ParseResponse {
  parsed: ParsedRequest;
  substitution_count: number;
  warnings: string[];
}

export interface PreviewResponse {
  target: string;
  method: string;
  count: number;
  estimated_seconds: number;
  substitution_params: string[];
  first_request: string | null;
  last_request: string | null;
}

export interface ProxyHistoryItem {
  id: string;
  timestamp: string;
  method: string;
  url: string;
  host: string;
  state: 'intercepted' | 'forwarded' | 'dropped' | 'completed' | 'error';
  raw_request: string;
  status_code: number | null;
  response_time_ms: number | null;
  response_size: number | null;
  response_headers: Record<string, string> | null;
  response_body: string | null;
  error: string | null;
}

export interface ProxyStatus {
  intercept_enabled: boolean;
  proxy_port: number;
  proxy_host: string;
  active_item: ProxyHistoryItem | null;
  history_count: number;
}

const API_BASE = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  const response = await fetch(url, options);
  if (!response.ok) {
    let message = `API request failed: ${response.status} ${response.statusText}`;
    try {
      const errorData = await response.json();
      if (errorData.detail) message = errorData.detail;
    } catch {
      // Fall back to HTTP status message
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export async function checkBackendConnection(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(3_000) });
    return response.ok;
  } catch {
    return false;
  }
}

export const checkHealth = checkBackendConnection;

export function getAppConfig(): Promise<AppConfig> {
  return apiFetch('/api/config');
}

export function parseRequest(rawRequest: string): Promise<ParseResponse> {
  return apiFetch('/api/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw_request: rawRequest }),
  });
}

export function previewTest(rawRequest: string, config: TestConfig): Promise<PreviewResponse> {
  return apiFetch('/api/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw_request: rawRequest, config }),
  });
}

export function startRun(rawRequest: string, config: TestConfig): Promise<{ run_id: string }> {
  return apiFetch('/api/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw_request: rawRequest, config }),
  });
}

export function getRunStatus(runId: string): Promise<RunStatus> {
  return apiFetch(`/api/run/${runId}`);
}

export async function stopRun(runId: string): Promise<void> {
  await apiFetch(`/api/run/${runId}/stop`, { method: 'POST' });
}

export async function killAllRuns(): Promise<void> {
  await apiFetch('/api/kill-all', { method: 'POST' });
}

export async function shutdownBackend(): Promise<void> {
  try {
    await apiFetch('/api/shutdown', { method: 'POST' });
  } catch {
    // Network drop is expected when backend shuts down
  }
}

export async function shutdownPC(): Promise<{ status: string; message?: string }> {
  try {
    return await apiFetch<{ status: string; message?: string }>('/api/shutdown-pc', { method: 'POST' });
  } catch (cause) {
    return { status: 'error', message: cause instanceof Error ? cause.message : 'Shutdown failed' };
  }
}

export function createEventSource(runId: string): EventSource {
  return new EventSource(`${API_BASE}/api/run/${runId}/stream`);
}

// ── Proxy API Functions ──────────────────────────────────────────────────────

export function getProxyStatus(): Promise<ProxyStatus> {
  return apiFetch('/api/proxy/status');
}

export function toggleProxyIntercept(enabled: boolean): Promise<{ intercept_enabled: boolean }> {
  return apiFetch('/api/proxy/toggle', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
}

export function forwardProxyRequest(itemId: string, rawRequest: string): Promise<void> {
  return apiFetch('/api/proxy/forward', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ item_id: itemId, raw_request: rawRequest }),
  });
}

export function dropProxyRequest(itemId: string): Promise<void> {
  return apiFetch('/api/proxy/drop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ item_id: itemId }),
  });
}

export function getProxyHistory(): Promise<ProxyHistoryItem[]> {
  return apiFetch('/api/proxy/history');
}

export function createProxyEventSource(): EventSource {
  return new EventSource(`${API_BASE}/api/proxy/stream`);
}

export function openProxyBrowser(url: string = 'https://www.google.com'): Promise<{ status: string }> {
  return apiFetch('/api/proxy/open-browser', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
}

export function clearProxyHistory(): Promise<{ status: string }> {
  return apiFetch('/api/proxy/clear-history', {
    method: 'POST',
  });
}
