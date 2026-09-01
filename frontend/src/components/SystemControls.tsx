import { useEffect, useState } from 'react';
import { killAllRuns, shutdownBackend, shutdownPC } from '../api';

interface KillControlProps {
  backendConnected: boolean;
  onBackendStopped: () => void;
}

export function ShutdownPCButton() {
  const [showConfirm, setShowConfirm] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleShutdownClick = async () => {
    setError(null);
    try {
      setStage('Stopping active tests…');
      await killAllRuns().catch(() => {});
      setStage('Triggering OS shutdown…');
      await shutdownPC().catch(() => {});
      setStage('OS Shutdown command sent! Shutting down computer…');
    } catch {
      setStage('OS Shutdown command sent!');
    }
  };

  return (
    <>
      <button
        type="button"
        id="shutdown-pc-btn"
        className="system-btn shutdown-pc-btn"
        onClick={() => setShowConfirm(true)}
        title="Power off this computer (macOS / Windows)"
      >
        <svg width="18" height="18" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 0a.75.75 0 0 1 .75.75v6.5a.75.75 0 0 1-1.5 0v-6.5A.75.75 0 0 1 8 0Z"/>
          <path d="M3.243 3.243a.75.75 0 0 1 1.06 1.06 6 6 0 1 0 7.394 0 .75.75 0 1 1 1.06-1.06 7.5 7.5 0 1 1-9.514 0Z"/>
        </svg>
        <span>SHUTDOWN PC</span>
      </button>

      {showConfirm && (
        <div className="modal-backdrop" onClick={() => !stage && setShowConfirm(false)}>
          <div className="modal system-modal" onClick={(event) => event.stopPropagation()}>
            <div className="system-modal-icon warning">⚠</div>
            <h3 className="modal-title">Shutdown Computer?</h3>
            <p className="system-modal-desc">
              This main switch will stop all running HTTP tests, shut down the backend, and power off your operating system (macOS / Windows).
            </p>
            {stage && (
              <div className="process-progress-box">
                <span className="spinner spinner-sm" style={{ marginRight: 6 }} />
                {stage}
              </div>
            )}
            {error && <div className="detail-error">{error}</div>}
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setShowConfirm(false)}
                disabled={!!stage}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger btn-lg"
                onClick={() => void handleShutdownClick()}
                disabled={!!stage}
              >
                {stage ? 'Shutting Down…' : 'Yes, Power Off PC'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function KillAppSlider({ backendConnected, onBackendStopped }: KillControlProps) {
  const [sliderValue, setSliderValue] = useState(0);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (backendConnected && stage?.startsWith('Backend stopped')) {
      setStage(null);
      setSliderValue(0);
    }
  }, [backendConnected, stage]);

  const stopBackend = async () => {
    setError(null);
    setStage('Cancelling active test runs…');
    try {
      await killAllRuns().catch(() => {});
      setStage('Stopping backend process…');
      await shutdownBackend().catch(() => {});
      onBackendStopped();
      setStage('Backend stopped.');
    } catch (cause) {
      setSliderValue(0);
      setStage(null);
      setError(cause instanceof Error ? cause.message : 'Could not stop the backend.');
    }
  };

  const handleSliderChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = Number(event.target.value);
    setSliderValue(value);
    if (value >= 90 && !stage) void stopBackend();
  };

  const handleSliderRelease = () => {
    if (sliderValue < 90 && !stage) setSliderValue(0);
  };

  return (
    <div className="kill-app-slider-container">
      <div className="kill-app-info">
        {stage ? (
          <span className="kill-app-stage">
            <span className="spinner spinner-sm" style={{ marginRight: 6 }} /> {stage}
          </span>
        ) : error ? (
          <span className="detail-error">{error}</span>
        ) : (
          <span className="kill-app-label">
            {sliderValue > 0 ? `Slide to stop backend (${sliderValue}%)` : 'Slide to Kill App & Backend'}
          </span>
        )}
      </div>
      <div className="slider-wrapper">
        <input
          type="range"
          min="0"
          max="100"
          value={sliderValue}
          onChange={handleSliderChange}
          onMouseUp={handleSliderRelease}
          onTouchEnd={handleSliderRelease}
          className="kill-slider"
          disabled={!!stage}
          aria-label="Slide to kill app and backend"
        />
        <div className="slider-track-fill" style={{ width: `${sliderValue}%` }} />
      </div>
    </div>
  );
}
