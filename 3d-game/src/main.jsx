import { Component } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/cinzel/400.css';
import '@fontsource/cinzel/700.css';
import '@fontsource/cinzel/900.css';
import '@fontsource/cinzel-decorative/700.css';
import '@fontsource/cinzel-decorative/900.css';
import '@fontsource/almendra/400.css';
import '@fontsource/almendra/700.css';
import '@fontsource/jim-nightshade/400.css';
import './index.css';
import App from './App.jsx';

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('App crashed:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            background: '#05040a',
            color: '#f0e6d2',
            fontFamily: 'Cinzel, Georgia, serif',
            textAlign: 'center',
            zIndex: 99999,
          }}
        >
          <h1 style={{ color: '#e71d36', fontSize: 28, marginBottom: 12 }}>
            Something went wrong
          </h1>
          <pre
            style={{
              maxWidth: 800,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              background: 'rgba(255,255,255,0.04)',
              padding: 16,
              borderRadius: 8,
              border: '1px solid rgba(212,175,55,0.3)',
              fontSize: 13,
              lineHeight: 1.5,
              color: '#b8a88a',
            }}
          >
            {String(this.state.error?.message || this.state.error)}
          </pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              marginTop: 20,
              padding: '10px 24px',
              background: 'rgba(212,175,55,0.15)',
              border: '1px solid #d4af37',
              color: '#d4af37',
              fontFamily: 'inherit',
              fontSize: 14,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              cursor: 'pointer',
              borderRadius: 4,
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// Global error overlay: if ANY error occurs (even at module-evaluation
// time, before React mounts), show a visible message on the page so the
// user is never left staring at a blank screen.
function showFatalError(title, detail) {
  try {
    let el = document.getElementById('__fatal_overlay__');
    if (!el) {
      el = document.createElement('div');
      el.id = '__fatal_overlay__';
      el.style.cssText =
        'position:fixed;inset:0;display:flex;flex-direction:column;' +
        'align-items:center;justify-content:center;padding:24px;' +
        'background:#05040a;color:#f0e6d2;font-family:Cinzel,Georgia,serif;' +
        'text-align:center;z-index:99999;overflow:auto;';
      document.body.appendChild(el);
    }
    el.innerHTML =
      '<h1 style="color:#e71d36;font-size:28px;margin-bottom:12px;">' +
      title +
      '</h1>' +
      '<pre style="max-width:900px;white-space:pre-wrap;word-break:break-word;' +
      'background:rgba(255,255,255,0.04);padding:16px;border-radius:8px;' +
      'border:1px solid rgba(212,175,55,0.3);font-size:13px;line-height:1.5;' +
      'color:#b8a88a;text-align:left;">' +
      detail +
      '</pre>' +
      '<button onclick="window.location.reload()" ' +
      'style="margin-top:20px;padding:10px 24px;background:rgba(212,175,55,0.15);' +
      'border:1px solid #d4af37;color:#d4af37;font-family:inherit;font-size:14px;' +
      'letter-spacing:0.2em;text-transform:uppercase;cursor:pointer;' +
      'border-radius:4px;">Reload</button>';
  } catch (e) {
    // Last-resort: log to console only.
    console.error('showFatalError failed', e);
  }
}

window.addEventListener('error', (event) => {
  showFatalError(
    'Something went wrong',
    String(
      (event.error && (event.error.stack || event.error.message)) ||
        event.message ||
        'Unknown error'
    )
  );
});

window.addEventListener('unhandledrejection', (event) => {
  showFatalError(
    'Unhandled promise rejection',
    String(
      (event.reason && (event.reason.stack || event.reason.message)) ||
        event.reason ||
        'Unknown'
    )
  );
});

try {
  createRoot(document.getElementById('root')).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
} catch (err) {
  showFatalError('Failed to mount app', String(err && (err.stack || err.message) || err));
}
