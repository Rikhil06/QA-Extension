// Injected into the page's MAIN world (not the isolated content-script world) so it can
// see console.error/warn calls made by the page's own scripts. Emits redacted, capped
// entries via a CustomEvent that content.js (isolated world) listens for — the two worlds
// share the DOM event target even though they don't share JS objects.
(() => {
  if (window.__QA_CONSOLE_CAPTURE__) return;
  window.__QA_CONSOLE_CAPTURE__ = true;

  const MAX_MSG_LENGTH = 500;
  const MAX_BUFFERED_LOGS = 25;

  // Runs at document_start, before content.js exists, so entries captured here would
  // otherwise be lost the moment they're emitted. Buffer them here and let content.js pull
  // the full backlog (via qa-console-buffer-request) whenever it gets injected, instead of
  // only relying on live 'qa-console-entry' events it might not be listening for yet.
  const logBuffer = [];

  // Defense-in-depth redaction — never forward auth tokens, API keys, or obvious PII.
  const JWT_RE = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
  const BEARER_RE = /Bearer\s+[A-Za-z0-9._-]+/gi;
  const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const LONG_NUMBER_RE = /\b(?:\d[ -]?){13,19}\b/g; // credit-card-shaped sequences
  const SENSITIVE_KV_RE =
    /(["']?(?:password|passwd|token|secret|api[_-]?key|access[_-]?key|auth(?:orization)?|session|cookie|credential|private[_-]?key)["']?\s*[:=]\s*)(["']?)([^,"'\s}]+)\2/gi;

  function redact(str) {
    if (!str) return str;
    return str
      .replace(JWT_RE, '[REDACTED_TOKEN]')
      .replace(BEARER_RE, 'Bearer [REDACTED]')
      .replace(SENSITIVE_KV_RE, '$1$2[REDACTED]$2')
      .replace(EMAIL_RE, '[REDACTED_EMAIL]')
      .replace(LONG_NUMBER_RE, '[REDACTED_NUMBER]');
  }

  function stringifyArg(arg) {
    if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
    if (typeof arg === 'string') return arg;
    if (typeof arg === 'object' && arg !== null) {
      try {
        return JSON.stringify(arg);
      } catch {
        return '[Unserializable object]';
      }
    }
    return String(arg);
  }

  function emit(level, rawMessage) {
    let message = redact(rawMessage);
    if (message.length > MAX_MSG_LENGTH) message = message.slice(0, MAX_MSG_LENGTH) + '…';
    const entry = { level, message, timestamp: new Date().toISOString() };

    logBuffer.push(entry);
    if (logBuffer.length > MAX_BUFFERED_LOGS) logBuffer.shift();

    window.dispatchEvent(new CustomEvent('qa-console-entry', { detail: entry }));
  }

  // content.js calls this on init to back-fill anything captured before it was injected.
  window.addEventListener('qa-console-buffer-request', () => {
    window.dispatchEvent(new CustomEvent('qa-console-buffer-response', { detail: logBuffer.slice() }));
  });

  const originalError = console.error.bind(console);
  const originalWarn = console.warn.bind(console);

  console.error = function (...args) {
    try { emit('error', args.map(stringifyArg).join(' ')); } catch { /* never break the page */ }
    return originalError(...args);
  };

  console.warn = function (...args) {
    try { emit('warn', args.map(stringifyArg).join(' ')); } catch { /* never break the page */ }
    return originalWarn(...args);
  };

  // Uncaught exceptions and unhandled promise rejections are surfaced by the browser as
  // console errors too — capture them even when the page never calls console.error itself.
  window.addEventListener('error', (e) => {
    try {
      const location = e.filename ? ` (${e.filename}:${e.lineno}:${e.colno})` : '';
      emit('error', `${e.message}${location}`);
    } catch { /* never break the page */ }
  });

  window.addEventListener('unhandledrejection', (e) => {
    try {
      emit('error', stringifyArg(e.reason));
    } catch { /* never break the page */ }
  });
})();
