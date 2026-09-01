import { useState, useEffect } from 'react';
import { type DiagnosticLog, getBackendUrl, DEFAULT_REMOTE_BACKEND } from '../api';

interface ConnectionOverlayProps {
  isConnecting: boolean;
  connected: boolean;
  log: DiagnosticLog | null;
  onRetry: () => void;
  onDismiss: () => void;
  onSaveCustomUrl: (url: string) => void;
  onResetDefaultUrl: () => void;
}

export default function ConnectionOverlay({
  isConnecting,
  connected,
  log,
  onRetry,
  onDismiss,
  onSaveCustomUrl,
  onResetDefaultUrl,
}: ConnectionOverlayProps) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [customUrlInput, setCustomUrlInput] = useState(getBackendUrl());
  const [showUrlSettings, setShowUrlSettings] = useState(false);

  // Timer while connecting
  useEffect(() => {
    if (!isConnecting) {
      setElapsedSeconds(0);
      return;
    }
    const timer = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [isConnecting]);

  // Sync customUrl input whenever backend url changes
  useEffect(() => {
    setCustomUrlInput(getBackendUrl());
  }, [isConnecting, log]);

  // If connected, don't render overlay
  if (connected) return null;

  const currentBackend = getBackendUrl();
  const isCloudRender = currentBackend.includes('onrender.com');

  const handleApplyCustomUrl = (e: React.FormEvent) => {
    e.preventDefault();
    if (customUrlInput.trim()) {
      onSaveCustomUrl(customUrlInput.trim());
    }
  };

  const handleResetToDefault = () => {
    onResetDefaultUrl();
    setCustomUrlInput(DEFAULT_REMOTE_BACKEND);
  };

  return (
    <div className="connection-overlay-backdrop">
      <div className="connection-overlay-card">
        {isConnecting ? (
          <div className="connection-connecting-state">
            <div className="connection-spinner-glow">
              <div className="connection-spinner" />
            </div>

            <h2 className="connection-title">Connecting to Backend…</h2>

            <p className="connection-subtitle">
              {isCloudRender ? (
                <>
                  Waking up server on Render Cloud.
                  <br />
                  <span className="connection-note">
                    Render free-tier instances sleep when idle. Initial wake-up takes ~15–25 seconds.
                  </span>
                </>
              ) : (
                <>Verifying connection to {currentBackend}…</>
              )}
            </p>

            <div className="connection-target-badge font-mono">
              <span className="badge-dot pulse-dot" />
              <span>Target: {currentBackend}/health</span>
              <span className="elapsed-timer">{elapsedSeconds}s</span>
            </div>
          </div>
        ) : (
          <div className="connection-failed-state">
            <div className="connection-error-icon">⚠️</div>
            <h2 className="connection-title error-title">Backend Disconnected</h2>
            <p className="connection-subtitle">
              Could not establish connection to the backend server.
            </p>

            {/* ── Diagnostic Failure Log Box ── */}
            <div className="connection-log-box">
              <div className="log-box-header">
                <span className="log-box-title font-mono">DIAGNOSTIC LOG</span>
                {log?.timestamp && <span className="log-timestamp">{log.timestamp}</span>}
              </div>
              <div className="log-box-body font-mono">
                <div className="log-line">
                  <span className="log-key">Endpoint:</span>{' '}
                  <span className="log-val">{log?.targetUrl || `${currentBackend}/health`}</span>
                </div>
                <div className="log-line">
                  <span className="log-key">Status:</span>{' '}
                  <span className="log-val status-err">
                    {log?.statusCode ? `HTTP ${log.statusCode}` : 'Failed (Network / Timeout)'}
                  </span>
                </div>
                {log?.durationMs !== undefined && (
                  <div className="log-line">
                    <span className="log-key">Latency:</span>{' '}
                    <span className="log-val">{log.durationMs}ms</span>
                  </div>
                )}
                <div className="log-line log-err-msg">
                  <span className="log-key">Error:</span>{' '}
                  <span className="log-val err-text">
                    {log?.errorDetail || 'Server did not respond in time or request was blocked.'}
                  </span>
                </div>
              </div>
            </div>

            {/* ── Actions ── */}
            <div className="connection-actions">
              <button
                type="button"
                className="btn btn-primary connection-retry-btn"
                onClick={onRetry}
              >
                🔄 Retry Connection
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowUrlSettings((prev) => !prev)}
              >
                ⚙️ {showUrlSettings ? 'Hide URL Settings' : 'Change Backend URL'}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={onDismiss}
                title="Use editor offline without starting runs"
              >
                Continue Offline
              </button>
            </div>

            {/* ── Optional Custom Backend URL Form ── */}
            {showUrlSettings && (
              <form className="custom-url-form" onSubmit={handleApplyCustomUrl}>
                <label className="custom-url-label">
                  Backend API Base URL:
                  <div className="custom-url-input-group">
                    <input
                      type="url"
                      className="custom-url-input font-mono"
                      value={customUrlInput}
                      onChange={(e) => setCustomUrlInput(e.target.value)}
                      placeholder="https://reqerer-backend.onrender.com or http://127.0.0.1:8001"
                      required
                    />
                    <button type="submit" className="btn btn-sm btn-primary">
                      Save & Test
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-secondary"
                      onClick={handleResetToDefault}
                      title="Reset to default cloud backend"
                    >
                      Reset
                    </button>
                  </div>
                </label>
              </form>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
