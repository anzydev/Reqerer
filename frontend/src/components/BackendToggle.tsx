import { useCallback, useEffect, useRef, useState } from 'react';
import { checkHealth } from '../api';

interface BackendToggleProps {
  connected: boolean;
  onToggle: (connected: boolean) => void;
}

export default function BackendToggle({ connected, onToggle }: BackendToggleProps) {
  const [checking, setChecking] = useState(false);
  const checkingRef = useRef(false);
  const activeRef = useRef(true);
  const onToggleRef = useRef(onToggle);
  onToggleRef.current = onToggle;

  const doPing = useCallback(async (): Promise<boolean> => {
    if (checkingRef.current) return false;
    checkingRef.current = true;
    setChecking(true);
    try {
      const isReachable = await checkHealth();
      if (activeRef.current) {
        onToggleRef.current(isReachable);
      }
      return isReachable;
    } finally {
      checkingRef.current = false;
      if (activeRef.current) {
        setChecking(false);
      }
    }
  }, []);

  useEffect(() => {
    activeRef.current = true;
    void doPing();
    // Poll every 15s — Render cold boots can take 22s+, so rapid polling is wasteful
    const interval = window.setInterval(() => void doPing(), 15_000);
    return () => {
      activeRef.current = false;
      window.clearInterval(interval);
    };
  }, [doPing]);

  const handleToggleClick = async () => {
    if (checking) return;
    if (connected) {
      onToggle(false);
    } else {
      await doPing();
    }
  };

  const statusLabel = checking
    ? 'Waking up backend…'
    : connected
    ? 'Backend Connected'
    : 'Backend Disconnected';

  return (
    <div
      className="backend-toggle-container"
      onClick={() => void handleToggleClick()}
      style={{ cursor: 'pointer' }}
      title={
        checking
          ? 'Connecting to backend (may take 15-30s on first load)…'
          : connected
          ? 'Click to disconnect backend'
          : 'Click to reconnect backend'
      }
    >
      <div className="backend-status-info">
        {checking ? (
          <span className="spinner spinner-sm" />
        ) : (
          <span className={`status-indicator ${connected ? 'online' : 'offline'}`} />
        )}
        <span className="backend-status-label">{statusLabel}</span>
      </div>

      <button
        type="button"
        className={`toggle-switch ${connected ? 'active' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          void handleToggleClick();
        }}
        disabled={checking}
        title={
          checking
            ? 'Connecting…'
            : connected
            ? 'Click to disconnect backend'
            : 'Click to reconnect backend'
        }
        aria-label="Toggle backend connection"
      >
        <span className="toggle-slider" />
      </button>
    </div>
  );
}
