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
  // Local string state to allow completely empty inputs without forcing default numbers
  const [totalReqStr, setTotalReqStr] = useState<string>(
    config.end && config.end > 0 ? String(config.end - config.start + 1) : ''
  );
  const [concurrencyStr, setConcurrencyStr] = useState<string>(
    config.concurrency && config.concurrency > 0 ? String(config.concurrency) : ''
  );
  const [delayStr, setDelayStr] = useState<string>(
    config.delay_ms !== undefined && config.delay_ms !== 0 ? String(config.delay_ms) : ''
  );

  const [totalReqError, setTotalReqError] = useState<string | null>(null);
  const [concurrencyError, setConcurrencyError] = useState<string | null>(null);

  // Sync state if external config changes to valid numbers
  useEffect(() => {
    if (config.end > 0 && String(config.end - config.start + 1) !== totalReqStr && totalReqStr !== '') {
      setTotalReqStr(String(config.end - config.start + 1));
    }
    if (config.concurrency > 0 && String(config.concurrency) !== concurrencyStr && concurrencyStr !== '') {
      setConcurrencyStr(String(config.concurrency));
    }
  }, [config.end, config.start, config.concurrency]);

  const handleTotalRequestsChange = (raw: string) => {
    // Digits only
    const cleaned = raw.replace(/\D/g, '');
    setTotalReqStr(cleaned);

    if (cleaned === '') {
      setTotalReqError(null);
      onChange({ ...config, start: 1, end: 0 });
      return;
    }

    const val = parseInt(cleaned, 10);
    if (val === 0) {
      setTotalReqError("Total requests cannot be 0 (must be > 0)");
      onChange({ ...config, start: 1, end: 0 });
    } else {
      setTotalReqError(null);
      onChange({ ...config, start: 1, end: val });
    }
  };

  const handleConcurrencyChange = (raw: string) => {
    // Digits only
    const cleaned = raw.replace(/\D/g, '');
    setConcurrencyStr(cleaned);

    if (cleaned === '') {
      setConcurrencyError(null);
      onChange({ ...config, concurrency: 0 });
      return;
    }

    const val = parseInt(cleaned, 10);
    if (val === 0) {
      setConcurrencyError("Threads cannot be 0 (must be > 0)");
      onChange({ ...config, concurrency: 0 });
    } else {
      setConcurrencyError(null);
      onChange({ ...config, concurrency: Math.min(100, val) });
    }
  };

  const handleDelayChange = (raw: string) => {
    // Digits only - Delay CAN be 0
    const cleaned = raw.replace(/\D/g, '');
    setDelayStr(cleaned);

    if (cleaned === '') {
      onChange({ ...config, delay_ms: 0 });
      return;
    }

    const val = parseInt(cleaned, 10);
    onChange({ ...config, delay_ms: Math.max(0, val) });
  };

  const isFormValid = (config.end > 0) && (config.concurrency > 0) && !totalReqError && !concurrencyError;

  return (
    <div className="config-panel card">
      <div className="card-header">
        <span className="card-title">Intruder Attack Configuration</span>
      </div>

      <div className="config-fields-simple">
        {/* Total Requests Input */}
        <div className="config-row-simple">
          <label htmlFor="cfg-total-requests" className="config-label">
            Total Requests <span className="req-asterisk">*</span>
          </label>
          <div className="config-input-wrap">
            <input
              id="cfg-total-requests"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              className={`input input-number no-spinner ${totalReqError ? 'input-error' : ''}`}
              placeholder="e.g. 20 (> 0)"
              value={totalReqStr}
              disabled={disabled || isRunning}
              onChange={(e) => handleTotalRequestsChange(e.target.value)}
            />
            <span className="config-suffix">reqs</span>
          </div>
          {totalReqError && <div className="config-field-error">{totalReqError}</div>}
        </div>

        {/* Concurrency (Threads) Input */}
        <div className="config-row-simple">
          <label htmlFor="cfg-concurrency" className="config-label">
            Concurrency (Threads) <span className="req-asterisk">*</span>
          </label>
          <div className="config-input-wrap">
            <input
              id="cfg-concurrency"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              className={`input input-number no-spinner ${concurrencyError ? 'input-error' : ''}`}
              placeholder="e.g. 5 (1–100)"
              value={concurrencyStr}
              disabled={disabled || isRunning}
              onChange={(e) => handleConcurrencyChange(e.target.value)}
            />
            <span className="config-suffix">threads</span>
          </div>
          {concurrencyError && <div className="config-field-error">{concurrencyError}</div>}
        </div>

        {/* Delay Input (Can be 0) */}
        <div className="config-row-simple">
          <label htmlFor="cfg-delay-ms" className="config-label">
            Delay (ms) <span className="config-hint">(can be 0)</span>
          </label>
          <div className="config-input-wrap">
            <input
              id="cfg-delay-ms"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              className="input input-number no-spinner"
              placeholder="0"
              value={delayStr}
              disabled={disabled || isRunning}
              onChange={(e) => handleDelayChange(e.target.value)}
            />
            <span className="config-suffix">ms</span>
          </div>
        </div>
      </div>

      {/* ── Prominent Intruder Action Button ──────────────────────────────── */}
      {(onRun || onStop) && (
        <div className="config-actions-bar">
          {isRunning ? (
            <button
              type="button"
              className="btn btn-danger btn-block intruder-main-action-btn"
              onClick={onStop}
              disabled={stopping}
            >
              ■ {stopping ? 'Stopping Intruder…' : 'Stop Intruder Run'}
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-primary btn-block intruder-main-action-btn"
              onClick={onRun}
              disabled={disabled || !isFormValid}
              title={
                !isFormValid
                  ? 'Total Requests and Threads must be greater than 0'
                  : 'Start Intruder Run'
              }
            >
              ▶ Start Intruder Run
            </button>
          )}
        </div>
      )}
    </div>
  );
}
