import { useState, useMemo } from 'react';
import type { ProxyHistoryItem } from '../api';

interface ProxyHistoryTableProps {
  history: ProxyHistoryItem[];
  onSelectRequest?: (item: ProxyHistoryItem) => void;
  onSendToIntruder?: (rawRequest: string) => void;
  onClear?: () => void;
}

export type CategoryKey = 'all' | 'api' | 'js' | 'css' | 'media' | 'doc' | 'tunnel';
export type SortKey = 'newest' | 'oldest' | 'host' | 'category' | 'status' | 'time';
export type GroupMode = 'none' | 'category' | 'host';

export function classifyRequest(item: ProxyHistoryItem): Exclude<CategoryKey, 'all'> {
  const method = (item.method || '').toUpperCase();
  const url = (item.url || '').toLowerCase();
  const host = (item.host || '').toLowerCase();
  const contentType = (
    item.response_headers?.['content-type'] ||
    item.response_headers?.['Content-Type'] ||
    ''
  ).toLowerCase();

  // 1. Check for CONNECT HTTPS tunnel
  if (method === 'CONNECT') {
    return 'tunnel';
  }

  // 2. JavaScript / Scripts / Trackers
  if (
    contentType.includes('javascript') ||
    contentType.includes('ecmascript') ||
    url.endsWith('.js') ||
    url.includes('.js?') ||
    url.includes('/js/') ||
    url.includes('googletagmanager') ||
    url.includes('analytics') ||
    url.includes('clarity.ms') ||
    url.includes('doubleclick') ||
    url.includes('hs-scripts') ||
    url.includes('hs-analytics') ||
    url.includes('hs-banner') ||
    url.includes('hscollectedforms') ||
    url.includes('pagesense') ||
    url.includes('factors.ai')
  ) {
    return 'js';
  }

  // 3. CSS / Stylesheets / Fonts
  if (
    contentType.includes('css') ||
    url.endsWith('.css') ||
    url.includes('.css?') ||
    url.includes('/css/') ||
    url.includes('stylesheet')
  ) {
    return 'css';
  }

  // 4. Images / Media / Fonts
  if (
    contentType.includes('image') ||
    contentType.includes('font') ||
    contentType.includes('audio') ||
    contentType.includes('video') ||
    /\.(png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot|mp4|webm)(\?|$)/i.test(url) ||
    url.includes('gstatic.com') ||
    url.includes('redditstatic.com')
  ) {
    return 'media';
  }

  // 5. API / XHR / JSON / GraphQL endpoints
  if (
    contentType.includes('json') ||
    contentType.includes('xml') ||
    url.includes('/api/') ||
    url.includes('/v1/') ||
    url.includes('/v2/') ||
    url.includes('/graphql') ||
    ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) ||
    host.startsWith('api.') ||
    host.includes('api-') ||
    host.includes('hubapi') ||
    host.includes('openpanel') ||
    host.includes('clientservices.googleapis.com') ||
    host.includes('sctauditing')
  ) {
    return 'api';
  }

  // 6. Documents / HTML Pages
  if (
    contentType.includes('html') ||
    url.endsWith('.html') ||
    url.endsWith('/') ||
    !url.includes('.')
  ) {
    return 'doc';
  }

  return 'api';
}

const CATEGORY_LABELS: Record<CategoryKey, { label: string; icon: string; color: string }> = {
  all: { label: 'All', icon: '🌐', color: '#9cdcfe' },
  api: { label: 'API / Fetch', icon: '⚡', color: '#569cd6' },
  js: { label: 'JS / Scripts', icon: '📜', color: '#dcdcaa' },
  css: { label: 'CSS / Styles', icon: '🎨', color: '#c586c0' },
  media: { label: 'Media / Img', icon: '🖼️', color: '#4ec9b0' },
  doc: { label: 'Doc / HTML', icon: '📄', color: '#ce9178' },
  tunnel: { label: 'Tunnels (CONNECT)', icon: '🔒', color: '#858585' },
};

