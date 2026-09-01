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
  const totalRequests = config.end - config.start + 1;

  const handleTotalRequestsChange = (count: number) => {
    const validCount = Math.max(1, count);
    onChange({
      ...config,
      start: 1,
      end: validCount,
      step: 1,
    });
  };

  const handleConcurrencyChange = (concurrency: number) => {
    const validConcurrency = Math.min(100, Math.max(1, concurrency));
    onChange({
      ...config,
      concurrency: validConcurrency,
    });
  };

  const handleDelayChange = (delayMs: number) => {
    onChange({
      ...config,
      delay_ms: Math.max(0, delayMs),
    });
  };

  return (
    <div className="config-panel card">
      <div className="card-header">
        <span className="card-title">Intruder Attack Configuration</span>
      </div>

      <div className="config-fields-simple">
        <div className="config-row-simple">
          <label htmlFor="cfg-total-requests" className="config-label">Total Requests</label>
          <div className="config-input-wrap">
            <input
              id="cfg-total-requests"
              type="number"
              className="input input-number"
              value={totalRequests}
              min={1}
              disabled={disabled}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v)) handleTotalRequestsChange(v);
              }}
            />
            <span className="config-suffix">reqs</span>
          </div>
        </div>

        <div className="config-row-simple">
          <label htmlFor="cfg-concurrency" className="config-label">Concurrency (Threads)</label>
          <div className="config-input-wrap">
            <input
              id="cfg-concurrency"
              type="number"
              className="input input-number"
              value={config.concurrency || 5}
              min={1}
              max={100}
              disabled={disabled}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v)) handleConcurrencyChange(v);
              }}
            />
            <span className="config-suffix">threads</span>
          </div>
        </div>

        <div className="config-row-simple">
          <label htmlFor="cfg-delay-ms" className="config-label">Delay (ms)</label>
          <div className="config-input-wrap">
            <input
              id="cfg-delay-ms"
              type="number"
              className="input input-number"
              value={config.delay_ms}
              min={0}
              disabled={disabled}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v)) handleDelayChange(v);
              }}
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
              disabled={disabled}
            >
              ▶ Start Intruder Run
            </button>
          )}
        </div>
      )}
    </div>
  );
}
