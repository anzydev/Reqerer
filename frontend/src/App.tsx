import { useCallback, useEffect, useRef, useState } from 'react';
import RequestEditor from './components/RequestEditor';
import ConfigPanel from './components/ConfigPanel';
import ResultsTable from './components/ResultsTable';
import BackendToggle from './components/BackendToggle';
import InterceptView from './components/InterceptView';
import ConnectionOverlay from './components/ConnectionOverlay';
import {
  parseRequest,
  startRun,
  stopRun,
  createEventSource,
  checkBackendConnectionDetailed,
  setCustomBackendUrl,
  type DiagnosticLog,
  type RequestResult,
  type RunStatus,
  type TestConfig,
} from './api';

const DEFAULT_REQUEST = `POST http://localhost:8000/api/items
Content-Type: application/json
Accept: application/json

{"id":"$2$","name":"Test Item"}`;

const DEFAULT_CONFIG: TestConfig = {
  start: 1,
  end: 0,
  step: 1,
  delay_ms: 0,
  timeout_ms: 10_000,
  concurrency: 0,
  follow_redirects: true,
  relative_url_scheme: 'http',
};

export default function App() {
  const [activeTab, setActiveTab] = useState<'intercept' | 'intruder'>('intruder');
  const [rawRequest, setRawRequest] = useState(DEFAULT_REQUEST);
  const [config, setConfig] = useState<TestConfig>(DEFAULT_CONFIG);
  const [parseError, setParseError] = useState<string | null>(null);
  const [backendConnected, setBackendConnected] = useState(false);
  const [isInitialConnecting, setIsInitialConnecting] = useState(true);
  const [showOverlay, setShowOverlay] = useState(true);
  const [diagnosticLog, setDiagnosticLog] = useState<DiagnosticLog | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [runStatus, setRunStatus] = useState<RunStatus | null>(null);
  const [results, setResults] = useState<RequestResult[]>([]);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [intruderSplit, setIntruderSplit] = useState(50);
  const isDraggingIntruderRef = useRef(false);
  const [disableLogs, setDisableLogs] = useState(false);
  const disableLogsRef = useRef(false);
  disableLogsRef.current = disableLogs;

  const eventSourceRef = useRef<EventSource | null>(null);
  const validationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleStartDragIntruder = (e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingIntruderRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingIntruderRef.current) return;
      const totalWidth = window.innerWidth;
      const newPercent = (moveEvent.clientX / totalWidth) * 100;
      const clamped = Math.min(80, Math.max(20, newPercent));
      setIntruderSplit(clamped);
    };

    const handleMouseUp = () => {
      isDraggingIntruderRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  // Parse validation debouncer
  useEffect(() => {
    if (validationTimerRef.current) clearTimeout(validationTimerRef.current);
    if (!backendConnected || !rawRequest.trim()) {
      if (!rawRequest.trim()) setParseError(null);
      return;
    }

    validationTimerRef.current = setTimeout(() => {
      void (async () => {
        try {
          await parseRequest(rawRequest);
          setParseError(null);
        } catch (cause) {
          setParseError(cause instanceof Error ? cause.message : 'Request validation failed.');
        }
      })();
    }, 400);

    return () => {
      if (validationTimerRef.current) clearTimeout(validationTimerRef.current);
    };
  }, [rawRequest, backendConnected]);

  const resultsBufferRef = useRef<RequestResult[]>([]);
  const rafIdRef = useRef<number | null>(null);

  const flushResults = useCallback(() => {
    if (resultsBufferRef.current.length > 0) {
      const pending = [...resultsBufferRef.current];
      resultsBufferRef.current = [];
      setResults((current) => {
        const next = [...current];
        for (const res of pending) {
          const idx = next.findIndex((item) => item.index === res.index);
          if (idx < 0) {
            next.push(res);
          } else {
            next[idx] = res;
          }
        }
        return next;
      });
    }
    rafIdRef.current = null;
  }, []);

  const connectSSE = useCallback((id: string) => {
    eventSourceRef.current?.close();
    resultsBufferRef.current = [];
    if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);

    const eventSource = createEventSource(id);

    eventSource.addEventListener('result', (event: MessageEvent) => {
      if (disableLogsRef.current) return;
      const result: RequestResult = JSON.parse(event.data);
      resultsBufferRef.current.push(result);
      if (!rafIdRef.current) {
        rafIdRef.current = requestAnimationFrame(flushResults);
      }
    });

    eventSource.addEventListener('progress', (event: MessageEvent) => {
      setRunStatus(JSON.parse(event.data) as RunStatus);
    });

    eventSource.addEventListener('done', (event: MessageEvent) => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      flushResults();
      setRunStatus(JSON.parse(event.data) as RunStatus);
      setIsRunning(false);
      setStopping(false);
      eventSource.close();
    });

    eventSource.onerror = () => {
      if (rafIdRef.current) cancelAnimationFrame(rafIdRef.current);
      flushResults();
      eventSource.close();
      setIsRunning(false);
      setStopping(false);
    };

    eventSourceRef.current = eventSource;
  }, [flushResults]);

  const handleRun = async () => {
    if (!backendConnected) {
      alert('Backend is disconnected. Please connect the backend top-right toggle first.');
      return;
    }

    if (!config.end || config.end <= 0) {
      setToastMessage('⚠️ Please enter Total Requests (> 0)');
      setTimeout(() => setToastMessage(null), 4000);
      return;
    }

    if (!config.concurrency || config.concurrency <= 0) {
      setToastMessage('⚠️ Please enter Concurrency / Threads (> 0)');
      setTimeout(() => setToastMessage(null), 4000);
      return;
    }

    if (parseError) {
      setToastMessage(`⚠️ ${parseError}`);
      setTimeout(() => setToastMessage(null), 4000);
      return;
    }

    try {
      setIsRunning(true);
      setStopping(false);
      setResults([]);
      const { run_id } = await startRun(rawRequest, config);
      setRunId(run_id);
      setRunStatus({
        run_id,
        state: 'running',
        results: [],
        total: Math.max(1, config.end - config.start + 1),
        completed: 0,
        successful: 0,
        failed: 0,
        cancelled: 0,
      });
      connectSSE(run_id);
    } catch (cause) {
      setIsRunning(false);
      const errMsg = cause instanceof Error ? cause.message : 'Failed to start test.';
      setParseError(errMsg);
      setToastMessage(`⚠️ ${errMsg}`);
      setTimeout(() => setToastMessage(null), 4000);
    }
  };

  const handleStop = async () => {
    if (!runId) return;
    setStopping(true);
    try {
      await stopRun(runId);
    } catch (cause) {
      setStopping(false);
      setParseError(cause instanceof Error ? cause.message : 'Could not stop the run.');
    }
  };

  const performInitialConnect = useCallback(async () => {
    setIsInitialConnecting(true);
    setShowOverlay(true);
    const result = await checkBackendConnectionDetailed(45_000);
    setDiagnosticLog(result.log);
    setIsInitialConnecting(false);

    if (result.success) {
      setBackendConnected(true);
      setShowOverlay(false);
      setToastMessage('✓ Backend connected successfully');
      setTimeout(() => setToastMessage(null), 3000);
    } else {
      setBackendConnected(false);
      setShowOverlay(true);
    }
  }, []);

  useEffect(() => {
    void performInitialConnect();
  }, [performInitialConnect]);

  const handleRetryInitialConnect = () => {
    void performInitialConnect();
  };

  const handleDismissOverlay = () => {
    setShowOverlay(false);
    setToastMessage('ℹ️ Running in Offline Mode. Backend is disconnected.');
    setTimeout(() => setToastMessage(null), 4000);
  };

  const handleSaveCustomBackendUrl = (url: string) => {
    setCustomBackendUrl(url);
    setToastMessage(`✓ Backend URL set to ${url}`);
    setTimeout(() => setToastMessage(null), 3000);
    void performInitialConnect();
  };

  const handleResetDefaultBackendUrl = () => {
    setCustomBackendUrl(null);
    setToastMessage('✓ Reset to default cloud backend');
    setTimeout(() => setToastMessage(null), 3000);
    void performInitialConnect();
  };

  const handleBackendToggle = useCallback((connected: boolean) => {
    setBackendConnected((prev) => {
      if (prev === connected) return prev;
      if (!connected) {
        setShowOverlay(false);
      }
      return connected;
    });
  }, []);

  const handleSendToIntruder = (rawToUse: string) => {
    setRawRequest(rawToUse);
    setActiveTab('intruder');
    setToastMessage('Target request loaded into Intruder. Add a $ marker or click Auto $ to test.');
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleClearIntruderLogs = () => {
    if (isRunning) return;
    setResults([]);
    setRunStatus(null);
    setRunId(null);
  };

  return (
    <div className="main-app-shell">
      {/* ── Initial Connection & Diagnostics Glassmorphic Overlay ── */}
      {showOverlay && (
        <ConnectionOverlay
          isConnecting={isInitialConnecting}
          connected={backendConnected}
          log={diagnosticLog}
          onRetry={handleRetryInitialConnect}
          onDismiss={handleDismissOverlay}
          onSaveCustomUrl={handleSaveCustomBackendUrl}
          onResetDefaultUrl={handleResetDefaultBackendUrl}
        />
      )}

      {/* ── Top Navigation Bar ── */}
      <header className="app-top-nav">
        <div className="nav-brand">
          <span className="brand-logo">Reqerer</span>
        </div>

        <nav className="nav-tabs">
          <button
            type="button"
            className={`nav-tab ${activeTab === 'intercept' ? 'active' : ''}`}
            onClick={() => setActiveTab('intercept')}
          >
            Intercept
          </button>
          <button
            type="button"
            className={`nav-tab ${activeTab === 'intruder' ? 'active' : ''}`}
            onClick={() => setActiveTab('intruder')}
          >
            Intruder
          </button>
        </nav>

        <div className="nav-right-controls">
          <BackendToggle
            connected={backendConnected}
            onToggle={handleBackendToggle}
          />
        </div>
      </header>

      {/* ── Toast Notification ── */}
      {toastMessage && (
        <div className="toast-container">
          <div className="toast toast-success">{toastMessage}</div>
        </div>
      )}

      {/* ── Main Tab Workspace ── */}
      {activeTab === 'intercept' ? (
        <InterceptView
          onSendToIntruder={handleSendToIntruder}
          onSwitchToIntruder={() => setActiveTab('intruder')}
        />
      ) : (
        <div
          className="split-app-grid"
          style={{
            gridTemplateColumns: `${intruderSplit}% 6px calc(${100 - intruderSplit}% - 6px)`,
          }}
        >
          {/* ── LEFT HALF: Request Editor & Shutdown PC Button ── */}
          <section className="left-panel">
            <div className="panel-header">
              <span className="card-title">HTTP Request Editor</span>
              <div className="panel-header-actions">
                {isRunning ? (
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    onClick={() => void handleStop()}
                    disabled={stopping}
                  >
                    ■ {stopping ? 'Stopping…' : 'Stop Run'}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn btn-primary btn-sm intruder-start-btn"
                    onClick={() => void handleRun()}
                    disabled={!backendConnected || !config.end || config.end <= 0 || !config.concurrency || config.concurrency <= 0}
                    title={
                      !config.end || config.end <= 0 || !config.concurrency || config.concurrency <= 0
                        ? 'Enter Total Requests and Threads (> 0)'
                        : parseError || 'Start Intruder Run'
                    }
                  >
                    ▶ Start Run
                  </button>
                )}
              </div>
            </div>

            <div className="editor-container">
              <RequestEditor
                value={rawRequest}
                onChange={setRawRequest}
                theme="dark"
                error={parseError}
              />
            </div>
          </section>

          {/* ── DRAGGABLE VERTICAL DIVIDER ── */}
          <div
            className="split-resizer col-resizer"
            onMouseDown={handleStartDragIntruder}
            title="Drag to resize panels"
          >
            <div className="resizer-grip" />
          </div>

          {/* ── RIGHT HALF: Config, Logs & Kill Slider ── */}
          <section className="right-panel">
            <div className="upper-right-config">
              <ConfigPanel
                config={config}
                onChange={setConfig}
                disabled={!backendConnected}
                isRunning={isRunning}
                stopping={stopping}
                onRun={() => void handleRun()}
                onStop={() => void handleStop()}
              />
            </div>

            <div className="lower-right-logs">
              <ResultsTable
                results={results}
                status={runStatus}
                onClear={handleClearIntruderLogs}
                disableLogs={disableLogs}
                onToggleDisableLogs={() => setDisableLogs((prev) => !prev)}
              />
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
