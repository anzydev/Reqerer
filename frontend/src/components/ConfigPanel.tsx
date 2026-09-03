import { useState, useEffect } from 'react';
import type { TestConfig } from '../api';

interface ConfigPanelProps {
  config: TestConfig;
  onChange: (config: TestConfig) => void;
  disabled?: boolean;
  isRunning?: boolean;
  stopping?: boolean;
  onRun?: () => void;
  onStop?: () => void;
}

export default function ConfigPanel({
  config,
  onChange,
  disabled,
  isRunning,
  stopping,
  onRun,
  onStop,
}: ConfigPanelProps) {
  const [totalReqStr, setTotalReqStr] = useState<string>(
    config.end && config.end > 0 ? String(config.end - config.start + 1) : ''
  );
  const [concurrencyStr, setConcurrencyStr] = useState<string>(
    config.concurrency && config.concurrency > 0 ? String(config.concurrency) : ''
  );
  const [delayStr, setDelayStr] = useState<string>(
    config.delay_ms !== undefined ? String(config.delay_ms) : ''
  );

  useEffect(() => {
    if (config.end > 0 && String(config.end - config.start + 1) !== totalReqStr && totalReqStr !== '') {
      setTotalReqStr(String(config.end - config.start + 1));
    }
    if (config.concurrency > 0 && String(config.concurrency) !== concurrencyStr && concurrencyStr !== '') {
      setConcurrencyStr(String(config.concurrency));
    }
  }, [config.end, config.start, config.concurrency]);

  const handleTotalRequestsChange = (raw: string) => {
    const cleaned = raw.replace(/\D/g, '');
    const val = parseInt(cleaned, 10);

    if (cleaned === '' || val === 0) {
      setTotalReqStr(cleaned === '0' ? '' : cleaned);
      onChange({ ...config, start: 1, end: 0 });
      return;
    }

    setTotalReqStr(cleaned);
    onChange({ ...config, start: 1, end: val });
  };

  const handleConcurrencyChange = (raw: string) => {
    const cleaned = raw.replace(/\D/g, '');
    const val = parseInt(cleaned, 10);

    if (cleaned === '' || val === 0) {
      setConcurrencyStr(cleaned === '0' ? '' : cleaned);
      onChange({ ...config, concurrency: 0 });
      return;
    }

    setConcurrencyStr(cleaned);
    onChange({ ...config, concurrency: Math.min(100, val) });
  };

  const handleDelayChange = (raw: string) => {
    const cleaned = raw.replace(/\D/g, '');
    setDelayStr(cleaned);

    if (cleaned === '') {
      onChange({ ...config, delay_ms: 0 });
      return;
    }

    const val = parseInt(cleaned, 10);
    onChange({ ...config, delay_ms: Math.max(0, val) });
  };

  const isFormValid = config.end > 0 && config.concurrency > 0;

  return (
    <div className="config-panel card">
      <div className="card-header">
        <span className="card-title">Intruder Attack Configuration</span>
      </div>

      <div className="config-fields-simple">
        <div className="config-row-simple">
          <label htmlFor="cfg-total-requests" className="config-label">
            Total Requests
          </label>
          <div className="config-input-wrap">
            <input
              id="cfg-total-requests"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              className="input input-number no-spinner"
              value={totalReqStr}
              disabled={disabled || isRunning}
              onChange={(e) => handleTotalRequestsChange(e.target.value)}
            />
            <span className="config-suffix">reqs</span>
          </div>
        </div>

        <div className="config-row-simple">
          <label htmlFor="cfg-concurrency" className="config-label">
            Concurrency (Threads)
          </label>
          <div className="config-input-wrap">
            <input
              id="cfg-concurrency"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              className="input input-number no-spinner"
              value={concurrencyStr}
              disabled={disabled || isRunning}
              onChange={(e) => handleConcurrencyChange(e.target.value)}
            />
            <span className="config-suffix">threads</span>
          </div>
        </div>

        <div className="config-row-simple">
          <label htmlFor="cfg-delay-ms" className="config-label">
            Delay (ms)
          </label>
          <div className="config-input-wrap">
            <input
              id="cfg-delay-ms"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              className="input input-number no-spinner"
              value={delayStr}
              disabled={disabled || isRunning}
              onChange={(e) => handleDelayChange(e.target.value)}
            />
            <span className="config-suffix">ms</span>
          </div>
        </div>
      </div>

      {(onRun || onStop) && (
        <div className="config-actions-bar">
          {isRunning ? (
            <button
              type="button"
              className="btn btn-danger btn-block intruder-main-action-btn"
              onClick={onStop}
              disabled={stopping}
            >
              {stopping ? 'Stopping Intruder…' : 'Stop Intruder Run'}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary btn-block intruder-main-action-btn"
              onClick={onRun}
              disabled={disabled || !isFormValid}
            >
              Start Intruder Run
            </button>
          )}
        </div>
      )}
    </div>
  );
}
