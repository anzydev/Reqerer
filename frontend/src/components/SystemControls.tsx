import { useEffect, useState } from 'react';
import { killAllRuns, shutdownBackend } from '../api';

interface KillControlProps {
  backendConnected: boolean;
  onBackendStopped: () => void;
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
