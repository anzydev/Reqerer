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
    ? 'Connecting…'
    : connected
      ? 'Backend Connected'
      : 'Backend Disconnected';

  return (
    <div
      className="backend-status-widget"
      title={
        checking
          ? 'Establishing link to backend…'
          : connected
            ? 'Backend is connected. Click to disconnect.'
            : 'Backend is disconnected. Click to connect.'
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
        className={`btn btn-sm ${connected ? 'btn-secondary' : 'btn-primary'} backend-action-btn`}
        onClick={() => void handleToggleClick()}
        disabled={checking}
        aria-label="Toggle backend connection"
      >
        {checking ? 'Connecting' : connected ? 'Disconnect' : 'Connect'}
      </button>
    </div>
  );
}
