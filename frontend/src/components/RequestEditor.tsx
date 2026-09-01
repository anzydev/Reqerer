import { useEffect, useRef, useCallback } from 'react';
import type { EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { EditorView as CM, keymap, Decoration, ViewPlugin, DecorationSet } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';

interface RequestEditorProps {
  value: string;
  onChange: (value: string) => void;
  theme: 'dark' | 'light';
  error?: string | null;
}

// ── CodeMirror Syntax Highlighting Plugin ────────────────────────────────────

const httpMethodDeco = Decoration.mark({ class: 'cm-http-method' });
const httpUrlDeco = Decoration.mark({ class: 'cm-http-url' });
const httpHeaderKeyDeco = Decoration.mark({ class: 'cm-http-header-key' });
const httpHeaderValDeco = Decoration.mark({ class: 'cm-http-header-val' });
const jsonKeyDeco = Decoration.mark({ class: 'cm-json-key' });
const jsonStringDeco = Decoration.mark({ class: 'cm-json-string' });
const jsonNumberDeco = Decoration.mark({ class: 'cm-json-number' });
const jsonBoolDeco = Decoration.mark({ class: 'cm-json-bool' });
const payloadMarkerDeco = Decoration.mark({ class: 'cm-payload-marker' });

const httpSyntaxPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.buildDecorations(view);
    }

    update(update: { docChanged: boolean; viewportChanged: boolean; view: EditorView }) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = this.buildDecorations(update.view);
      }
    }

    buildDecorations(view: EditorView): DecorationSet {
      const builder: Array<{ from: number; to: number; value: Decoration }> = [];
      const doc = view.state.doc;
      const text = doc.toString();
      const lines = text.split('\n');

      let pos = 0;
      let isBody = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineStart = pos;
        const lineEnd = pos + line.length;

        if (!isBody && line.trim() === '') {
          isBody = true;
          pos = lineEnd + 1;
          continue;
        }

        if (!isBody) {
          if (i === 0) {
            // Method line: POST /path HTTP/1.1
            const match = /^(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\s+([^\s]+)/i.exec(line);
            if (match) {
              const methodLen = match[1].length;
              builder.push({ from: lineStart, to: lineStart + methodLen, value: httpMethodDeco });
              const urlStart = lineStart + line.indexOf(match[2]);
              builder.push({ from: urlStart, to: urlStart + match[2].length, value: httpUrlDeco });
            }
          } else {
            // Header line: Key: Value
            const colonIdx = line.indexOf(':');
            if (colonIdx > 0) {
              builder.push({ from: lineStart, to: lineStart + colonIdx + 1, value: httpHeaderKeyDeco });
              builder.push({ from: lineStart + colonIdx + 1, to: lineEnd, value: httpHeaderValDeco });
            }
          }
        } else {
          // JSON / Body line syntax highlighting
          // JSON keys: "key":
          const keyRegex = /"([^"\\]|\\.)*"\s*:/g;
          let kMatch;
          while ((kMatch = keyRegex.exec(line)) !== null) {
            const start = lineStart + kMatch.index;
            const end = start + kMatch[0].length - 1; // Exclude colon
            builder.push({ from: start, to: end, value: jsonKeyDeco });
          }

          // Strings (non-key strings)
          const strRegex = /:\s*("([^"\\]|\\.)*")/g;
          let sMatch;
          while ((sMatch = strRegex.exec(line)) !== null) {
            const val = sMatch[1];
            const start = lineStart + sMatch.index + sMatch[0].indexOf(val);
            builder.push({ from: start, to: start + val.length, value: jsonStringDeco });
          }

          // Numbers
          const numRegex = /:\s*(-?\d+(\.\d+)?)/g;
          let nMatch;
          while ((nMatch = numRegex.exec(line)) !== null) {
            const val = nMatch[1];
            const start = lineStart + nMatch.index + nMatch[0].indexOf(val);
            builder.push({ from: start, to: start + val.length, value: jsonNumberDeco });
          }

          // Booleans / null
          const boolRegex = /:\s*(true|false|null)/g;
          let bMatch;
          while ((bMatch = boolRegex.exec(line)) !== null) {
            const val = bMatch[1];
            const start = lineStart + bMatch.index + bMatch[0].indexOf(val);
            builder.push({ from: start, to: start + val.length, value: jsonBoolDeco });
          }
        }

        // Highlight $ payload markers ($2$, $100$, or $) across whole document
        const doubleDollarRegex = /\$([^\$]*)\$/g;
        let mMatch;
        const matchedRanges: Array<[number, number]> = [];
        while ((mMatch = doubleDollarRegex.exec(line)) !== null) {
          const start = lineStart + mMatch.index;
          const end = start + mMatch[0].length;
          matchedRanges.push([start, end]);
          builder.push({ from: start, to: end, value: payloadMarkerDeco });
        }

        // Highlight any single $ markers not already part of a $...$ pair
        const singleDollarRegex = /\$/g;
        let sMatch;
        while ((sMatch = singleDollarRegex.exec(line)) !== null) {
          const start = lineStart + sMatch.index;
          const isEnclosed = matchedRanges.some(([s, e]) => start >= s && start < e);
          if (!isEnclosed) {
            builder.push({ from: start, to: start + 1, value: payloadMarkerDeco });
          }
        }

        pos = lineEnd + 1;
      }

      // Sort ranges before converting to DecorationSet
      builder.sort((a, b) => a.from - b.from || a.to - b.to);

      const decorations: DecorationSet = Decoration.set(
        builder.map((item) => item.value.range(item.from, item.to)),
        true
      );

      return decorations;
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);

