import { useState } from 'react';
import type { RequestResult, RunStatus } from '../api';

interface ResultsTableProps {
  results: RequestResult[];
  status?: RunStatus | null;
  onClear?: () => void;
  disableLogs?: boolean;
  onToggleDisableLogs?: () => void;
}

export default function ResultsTable({
  results,
  status,
  onClear,
  disableLogs,
  onToggleDisableLogs,
}: ResultsTableProps) {
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [filter, setFilter] = useState('');
  const [activeTab, setActiveTab] = useState<'response' | 'request'>('response');

  let displayed = [...results];
  if (filter) {
    const f = filter.toLowerCase();
    displayed = displayed.filter(
      (r) =>
        String(r.value).includes(f) ||
        String(r.status_code ?? '').includes(f) ||
        r.state.includes(f) ||
        String(r.index).includes(f) ||
        (r.error && r.error.toLowerCase().includes(f))
    );
  }

  const toggleExpand = (idx: number) => {
    setExpandedIndex((prev) => (prev === idx ? null : idx));
  };

  return (
    <div className="results-log-panel card">
      <div className="results-header">
        <div className="results-title-group">
          <span className="card-title">Results & Live Logs</span>
          {status && (
            <div className="results-stats-mini">
              <span className="stat-pill total">{status.completed} / {status.total} reqs</span>
              <span className="stat-pill success">{status.successful} successful</span>
              {status.failed > 0 && <span className="stat-pill fail">{status.failed} failed</span>}
              {status.cancelled > 0 && <span className="stat-pill timing">{status.cancelled} cancelled</span>}
              {status.avg_response_time_ms != null && (
                <span className="stat-pill timing">avg {Math.round(status.avg_response_time_ms)}ms</span>
              )}
            </div>
          )}
        </div>

        <div className="results-header-actions">
          {/* Mute / Disable Logs Toggle Button */}
          {onToggleDisableLogs && (
            <button
              type="button"
              className={`btn btn-sm mute-logs-btn ${disableLogs ? 'active' : ''}`}
              onClick={onToggleDisableLogs}
              title={
                disableLogs
                  ? 'Logs are muted. Click to resume receiving request logs.'
                  : 'Disable/mute individual request logs for high-speed benchmarking.'
              }
            >
              {disableLogs ? 'Logs: Muted' : 'Logs: Active'}
            </button>
          )}

          <input
            type="search"
            className="input input-sm search-input"
            placeholder="Filter logs…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />

          {onClear && (
            <button
              type="button"
              className="btn btn-ghost btn-sm clear-logs-btn"
              onClick={onClear}
              disabled={results.length === 0}
              title="Clear all execution logs"
            >
              Clear Logs
            </button>
          )}
        </div>
      </div>

      <div className="results-log-list">
        {displayed.length === 0 ? (
          <div className="empty-log-state">
            {disableLogs
              ? 'Logs muted.'
              : results.length === 0
                ? 'No requests executed yet.'
                : 'No log entries match the filter.'}
          </div>
        ) : (
          displayed.map((r) => {
            const isExpanded = expandedIndex === r.index;
            return (
              <div
                key={r.index}
                className={`log-item ${isExpanded ? 'expanded' : ''} state-${r.state}`}
              >
                <div className="log-row intruder-log-row" onClick={() => toggleExpand(r.index)}>
                  <span className="log-col log-index font-mono">#{r.index}</span>
                  <span className="log-col log-value font-mono">val={r.value}</span>
                  <span className="log-col log-status">
                    <StatusBadge result={r} />
                  </span>
                  <span className="log-col log-time font-mono">
                    {r.response_time_ms != null ? `${Math.round(r.response_time_ms)}ms` : '—'}
                  </span>
                  <span className="log-col log-size font-mono">
                    {r.response_size != null ? formatBytes(r.response_size) : '—'}
                  </span>
                  <span className="log-col log-expand-icon">
                    {isExpanded ? '▲' : '▼'}
                  </span>
                </div>

                {isExpanded && (
                  <div className="log-detail-box">
                    <div className="log-detail-toolbar">
                      <div className="log-detail-tabs">
                        <button
                          type="button"
                          className={`detail-tab ${activeTab === 'response' ? 'active' : ''}`}
                          onClick={() => setActiveTab('response')}
                        >
                          Response
                        </button>
                        <button
                          type="button"
                          className={`detail-tab ${activeTab === 'request' ? 'active' : ''}`}
                          onClick={() => setActiveTab('request')}
                        >
                          Sent Request
                        </button>
                      </div>
                    </div>

                    <div className="log-detail-content">
                      {activeTab === 'response' ? (
                        <>
                          {r.error && (
                            <div className="detail-error">Error: {r.error}</div>
                          )}
                          {r.response_headers && (
                            <div className="detail-section">
                              <span className="detail-label">Response Headers</span>
                              <pre className="code-block font-mono">
                                {formatHeaders(r.response_headers)}
                              </pre>
                            </div>
                          )}
                          {r.response_body != null && (
                            <div className="detail-section">
                              <span className="detail-label">
                                Response Body{r.response_truncated ? ' (truncated)' : ''}
                              </span>
                              <pre className="code-block font-mono">
                                {prettyJson(r.response_body)}
                              </pre>
                            </div>
                          )}
                          {!r.error && !r.response_headers && r.response_body == null && (
                            <div className="detail-empty">No response body captured.</div>
                          )}
                        </>
                      ) : (
                        <>
                          <div className="detail-meta">
                            <span className="method-tag">{r.method || 'POST'}</span>
                            <span className="url-tag font-mono">{r.url}</span>
                          </div>
                          {r.request_headers && (
                            <div className="detail-section">
                              <span className="detail-label">Request Headers</span>
                              <pre className="code-block font-mono">
                                {formatHeaders(r.request_headers)}
                              </pre>
                            </div>
                          )}
                          {r.request_body && (
                            <div className="detail-section">
                              <span className="detail-label">Request Body</span>
                              <pre className="code-block font-mono">
                                {prettyJson(r.request_body)}
                              </pre>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function StatusBadge({ result }: { result: RequestResult }) {
  if (result.status_code) {
    const code = result.status_code;
    let badgeClass = 'badge-2xx';
    let label = `${code} OK`;

    if (code >= 500) {
      badgeClass = 'badge-5xx';
      label = `${code} Error`;
    } else if (code >= 400) {
      badgeClass = 'badge-4xx';
      label = `${code} Error`;
    } else if (code >= 300) {
      badgeClass = 'badge-3xx';
      label = `${code} Redirect`;
    }

    return <span className={`badge ${badgeClass}`}>{label}</span>;
  }

  if (result.state === 'running') {
    return <span className="badge badge-running">Executing…</span>;
  }

  if (result.state === 'cancelled') {
    return <span className="badge badge-pending">Cancelled</span>;
  }

  if (result.error) {
    if (result.error.includes('timed out')) {
      return <span className="badge badge-error">Timeout</span>;
    }
    return <span className="badge badge-error">Error</span>;
  }

  return <span className="badge badge-pending">Pending</span>;
}

function formatHeaders(headers?: Record<string, string>): string {
  if (!headers) return '';
  return Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
}

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
