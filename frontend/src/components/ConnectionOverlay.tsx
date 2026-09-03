import { useState, useEffect, useRef } from 'react';
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
  const [progress, setProgress] = useState(0);
  const [customUrlInput, setCustomUrlInput] = useState(getBackendUrl());
  const [showUrlSettings, setShowUrlSettings] = useState(false);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Smooth realistic 0 -> 100 progress simulation during connection
  useEffect(() => {
    if (isConnecting) {
      setProgress(5);
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);

      progressTimerRef.current = setInterval(() => {
        setProgress((prev) => {
          if (prev < 25) {
            return prev + Math.floor(Math.random() * 4 + 2); // 0-25% fast
          } else if (prev < 65) {
            return prev + Math.floor(Math.random() * 3 + 1); // 25-65% steady
          } else if (prev < 88) {
            return prev + 1; // 65-88% gradual
          } else if (prev < 96) {
            return Math.min(96, prev + 0.4); // 88-96% easing while waiting
          }
          return prev;
        });
      }, 350);
    } else if (connected) {
      setProgress(100);
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    } else {
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    }

    return () => {
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    };
  }, [isConnecting, connected]);

  // Sync customUrl input whenever backend url changes
  useEffect(() => {
    setCustomUrlInput(getBackendUrl());
  }, [isConnecting, log]);

  // If connected, don't render overlay
  if (connected && progress >= 100) return null;

  const currentBackend = getBackendUrl();
  const displayProgress = Math.min(100, Math.floor(progress));

  const getStatusText = () => {
    if (displayProgress < 25) return 'Initializing application workspace…';
    if (displayProgress < 55) return 'Connecting to backend service…';
    if (displayProgress < 85) return 'Warming up request runner engine…';
    if (displayProgress < 100) return 'Finalizing handshake…';
    return 'Ready!';
  };

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
            <div className="progress-top-meta">
              <span className="progress-status-label">{getStatusText()}</span>
              <span className="progress-percentage font-mono">{displayProgress}%</span>
            </div>

            {/* ── Progress Bar ── */}
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{ width: `${displayProgress}%` }}
              />
            </div>

            <p className="connection-subtitle progress-subtitle">
              Connecting to request engine…
            </p>
          </div>
        ) : (
          <div className="connection-failed-state">
            <div className="connection-error-icon font-mono">!</div>
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
                  <span className="log-val">{log?.targetUrl || `${currentBackend || 'api'}/health`}</span>
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
                Retry Connection
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowUrlSettings((prev) => !prev)}
              >
                {showUrlSettings ? 'Hide URL Settings' : 'Configure Backend URL'}
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
