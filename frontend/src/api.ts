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

export const DEFAULT_REMOTE_BACKEND = 'https://reqerer-backend.onrender.com';

export function getBackendUrl(): string {
  if (typeof window !== 'undefined') {
    const custom = localStorage.getItem('reqerer_custom_backend_url');
    if (custom && custom.trim()) {
      return custom.trim().replace(/\/$/, '');
    }
    // When deployed on Vercel, relative paths are proxied via vercel.json rewrites
    // This provides 100% same-origin reliability without browser CORS blocking.
    if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      return '';
    }
  }
  return (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
}

export function setCustomBackendUrl(url: string | null): void {
  if (typeof window !== 'undefined') {
    if (url && url.trim()) {
      localStorage.setItem('reqerer_custom_backend_url', url.trim().replace(/\/$/, ''));
    } else {
      localStorage.removeItem('reqerer_custom_backend_url');
    }
  }
}

export interface DiagnosticLog {
  timestamp: string;
  targetUrl: string;
  success: boolean;
  durationMs: number;
  statusCode?: number;
  errorDetail?: string;
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const base = getBackendUrl();
  const url = `${base}${path}`;
  try {
    const response = await fetch(url, {
      ...options,
      credentials: 'omit',
    });
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
  } catch (err) {
    // If relative proxy failed and no custom URL was configured, retry once directly to Render
    if (!base && typeof window !== 'undefined' && window.location.hostname !== 'localhost') {
      const fallbackUrl = `${DEFAULT_REMOTE_BACKEND}${path}`;
      const response = await fetch(fallbackUrl, {
        ...options,
        credentials: 'omit',
      });
      if (!response.ok) {
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }
      return response.json() as Promise<T>;
    }
    throw err;
  }
}

export async function checkBackendConnectionDetailed(
  timeoutMs = 45_000
): Promise<{ success: boolean; log: DiagnosticLog }> {
  const base = getBackendUrl();
  const target = `${base}/health`;
  const startTime = performance.now();
  const timestamp = new Date().toLocaleTimeString();

  // Try configured / proxy endpoint first
  try {
    const response = await fetch(target || '/health', {
      signal: AbortSignal.timeout(timeoutMs),
      credentials: 'omit',
    });
    const durationMs = Math.round(performance.now() - startTime);

    if (response.ok) {
      return {
        success: true,
        log: {
          timestamp,
          targetUrl: target || `${window.location.origin}/health`,
          success: true,
          durationMs,
          statusCode: response.status,
        },
      };
    }

    return {
      success: false,
      log: {
        timestamp,
        targetUrl: target || `${window.location.origin}/health`,
        success: false,
        durationMs,
        statusCode: response.status,
        errorDetail: `HTTP ${response.status}: ${response.statusText}`,
      },
    };
  } catch (primaryErr: unknown) {
    // If on remote web without custom URL and primary relative check failed, try direct Render backend
    if (!base && typeof window !== 'undefined' && window.location.hostname !== 'localhost') {
      try {
        const directTarget = `${DEFAULT_REMOTE_BACKEND}/health`;
        const directResp = await fetch(directTarget, {
          signal: AbortSignal.timeout(timeoutMs),
          credentials: 'omit',
        });
        const durationMs = Math.round(performance.now() - startTime);
        if (directResp.ok) {
          return {
            success: true,
            log: {
              timestamp,
              targetUrl: directTarget,
              success: true,
              durationMs,
              statusCode: directResp.status,
            },
          };
        }
      } catch {
        // Fall through to primary error reporting
      }
    }

    const durationMs = Math.round(performance.now() - startTime);
    const errorMsg = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);
    const isTimeout = errorMsg.toLowerCase().includes('aborted') || errorMsg.toLowerCase().includes('timeout');

    return {
      success: false,
      log: {
        timestamp,
        targetUrl: target || (typeof window !== 'undefined' ? `${window.location.origin}/health` : '/health'),
        success: false,
        durationMs,
        errorDetail: isTimeout
          ? `Connection timed out after ${(timeoutMs / 1000).toFixed(0)}s (Server may be cold booting)`
          : `Network error: ${errorMsg}`,
      },
    };
  }
}

export async function checkBackendConnection(): Promise<boolean> {
  const result = await checkBackendConnectionDetailed(35_000);
  return result.success;
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

export function createEventSource(runId: string): EventSource {
  return new EventSource(`${getBackendUrl()}/api/run/${runId}/stream`);
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
  return new EventSource(`${getBackendUrl()}/api/proxy/stream`);
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