// ── CodeMirror Theme ─────────────────────────────────────────────────────────

const httpThemeDark = CM.theme({
  '&': {
    fontSize: '13px',
    fontFamily: "'Consolas', 'JetBrains Mono', 'Courier New', monospace",
    background: '#1e1e1e',
    color: '#d4d4d4',
    height: '100%',
    maxHeight: '100%',
    flex: '1',
    display: 'flex',
    flexDirection: 'column',
    minHeight: '0',
    overflow: 'hidden',
  },
  '.cm-content': {
    padding: '12px',
    caretColor: '#aeafad',
    minHeight: '100%',
    userSelect: 'text !important',
    WebkitUserSelect: 'text !important',
  },
  '.cm-line': {
    lineHeight: '1.7',
    userSelect: 'text !important',
    WebkitUserSelect: 'text !important',
  },
  '.cm-focused': {
    outline: 'none',
  },
  '.cm-cursor': {
    borderLeftColor: '#aeafad',
  },
  '.cm-selectionBackground': {
    background: '#264f78 !important',
  },
  '::selection': {
    background: '#264f78 !important',
    color: '#ffffff !important',
  },
  '.cm-gutters': {
    background: '#252526',
    border: 'none',
    borderRight: '1px solid #2d2d2d',
    color: '#858585',
    fontSize: '12px',
    padding: '0 8px',
  },
  '.cm-activeLineGutter': {
    background: '#2a2d2e',
    color: '#c6c6c6',
  },
  '.cm-activeLine': {
    background: '#2a2d2e',
  },
  '.cm-scroller': {
    overflow: 'auto !important',
    flex: '1',
    height: '100%',
    minHeight: '0',
    scrollbarWidth: 'thin',
    scrollbarColor: '#424242 #1e1e1e',
  },

  /* Custom Scrollbar for CodeMirror Scroller */
  '.cm-scroller::-webkit-scrollbar': {
    width: '10px',
    height: '10px',
  },
  '.cm-scroller::-webkit-scrollbar-track': {
    background: '#1e1e1e',
  },
  '.cm-scroller::-webkit-scrollbar-thumb': {
    background: '#424242',
    borderRadius: '4px',
  },
  '.cm-scroller::-webkit-scrollbar-thumb:hover': {
    background: '#555555',
  },

  /* VS Code Dark+ Syntax Highlighting Colors */
  '.cm-http-method': { color: '#569cd6', fontWeight: 'bold' },
  '.cm-http-url': { color: '#4ec9b0' },
  '.cm-http-header-key': { color: '#c586c0', fontWeight: '600' },
  '.cm-http-header-val': { color: '#ce9178' },
  '.cm-json-key': { color: '#9cdcfe', fontWeight: '500' },
  '.cm-json-string': { color: '#ce9178' },
  '.cm-json-number': { color: '#b5cea8' },
  '.cm-json-bool': { color: '#569cd6', fontWeight: 'bold' },
  '.cm-payload-marker': {
    background: '#dcdcaa',
    color: '#1e1e1e',
    fontWeight: 'bold',
    borderRadius: '2px',
    padding: '0 3px',
    boxShadow: '0 0 4px rgba(220, 220, 170, 0.4)',
  },
}, { dark: true });

