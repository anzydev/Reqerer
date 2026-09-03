interface InterceptViewProps {
  onSendToIntruder?: (rawRequest: string) => void;
  onSwitchToIntruder?: () => void;
}

export default function InterceptView({ onSwitchToIntruder }: InterceptViewProps) {
  return (
    <div className="intercept-maintenance-container">
      <div className="intercept-maintenance-card">
        <span className="badge badge-warning maintenance-badge">MAINTENANCE</span>
        <h2 className="maintenance-title">Intercept Offline</h2>
        <p className="maintenance-description">
          Proxy Intercept is currently undergoing maintenance. The Intruder console is fully operational.
        </p>
        {onSwitchToIntruder && (
          <button
            type="button"
            className="btn btn-primary switch-intruder-btn"
            onClick={onSwitchToIntruder}
          >
            Switch to Intruder
          </button>
        )}
      </div>
    </div>
  );
}