export default function ProxyHistoryTable({
  history,
  onSelectRequest,
  onSendToIntruder,
  onClear,
}: ProxyHistoryTableProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [activeTab, setActiveTab] = useState<'response' | 'request'>('response');
  const [activeCategory, setActiveCategory] = useState<CategoryKey>('all');
  const [sortBy, setSortBy] = useState<SortKey>('newest');
  const [groupMode, setGroupMode] = useState<GroupMode>('none');
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  // Compute category counts
  const categoryCounts = useMemo(() => {
    const counts: Record<CategoryKey, number> = {
      all: history.length,
      api: 0,
      js: 0,
      css: 0,
      media: 0,
      doc: 0,
      tunnel: 0,
    };
    for (const item of history) {
      const cat = classifyRequest(item);
      counts[cat]++;
    }
    return counts;
  }, [history]);

  // Filtered & Sorted items
  const processedItems = useMemo(() => {
    let items = [...history];

    // 1. Category Filter
    if (activeCategory !== 'all') {
      items = items.filter((item) => classifyRequest(item) === activeCategory);
    }

    // 2. Text Search Filter
    if (filter.trim()) {
      const f = filter.toLowerCase();
      items = items.filter(
        (h) =>
          h.method.toLowerCase().includes(f) ||
          h.url.toLowerCase().includes(f) ||
          h.host.toLowerCase().includes(f) ||
          String(h.status_code ?? '').includes(f) ||
          h.state.includes(f) ||
          classifyRequest(h).includes(f)
      );
    }

    // 3. Sorting
    items.sort((a, b) => {
      if (sortBy === 'newest') return 0; // Natural reverse or stream order
      if (sortBy === 'oldest') return history.indexOf(a) - history.indexOf(b);
      if (sortBy === 'host') return a.host.localeCompare(b.host);
      if (sortBy === 'category') return classifyRequest(a).localeCompare(classifyRequest(b));
      if (sortBy === 'status') return (b.status_code || 0) - (a.status_code || 0);
      if (sortBy === 'time') return (b.response_time_ms || 0) - (a.response_time_ms || 0);
      return 0;
    });

    return items;
  }, [history, activeCategory, filter, sortBy]);

  // Grouped items
  const groupedSections = useMemo(() => {
    if (groupMode === 'none') {
      return [{ title: '', items: processedItems }];
    }

    const groups: Record<string, ProxyHistoryItem[]> = {};
    for (const item of processedItems) {
      const key =
        groupMode === 'category'
          ? CATEGORY_LABELS[classifyRequest(item)].label
          : item.host || 'Unknown Host';

      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    }

    return Object.entries(groups).map(([title, items]) => ({
      title,
      items,
    }));
  }, [processedItems, groupMode]);

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const toggleGroupCollapse = (groupTitle: string) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [groupTitle]: !prev[groupTitle],
    }));
  };

  return (
    <div className="proxy-history-panel card">
      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div className="results-header">
        <div className="results-title-group">
          <span className="card-title">HTTP History</span>
          <span className="stat-pill">{history.length} captured</span>
        </div>

        <div className="results-header-actions">
          {/* Group Mode */}
          <div className="group-toggle-wrap">
            <span className="control-sublabel">Group:</span>
            <select
              className="input input-sm sort-select"
              value={groupMode}
              onChange={(e) => setGroupMode(e.target.value as GroupMode)}
            >
              <option value="none">Flat List</option>
              <option value="category">By Category</option>
              <option value="host">By Domain</option>
            </select>
          </div>

          {/* Sort By */}
          <div className="sort-toggle-wrap">
            <span className="control-sublabel">Sort:</span>
            <select
              className="input input-sm sort-select"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SortKey)}
            >
              <option value="newest">Newest First</option>
              <option value="oldest">Oldest First</option>
              <option value="host">Host (A-Z)</option>
              <option value="category">Category</option>
              <option value="status">Status Code</option>
              <option value="time">Response Time</option>
            </select>
          </div>

          {/* Search Filter */}
          <input
            type="search"
            className="input input-sm search-input"
            placeholder="Search URL, host…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />

          {/* Clear Logs */}
          {onClear && (
            <button
              type="button"
              className="btn btn-ghost btn-sm clear-logs-btn"
              onClick={onClear}
              disabled={history.length === 0}
              title="Clear all HTTP traffic history"
            >
              Clear Logs
            </button>
          )}
        </div>
      </div>

      {/* ── Category Filter Bar ────────────────────────────────────────────── */}
      <div className="category-filter-toolbar">
        {(Object.keys(CATEGORY_LABELS) as CategoryKey[]).map((catKey) => {
          const cat = CATEGORY_LABELS[catKey];
          const count = categoryCounts[catKey];
          const isActive = activeCategory === catKey;

          return (
            <button
              key={catKey}
              type="button"
              className={`category-pill ${isActive ? 'active' : ''}`}
              onClick={() => setActiveCategory(catKey)}
              style={{
                borderColor: isActive ? cat.color : undefined,
                color: isActive ? '#ffffff' : undefined,
              }}
            >
              <span className="cat-icon">{cat.icon}</span>
              <span className="cat-name">{cat.label}</span>
              <span className="cat-badge">{count}</span>
            </button>
          );
        })}
      </div>

      {/* ── History Items List / Grouped Sections ──────────────────────────── */}
      <div className="results-log-list">
        {processedItems.length === 0 ? (
          <div className="empty-log-state">
            {history.length === 0
              ? 'No HTTP traffic captured yet. Open the Proxy Browser or send requests through 127.0.0.1:8082.'
              : 'No captured traffic matches the selected category/filter.'}
          </div>
        ) : (
          groupedSections.map((group) => {
            const isCollapsed = group.title ? !!collapsedGroups[group.title] : false;

            return (
              <div key={group.title || 'default'} className="history-group-section">
                {group.title && (
                  <div
                    className="history-group-header"
                    onClick={() => toggleGroupCollapse(group.title)}
                  >
                    <span className="group-expand-caret">{isCollapsed ? '▶' : '▼'}</span>
                    <span className="group-title-text">{group.title}</span>
                    <span className="group-count-badge">{group.items.length} reqs</span>
                  </div>
                )}

                {!isCollapsed &&
                  group.items.map((h) => {
                    const isExpanded = expandedId === h.id;
                    const cat = classifyRequest(h);

                    return (
                      <div
                        key={h.id}
                        className={`log-item ${isExpanded ? 'expanded' : ''} state-${h.state}`}
                      >
                        <div className="log-row proxy-log-row" onClick={() => toggleExpand(h.id)}>
                          <span className="log-col log-index font-mono">#{h.id}</span>
                          <span className="log-col method-tag">{h.method}</span>
                          <span
                            className={`log-col category-tag category-tag-${cat}`}
                            title={`Category: ${CATEGORY_LABELS[cat].label}`}
                          >
                            {cat.toUpperCase()}
                          </span>
                          <span className="log-col url-tag font-mono truncate" title={h.url}>
                            {h.url}
                          </span>
                          <span className="log-col log-status">
                            <ProxyStatusBadge item={h} />
                          </span>
                          <span className="log-col log-time font-mono">
                            {h.response_time_ms != null
                              ? `${Math.round(h.response_time_ms)}ms`
                              : '—'}
                          </span>
                          <span className="log-col log-expand-icon">
                            {isExpanded ? '▲' : '▼'}
                          </span>
                        </div>

                        {isExpanded && (
                          <div className="log-detail-box">
                            <div className="log-detail-toolbar">
                              <div className="log-detail-tabs">
                                <button
                                  type="button"
                                  className={`detail-tab ${activeTab === 'response' ? 'active' : ''}`}
                                  onClick={() => setActiveTab('response')}
                                >
                                  Response
                                </button>
                                <button
                                  type="button"
                                  className={`detail-tab ${activeTab === 'request' ? 'active' : ''}`}
                                  onClick={() => setActiveTab('request')}
                                >
                                  Raw Request
                                </button>
                              </div>

                              {onSendToIntruder && (
                                <button
                                  type="button"
                                  className="btn btn-primary btn-sm send-to-intruder-btn"
                                  onClick={() => onSendToIntruder(h.raw_request)}
                                >
                                  Send to Intruder
                                </button>
                              )}
                            </div>

                            <div className="log-detail-content">
                              {activeTab === 'response' ? (
                                <>
                                  {h.error && (
                                    <div className="detail-error">Proxy Error: {h.error}</div>
                                  )}
                                  {h.response_headers && (
                                    <div className="detail-section">
                                      <span className="detail-label">Response Headers</span>
                                      <pre className="code-block font-mono">
                                        {formatHeaders(h.response_headers)}
                                      </pre>
                                    </div>
                                  )}
                                  {h.response_body != null && (
                                    <div className="detail-section">
                                      <span className="detail-label">Response Body</span>
                                      <pre className="code-block font-mono">
                                        {prettyJson(h.response_body)}
                                      </pre>
                                    </div>
                                  )}
                                  {!h.error &&
                                    !h.response_headers &&
                                    h.response_body == null && (
                                      <div className="detail-empty">No response captured.</div>
                                    )}
                                </>
                              ) : (
                                <div className="detail-section">
                                  <pre className="code-block font-mono">{h.raw_request}</pre>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function ProxyStatusBadge({ item }: { item: ProxyHistoryItem }) {
  if (item.status_code) {
    const code = item.status_code;
    let badgeClass = 'badge-2xx';

    if (code >= 500) badgeClass = 'badge-5xx';
    else if (code >= 400) badgeClass = 'badge-4xx';
    else if (code >= 300) badgeClass = 'badge-3xx';

    return <span className={`badge ${badgeClass}`}>{code}</span>;
  }

  if (item.state === 'intercepted') {
    return <span className="badge badge-running">Intercepted</span>;
  }

  if (item.state === 'dropped') {
    return <span className="badge badge-error">Dropped</span>;
  }

  if (item.error) {
    return <span className="badge badge-error">Error</span>;
  }

  return <span className="badge badge-pending">Pending</span>;
}

function formatHeaders(headers?: Record<string, string>): string {
  if (!headers) return '';
  return Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
}

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}