export default function RequestEditor({ value, onChange, theme, error }: RequestEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const createEditor = useCallback(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: value,
      extensions: [
        basicSetup,
        httpThemeDark,
        httpSyntaxPlugin,
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        CM.updateListener.of((update) => {
          if (update.docChanged) {
            const newValue = update.state.doc.toString();
            onChangeRef.current(newValue);
          }
        }),
        CM.lineWrapping,
      ],
    });

    const view = new CM({ state, parent: containerRef.current });
    editorRef.current = view;
    return view;
  }, []);

  const dispatchDocument = useCallback((nextValue: string, selectionAt?: number) => {
    const view = editorRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    view.dispatch({
      changes: { from: 0, to: current.length, insert: nextValue },
      ...(selectionAt == null ? {} : { selection: { anchor: selectionAt } }),
    });
    view.focus();
  }, []);

  const addPayloadMarker = useCallback(() => {
    const view = editorRef.current;
    if (!view) return;
    const { from, to } = view.state.selection.main;
    const current = view.state.doc.toString();
    if (from !== to) {
      // Selection exists: wrap selection in $, e.g. 2 -> $2$
      const selectedText = current.slice(from, to);
      const next = `${current.slice(0, from)}$${selectedText}$${current.slice(to)}`;
      dispatchDocument(next, from + selectedText.length + 2);
    } else {
      // No selection: insert $ at cursor
      const next = `${current.slice(0, from)}$${current.slice(to)}`;
      dispatchDocument(next, from + 1);
    }
  }, [dispatchDocument]);

  const clearPayloadMarkers = useCallback(() => {
    const view = editorRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    // Clear $VAL$ or $ markers
    const PH = "\x00LITERAL_DOLLAR\x00";
    let text = current.replace(/\$\$/g, PH);
    text = text.replace(/\$([^\$]*)\$/g, '$1');
    text = text.replace(/\$/g, '');
    dispatchDocument(text.replace(new RegExp(PH, 'g'), '$'));
  }, [dispatchDocument]);

  const autoAddPayloadMarker = useCallback(() => {
    const view = editorRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    const numericValue = /(?:[?&][\w-]+=\s*|["'][\w-]+["']\s*:\s*"?)(-?\d+)/.exec(current);
    if (!numericValue || numericValue.index == null) {
      addPayloadMarker();
      return;
    }
    const valStr = numericValue[1];
    const valueOffset = numericValue.index + numericValue[0].lastIndexOf(valStr);
    const next = `${current.slice(0, valueOffset)}$${valStr}$${current.slice(valueOffset + valStr.length)}`;
    dispatchDocument(next, valueOffset + valStr.length + 2);
  }, [addPayloadMarker, dispatchDocument]);

  const formatPretty = useCallback(() => {
    const view = editorRef.current;
    if (!view) return;
    const raw = view.state.doc.toString();
    if (!raw.trim()) return;

    // Split headers and body
    const parts = raw.split(/\r?\n\r?\n/);
    const headerPart = parts[0];
    const bodyPart = parts.slice(1).join('\n\n');

    let prettyBody = bodyPart;
    if (bodyPart.trim()) {
      try {
        // Temporarily mask $ markers so JSON.parse doesn't choke on unquoted $
        const masked = bodyPart.replace(/(:\s*)(\$)(?=[,}\s]|$)/g, '$1"__PAYLOAD_MARKER__"');
        const parsed = JSON.parse(masked);
        const formatted = JSON.stringify(parsed, null, 2);
        prettyBody = formatted.replace(/"__PAYLOAD_MARKER__"/g, '$');
      } catch {
        try {
          prettyBody = JSON.stringify(JSON.parse(bodyPart), null, 2);
        } catch {
          prettyBody = bodyPart.trim();
        }
      }
    }

    const headerLines = headerPart.split(/\r?\n/);
    const formattedHeaderLines = headerLines.map((line, idx) => {
      if (idx === 0) return line.trim();
      const colonIdx = line.indexOf(':');
      if (colonIdx > -1) {
        const key = line.slice(0, colonIdx).trim();
        const val = line.slice(colonIdx + 1).trim();
        return `${key}: ${val}`;
      }
      return line.trim();
    });

    const formattedRaw = prettyBody
      ? `${formattedHeaderLines.join('\n')}\n\n${prettyBody}`
      : formattedHeaderLines.join('\n');

    dispatchDocument(formattedRaw);
  }, [dispatchDocument]);

  useEffect(() => {
    const view = createEditor();
    return () => {
      view?.destroy();
      editorRef.current = null;
    };
  }, [createEditor]);

  useEffect(() => {
    const view = editorRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  return (
    <div className="request-editor-wrapper">
      <div className="position-toolbar">
        <span className="positions-label">Payload Positions</span>
        <button
          type="button"
          className="position-button"
          onClick={addPayloadMarker}
          title="Add $ payload marker at cursor or selection"
        >
          Add <b>$</b>
        </button>
        <button
          type="button"
          className="position-button"
          onClick={clearPayloadMarkers}
          title="Clear all $ payload markers"
        >
          Clear <b>$</b>
        </button>
        <button
          type="button"
          className="position-button"
          onClick={autoAddPayloadMarker}
          title="Auto detect parameter and add $ marker"
        >
          Auto <b>$</b>
        </button>
        <button
          type="button"
          className="position-button pretty-button"
          onClick={formatPretty}
          title="Make request and JSON body pretty"
        >
          Pretty
        </button>
      </div>

      <div
        ref={containerRef}
        className={`request-editor-cm ${error ? 'has-error' : ''}`}
      />

      {error && (
        <div className="editor-error">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M6.457 1.047c.659-1.234 2.427-1.234 3.086 0l6.082 11.378A1.75 1.75 0 0 1 14.082 15H1.918a1.75 1.75 0 0 1-1.543-2.575Zm1.763.707a.25.25 0 0 0-.44 0L1.698 13.132a.25.25 0 0 0 .22.368h12.164a.25.25 0 0 0 .22-.368Zm.53 3.996v2.5a.75.75 0 0 1-1.5 0v-2.5a.75.75 0 0 1 1.5 0ZM9 11a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z"/>
          </svg>
          {error}
        </div>
      )}
    </div>
  );
}
