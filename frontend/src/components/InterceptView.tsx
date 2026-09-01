interface InterceptViewProps {
  onSendToIntruder?: (rawRequest: string) => void;
  onSwitchToIntruder?: () => void;
}

export default function InterceptView({ onSwitchToIntruder }: InterceptViewProps) {
  return (
    <div className="intercept-maintenance-container">
      <div className="intercept-maintenance-card">
        <div className="maintenance-warning-icon">⚠️</div>
        <h2 className="maintenance-title">Under Maintenance</h2>
        <p className="maintenance-description">
          Intercept is currently disabled. Intruder is fully working.
        </p>
        {onSwitchToIntruder && (
          <button
            type="button"
            className="btn btn-primary switch-intruder-btn"
            onClick={onSwitchToIntruder}
          >
            Go to Intruder
          </button>
        )}
      </div>
    </div>
  );
}
