(() => {
  // Cross-browser shim — use `browser` in Firefox, fall back to `chrome` in Chrome.
  const ext = typeof browser !== 'undefined' ? browser : chrome;

  // Screen recording requires tabCapture + offscreen, which are Chrome-only.
  // In Firefox this is false and all recording UI is hidden.
  const canRecord = !!ext.tabCapture?.getMediaStreamId;

  const FLAG = '__QA_SCRIPT_LOADED__';

  if (window[FLAG]) {
    // Script already loaded — just re-enable QA mode
    if (typeof window.__QA_ENABLE__ === 'function') {
      window.__QA_ENABLE__();
    }
    return;
  }
  window[FLAG] = true;

  // ✅ your whole script goes here, inside this block

  // ─── URLs ───────────────────────────────────────────────────────────────
  // Change these constants when you deploy to a new environment.
  const BACKEND_URL   = 'https://qa-backend-105l.onrender.com';
  const DASHBOARD_URL = 'https://annoture.com'; // frontend — used for upgrade links
  // ─────────────────────────────────────────────────────────────────────────

  function scrubSensitiveParams(url) {
    try {
      const u = new URL(url);
      const sensitive = ['token', 'access_token', 'code', 'key', 'secret', 'password', 'auth', 'api_key', 'apikey', 'session'];
      sensitive.forEach(p => u.searchParams.delete(p));
      return u.toString();
    } catch {
      return url;
    }
  }

  let qaOverlay = null;
  let qaBanner = null;
  let captureBtn = null;
  let qaEnabled = true;
  let captureArmed = false; // true only while waiting for the user's one capture click

  // Rolling buffer of redacted console errors/warnings, fed by console-capture.js
  // (running in the page's MAIN world) via a shared DOM CustomEvent.
  const MAX_CONSOLE_LOGS = 25;
  let consoleLogs = [];
  window.addEventListener('qa-console-entry', (e) => {
    consoleLogs.push(e.detail);
    if (consoleLogs.length > MAX_CONSOLE_LOGS) consoleLogs.shift();
  });

  // console-capture.js runs from page load (document_start), well before content.js gets
  // injected — back-fill anything it already buffered so early page-load errors aren't lost.
  window.addEventListener('qa-console-buffer-response', (e) => {
    if (Array.isArray(e.detail)) consoleLogs = e.detail.slice(-MAX_CONSOLE_LOGS);
  });
  window.dispatchEvent(new CustomEvent('qa-console-buffer-request'));

  // Start the rolling recording buffer as soon as QA mode activates.
  // Silently ignored if tabCapture is unavailable or the team isn't on the agency plan —
  // the backend will simply not store videoPath and the report works normally.
  function startRollingRecording() {
    if (!canRecord) return;
    ext.runtime.sendMessage({ type: 'START_RECORDING' }, () => {
      void ext.runtime.lastError;
    });
  }

  window.__QA_ENABLE__ = () => {
    qaEnabled = true;
    showBanner();
    startRollingRecording();
  };

  showBanner();
  startRollingRecording();

  function showBanner() {
    qaBanner = document.createElement('div');
    Object.assign(qaBanner.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100%',
      padding: '10px 16px',
      background: '#000',
      color: '#fff',
      fontSize: '14px',
      fontFamily: 'Arial, sans-serif',
      zIndex: '1000001',
      textAlign: 'center',
      boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxSizing: 'border-box',
    });

    const bannerText = document.createElement('span');
    bannerText.textContent = '🛠️ QA Mode — Browse normally, then click Capture to report an issue.';

    // ── Capture button ──────────────────────────────────────────────────────
    captureBtn = document.createElement('button');
    captureBtn.textContent = '+ Capture';
    Object.assign(captureBtn.style, {
      background: '#7c3aed',
      border: 'none',
      color: '#fff',
      fontSize: '12px',
      fontWeight: '600',
      cursor: 'pointer',
      padding: '5px 12px',
      borderRadius: '20px',
      marginLeft: '12px',
      letterSpacing: '0.2px',
      transition: 'background 0.15s, transform 0.1s',
      fontFamily: 'inherit',
      flexShrink: '0',
    });
    captureBtn.addEventListener('mouseenter', () => { captureBtn.style.background = '#6d28d9'; });
    captureBtn.addEventListener('mouseleave', () => {
      captureBtn.style.background = captureArmed ? '#16a34a' : '#7c3aed';
    });
    captureBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (captureArmed) {
        disarmCapture();
      } else {
        armCapture();
      }
    });

    // ── Close button ────────────────────────────────────────────────────────
    const closeBtn = document.createElement('button');
    closeBtn.title = 'Exit QA Mode';
    closeBtn.textContent = '✕';
    Object.assign(closeBtn.style, {
      position: 'absolute',
      right: '16px',
      top: '50%',
      transform: 'translateY(-50%)',
      background: 'transparent',
      border: 'none',
      color: 'rgba(255,255,255,0.6)',
      fontSize: '16px',
      cursor: 'pointer',
      lineHeight: '1',
      padding: '2px 6px',
      borderRadius: '4px',
      transition: 'color 0.15s, background 0.15s',
    });
    closeBtn.addEventListener('mouseenter', () => {
      closeBtn.style.color = '#fff';
      closeBtn.style.background = 'rgba(255,255,255,0.1)';
    });
    closeBtn.addEventListener('mouseleave', () => {
      closeBtn.style.color = 'rgba(255,255,255,0.6)';
      closeBtn.style.background = 'transparent';
    });
    closeBtn.addEventListener('click', () => cleanupQA());

    qaBanner.appendChild(bannerText);
    qaBanner.appendChild(captureBtn);
    qaBanner.appendChild(closeBtn);
    document.body.appendChild(qaBanner);
  }

  function removeBanner() {
    if (qaBanner) qaBanner.remove();
  }

  function armCapture() {
    if (captureArmed) return;
    captureArmed = true;

    // Update button to show armed state
    captureBtn.textContent = '✕ Cancel';
    captureBtn.style.background = '#16a34a';
    captureBtn.title = 'Click anywhere on the page to capture, or press Escape to cancel';

    // Full-page transparent overlay to intercept exactly ONE click
    qaOverlay = document.createElement('div');
    Object.assign(qaOverlay.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100vw',
      height: '100vh',
      zIndex: '999999',
      cursor: 'crosshair',
      background: 'rgba(0, 0, 0, 0.01)',
    });
    document.body.appendChild(qaOverlay);
    qaOverlay.addEventListener('click', handleClick);

    // Escape key cancels armed mode
    document.addEventListener('keydown', onCaptureEscape);
  }

  function disarmCapture() {
    captureArmed = false;
    if (qaOverlay) { qaOverlay.remove(); qaOverlay = null; }
    document.removeEventListener('keydown', onCaptureEscape);
    if (captureBtn) {
      captureBtn.textContent = '+ Capture';
      captureBtn.style.background = '#7c3aed';
      captureBtn.title = '';
    }
    document.body.style.cursor = '';
  }

  function onCaptureEscape(e) {
    if (e.key === 'Escape') disarmCapture();
  }

  // Legacy references kept for cleanupQA
  function disableQAOverlay() { disarmCapture(); }

  async function handleClick(e) {
    e.preventDefault();
    e.stopPropagation();

    // Disarm immediately so the overlay doesn't catch subsequent clicks
    disarmCapture();

    // Briefly remove the overlay so elementFromPoint sees the real page element
    if (qaOverlay) qaOverlay.style.display = 'none';
    const clickedEl = document.elementFromPoint(e.clientX, e.clientY);
    if (qaOverlay) qaOverlay.style.display = '';
    const clickedCSSPath = getCSSPath(clickedEl);

    const marker = document.createElement('div');
    marker.className = 'qa-marker';
    Object.assign(marker.style, {
      position: 'absolute',
      left: `${e.pageX - 10}px`,
      top: `${e.pageY - 10}px`,
      width: '20px',
      height: '20px',
      background: 'red',
      borderRadius: '50%',
      border: '2px solid white',
      zIndex: '1000000',
      pointerEvents: 'none',
    });
    document.body.appendChild(marker);

    const style = document.createElement('style');
    style.textContent = `
    .qa-marker { animation: pulse 1s ease-out; }
    @keyframes pulse {
      0% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.3); opacity: 0.6; }
      100% { transform: scale(1); opacity: 1; }
    }
  `;
    document.head.appendChild(style);

    await new Promise((res) => setTimeout(res, 150)); // let the marker render

    // Snapshot the rolling recording buffer RIGHT NOW — before the modal opens.
    // By the time the user fills in the form and hits Submit, the 10-second buffer
    // would have overwritten the page activity and only contain the modal itself.
    const recordingPromise = canRecord
      ? new Promise((resolve) => {
          ext.runtime.sendMessage({ type: 'EXTRACT_RECORDING' }, (response) => {
            void ext.runtime.lastError;
            if (response?.base64) {
              try {
                const binary = atob(response.base64);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                resolve(new Blob([bytes.buffer], { type: 'video/webm' }));
              } catch {
                resolve(null);
              }
            } else {
              resolve(null);
            }
          });
        })
      : Promise.resolve(null);

    ext.runtime.sendMessage({ type: 'CAPTURE_SCREENSHOT' }, (response) => {
      if (response?.dataUrl) {
        showScreenshotModal(response.dataUrl, e.pageX, e.pageY, marker, clickedCSSPath, recordingPromise);
      } else {
        showToast('Failed to capture screenshot: ' + (response?.error || 'Unknown error'), 'error');
        marker.remove();
      }
    });
  }

  function dataURLtoBlob(dataurl) {
    const arr = dataurl.split(',');
    const mime = arr[0].match(/:(.*?);/)[1];
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
  }

  function compressScreenshot(dataUrl, quality = 0.7) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const MAX_W = 1920;
        const scale = img.width > MAX_W ? MAX_W / img.width : 1;
        const canvas = document.createElement('canvas');
        canvas.width  = Math.round(img.width  * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error('Failed to compress screenshot'));
        }, 'image/jpeg', quality);
      };
      img.onerror = () => reject(new Error('Failed to load screenshot for compression'));
      img.src = dataUrl;
    });
  }

  function fetchWithTimeout(url, options = {}, timeout = 15000) {
    return Promise.race([
      fetch(url, options),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Request timed out')), timeout)),
    ]);
  }

  async function fetchUserTeams(token) {
    try {
      const res = await fetchWithTimeout(
        `${BACKEND_URL}/api/teams`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  // ─── Toast notification ───────────────────────────────────────────────────
  let toastContainer = null;

  function getToastContainer() {
    if (toastContainer && document.body.contains(toastContainer)) return toastContainer;
    toastContainer = document.createElement('div');
    Object.assign(toastContainer.style, {
      position: 'fixed',
      top: '1rem',
      right: '1rem',
      zIndex: '2147483647',
      display: 'flex',
      flexDirection: 'column',
      gap: '0.5rem',
      pointerEvents: 'none',
    });
    document.body.appendChild(toastContainer);
    return toastContainer;
  }

  function showToast(message, type = 'success') {
    const colors = {
      success: { bg: '#1a3d2b', border: '#22c55e', icon: '✓', text: '#4ade80' },
      error:   { bg: '#3d1a1a', border: '#ef4444', icon: '✕', text: '#f87171' },
      warning: { bg: '#3d2e1a', border: '#f59e0b', icon: '!', text: '#fbbf24' },
    };
    const c = colors[type] || colors.success;
    const container = getToastContainer();

    const toast = document.createElement('div');
    Object.assign(toast.style, {
      display: 'flex',
      alignItems: 'center',
      gap: '0.625rem',
      backgroundColor: c.bg,
      border: `1px solid ${c.border}`,
      borderRadius: '0.5rem',
      padding: '0.75rem 1rem',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '14px',
      color: '#fff',
      boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
      pointerEvents: 'auto',
      minWidth: '220px',
      maxWidth: '360px',
      transform: 'translateX(110%)',
      transition: 'transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.2s ease',
      opacity: '0',
    });

    const iconEl = document.createElement('span');
    iconEl.textContent = c.icon;
    Object.assign(iconEl.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '18px',
      height: '18px',
      borderRadius: '50%',
      border: `1.5px solid ${c.text}`,
      color: c.text,
      fontSize: '11px',
      fontWeight: 'bold',
      flexShrink: '0',
    });

    const msgEl = document.createElement('span');
    msgEl.textContent = message;
    msgEl.style.lineHeight = '1.4';

    toast.appendChild(iconEl);
    toast.appendChild(msgEl);
    container.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        toast.style.transform = 'translateX(0)';
        toast.style.opacity = '1';
      });
    });

    // Auto-dismiss
    const dismiss = () => {
      toast.style.transform = 'translateX(110%)';
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 250);
    };

    const timer = setTimeout(dismiss, type === 'error' ? 5000 : 3000);
    toast.addEventListener('click', () => { clearTimeout(timer); dismiss(); });

    return toast;
  }

  // Shown when the backend returns 402/403 (plan limit hit)
  function showUpgradeToast(message) {
    const container = getToastContainer();

    const toast = document.createElement('div');
    Object.assign(toast.style, {
      display: 'flex',
      flexDirection: 'column',
      gap: '10px',
      backgroundColor: '#1e1535',
      border: '1px solid #7c3aed',
      borderRadius: '0.5rem',
      padding: '0.875rem 1rem',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      fontSize: '14px',
      color: '#fff',
      boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
      pointerEvents: 'auto',
      minWidth: '260px',
      maxWidth: '360px',
      transform: 'translateX(110%)',
      transition: 'transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.2s ease',
      opacity: '0',
    });

    const msgEl = document.createElement('p');
    msgEl.textContent = message;
    Object.assign(msgEl.style, { margin: '0', color: 'rgba(255,255,255,0.85)', lineHeight: '1.4' });

    const upgradeBtn = document.createElement('button');
    upgradeBtn.textContent = 'Upgrade plan →';
    Object.assign(upgradeBtn.style, {
      alignSelf: 'flex-start',
      background: '#7c3aed',
      color: '#fff',
      border: 'none',
      borderRadius: '6px',
      padding: '6px 12px',
      fontSize: '13px',
      fontWeight: '600',
      cursor: 'pointer',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      transition: 'background 0.15s',
    });
    upgradeBtn.addEventListener('mouseenter', () => { upgradeBtn.style.background = '#6d28d9'; });
    upgradeBtn.addEventListener('mouseleave', () => { upgradeBtn.style.background = '#7c3aed'; });
    upgradeBtn.addEventListener('click', () => {
      ext.tabs.create({ url: `${DASHBOARD_URL}/usage-billing` });
      dismiss();
    });

    toast.appendChild(msgEl);
    toast.appendChild(upgradeBtn);
    container.appendChild(toast);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        toast.style.transform = 'translateX(0)';
        toast.style.opacity = '1';
      });
    });

    const dismiss = () => {
      toast.style.transform = 'translateX(110%)';
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 250);
    };

    // Stay visible longer — user needs time to read and act
    const timer = setTimeout(dismiss, 10000);
    toast.addEventListener('click', (e) => {
      if (e.target !== upgradeBtn) { clearTimeout(timer); dismiss(); }
    });
  }

  // ─── Inline field validation ──────────────────────────────────────────────
  function showFieldError(inputEl, message) {
    clearFieldError(inputEl);
    inputEl.style.borderColor = '#ef4444';
    const err = document.createElement('p');
    err.className = '__qa_field_err__';
    err.textContent = message;
    Object.assign(err.style, {
      color: '#f87171',
      fontSize: '12px',
      marginTop: '4px',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    });
    inputEl.parentNode.appendChild(err);
    const clear = () => clearFieldError(inputEl);
    inputEl.addEventListener('input', clear, { once: true });
    inputEl.addEventListener('change', clear, { once: true });
  }

  function clearFieldError(inputEl) {
    inputEl.style.borderColor = 'rgba(255, 255, 255, 0.05)';
    const prev = inputEl.parentNode?.querySelector('.__qa_field_err__');
    if (prev) prev.remove();
  }
  // ─────────────────────────────────────────────────────────────────────────

  function showScreenshotModal(image, x, y, marker, cssPath, recordingPromise) {
    const closeModal = () => {
      overlay.remove();
      marker.remove();
      document.removeEventListener('keydown', onKeyDown);
    };

    const onKeyDown = (e) => {
      if (e.key === 'Escape') closeModal();
    };
    document.addEventListener('keydown', onKeyDown);

    const overlay = document.createElement('div');
    Object.assign(overlay.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100vw',
      height: '100vh',
      background: 'rgba(0,0,0,0.5)',
      zIndex: '1000002',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    });

    const modal = document.createElement('div');
    Object.assign(modal.style, {
      backgroundColor: '#1c1c1c',
      borderRadius: '14px',
      boxShadow: '0 32px 64px rgba(0,0,0,0.6)',
      border: '1px solid rgba(255,255,255,0.07)',
      width: '100%',
      maxWidth: '480px',
      maxHeight: '92vh',
      overflow: 'auto',
      fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
    });

    const img = document.createElement('img');
    img.src = image;
    img.style.width = '100%';
    img.style.borderRadius = '4px';
    img.alt = 'Screenshot';

    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '20px 24px',
      borderBottom: '1px solid rgba(255,255,255,0.06)',
    });

    const headerTitle = document.createElement('h2');
    headerTitle.textContent = 'Report Issue';
    Object.assign(headerTitle.style, {
      color: '#fff',
      fontSize: '18px',
      fontWeight: '600',
      letterSpacing: '-0.2px',
    });

    const headerButton = document.createElement('button');
    Object.assign(headerButton.style, {
      color: 'rgba(255,255,255,0.4)',
      background: 'none',
      border: 'none',
      cursor: 'pointer',
      fontSize: '18px',
      lineHeight: '1',
      padding: '2px',
      transition: 'color 0.15s',
    });
    headerButton.addEventListener('mouseenter', () => { headerButton.style.color = '#fff'; });
    headerButton.addEventListener('mouseleave', () => { headerButton.style.color = 'rgba(255,255,255,0.4)'; });

    const headerButtonContent = document.createElement('span');
    headerButtonContent.textContent = '✕';
    headerButton.onclick = () => closeModal();

    const imageWrapper = document.createElement('div');
    Object.assign(imageWrapper.style, {
      padding: '20px 24px',
      borderBottom: '1px solid rgba(255,255,255,0.06)',
    });

    const imageInner = document.createElement('div');
    Object.assign(imageInner.style, {
      backgroundColor: '#141414',
      borderRadius: '8px',
      overflow: 'hidden',
      border: '1px solid rgba(255,255,255,0.07)',
    });

    const markerText = document.createElement('p');
    markerText.textContent = 'Click location marked on screenshot';
    Object.assign(markerText.style, {
      marginTop: '10px',
      color: 'rgba(255,255,255,0.35)',
      fontSize: '12px',
    });

    // ── Environment info bar ─────────────────────────────────────────────────
    const envBar = document.createElement('div');
    Object.assign(envBar.style, {
      padding: '14px 24px',
      borderBottom: '1px solid rgba(255,255,255,0.06)',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
    });

    const envRows = [
      { label: 'URL',      value: window.location.href },
      { label: 'Browser',  value: getBrowserFull() },
      { label: 'OS',       value: getOSFull() },
      { label: 'Viewport', value: `${window.innerWidth} × ${window.innerHeight}` },
    ];

    envRows.forEach(({ label, value }) => {
      const row = document.createElement('div');
      Object.assign(row.style, {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        minWidth: '0',
      });

      const lbl = document.createElement('span');
      lbl.textContent = label;
      Object.assign(lbl.style, {
        flexShrink: '0',
        width: '56px',
        fontSize: '11px',
        fontWeight: '500',
        color: 'rgba(255,255,255,0.35)',
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
      });

      const val = document.createElement('span');
      val.textContent = value;
      Object.assign(val.style, {
        flex: '1',
        fontSize: '12px',
        color: 'rgba(255,255,255,0.65)',
        backgroundColor: '#222',
        border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: '6px',
        padding: '4px 10px',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        fontFamily: 'ui-monospace, "Cascadia Code", monospace',
      });
      // Show full URL on hover via title tooltip
      val.title = value;

      row.appendChild(lbl);
      row.appendChild(val);
      envBar.appendChild(row);
    });
    // ─────────────────────────────────────────────────────────────────────────

    const form = document.createElement('div');
    Object.assign(form.style, {
      padding: '20px 24px',
      display: 'flex',
      flexDirection: 'column',
      gap: '18px',
    });

    const fieldStyle = {
      width: '100%',
      backgroundColor: '#252525',
      color: '#ffffff',
      padding: '11px 14px',
      borderRadius: '8px',
      border: '1px solid rgba(255,255,255,0.08)',
      outline: 'none',
      fontSize: '14px',
      transition: 'border-color 0.2s',
      fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
      boxSizing: 'border-box',
    };

    const labelStyle = {
      display: 'block',
      color: 'rgba(255,255,255,0.5)',
      fontSize: '13px',
      fontWeight: '500',
      marginBottom: '7px',
    };

    const issueWrapper = document.createElement('div');
    const issueLabel = document.createElement('label');
    issueLabel.textContent = 'Name of Issue';
    Object.assign(issueLabel.style, labelStyle);

    const issueInput = document.createElement('input');
    issueInput.placeholder = 'Brief title for the issue';
    issueInput.required = true;
    issueInput.type = 'text';
    Object.assign(issueInput.style, fieldStyle);
    issueInput.addEventListener('focus', () => { issueInput.style.borderColor = '#4f9eff'; });
    issueInput.addEventListener('blur',  () => { issueInput.style.borderColor = 'rgba(255,255,255,0.08)'; });

    const descriptionWrapper = document.createElement('div');
    const descriptionLabel = document.createElement('label');
    descriptionLabel.textContent = 'Description';
    Object.assign(descriptionLabel.style, labelStyle);

    const descriptionInput = document.createElement('textarea');
    descriptionInput.required = true;
    descriptionInput.placeholder = 'Describe the issue in detail...';
    descriptionInput.rows = 5;
    Object.assign(descriptionInput.style, { ...fieldStyle, resize: 'vertical' });
    descriptionInput.addEventListener('focus', () => { descriptionInput.style.borderColor = '#4f9eff'; });
    descriptionInput.addEventListener('blur',  () => { descriptionInput.style.borderColor = 'rgba(255,255,255,0.08)'; });

    // ---------- Team selector (only shown when user belongs to multiple teams) ----------
    const teamWrapper = document.createElement('div');
    Object.assign(teamWrapper.style, { display: 'none' });

    const teamLabel = document.createElement('label');
    teamLabel.textContent = 'Submit as team';
    Object.assign(teamLabel.style, labelStyle);

    const teamSelect = document.createElement('select');
    teamSelect.required = false;
    Object.assign(teamSelect.style, { ...fieldStyle, cursor: 'pointer' });
    teamSelect.addEventListener('focus', () => { teamSelect.style.borderColor = '#4f9eff'; });
    teamSelect.addEventListener('blur',  () => { teamSelect.style.borderColor = 'rgba(255,255,255,0.08)'; });

    teamWrapper.appendChild(teamLabel);
    teamWrapper.appendChild(teamSelect);
    form.appendChild(teamWrapper);

    // Populate teams asynchronously — show selector only if user is in multiple teams
    ext.storage.session.get(['token'], async ({ token }) => {
      const teams = await fetchUserTeams(token);
      if (teams.length <= 1) {
        // Single team — pre-select silently and leave the selector hidden
        if (teams.length === 1) teamSelect.dataset.autoTeamId = teams[0].id;
        return;
      }
      teamWrapper.style.display = 'block';
      teams.forEach((team) => {
        const opt = document.createElement('option');
        opt.value = team.id;
        opt.textContent = team.name;
        teamSelect.appendChild(opt);
      });
    });

    // Grid wrapper (grid grid-cols-2 gap-4)
    const fieldGrid = document.createElement('div');
    Object.assign(fieldGrid.style, {
      display: 'grid',
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
      gap: '14px',
    });

    // ---------- Priority field ----------
    const priorityWrapper = document.createElement('div');

    const priorityLabel = document.createElement('label');
    priorityLabel.textContent = 'Priority';
    Object.assign(priorityLabel.style, labelStyle);

    const prioritySelect = document.createElement('select');
    prioritySelect.required = true;
    Object.assign(prioritySelect.style, { ...fieldStyle, cursor: 'pointer' });
    prioritySelect.addEventListener('focus', () => { prioritySelect.style.borderColor = '#4f9eff'; });
    prioritySelect.addEventListener('blur',  () => { prioritySelect.style.borderColor = 'rgba(255,255,255,0.08)'; });

    ['Not Assigned', 'Low', 'Medium', 'High', 'Urgent'].forEach((value) => {
      const option = document.createElement('option');
      option.value = value.toLowerCase();
      option.textContent = value;
      prioritySelect.appendChild(option);
    });

    priorityWrapper.appendChild(priorityLabel);
    priorityWrapper.appendChild(prioritySelect);

    // ---------- Issue Type field ----------
    const typeWrapper = document.createElement('div');

    const typeLabel = document.createElement('label');
    typeLabel.textContent = 'Issue Type';
    Object.assign(typeLabel.style, labelStyle);

    // Hidden input so typeSelect.value still works for form submission
    const typeSelect = document.createElement('input');
    typeSelect.type = 'hidden';
    typeSelect.value = 'bug';

    const typeOptions = ['Bug', 'Suggestion', 'Task'];

    const typeBtn = document.createElement('button');
    typeBtn.type = 'button';
    typeBtn.textContent = 'Bug';
    Object.assign(typeBtn.style, {
      ...fieldStyle,
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      textAlign: 'left',
    });
    typeBtn.innerHTML = `<span>Bug</span><span style="opacity:0.4;font-size:11px;">▾</span>`;

    const typeDropdown = document.createElement('div');
    Object.assign(typeDropdown.style, {
      display: 'none',
      position: 'absolute',
      top: '100%',
      left: '0',
      right: '0',
      marginTop: '4px',
      backgroundColor: '#252525',
      border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: '8px',
      zIndex: '99999',
      overflow: 'hidden',
      boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
    });

    typeOptions.forEach((label) => {
      const item = document.createElement('div');
      item.textContent = label;
      Object.assign(item.style, {
        padding: '10px 14px',
        fontSize: '14px',
        color: '#fff',
        cursor: 'pointer',
        fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
      });
      item.addEventListener('mouseenter', () => { item.style.backgroundColor = 'rgba(255,255,255,0.08)'; });
      item.addEventListener('mouseleave', () => { item.style.backgroundColor = 'transparent'; });
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        typeSelect.value = label.toLowerCase();
        typeBtn.replaceChildren();
        const labelSpan = document.createElement('span');
        labelSpan.textContent = label;
        const arrowSpan = document.createElement('span');
        arrowSpan.style.cssText = 'opacity:0.4;font-size:11px;';
        arrowSpan.textContent = '▾';
        typeBtn.appendChild(labelSpan);
        typeBtn.appendChild(arrowSpan);
        typeDropdown.style.display = 'none';
        typeBtn.style.borderColor = 'rgba(255,255,255,0.08)';
      });
      typeDropdown.appendChild(item);
    });

    typeBtn.addEventListener('click', () => {
      const isOpen = typeDropdown.style.display === 'block';
      typeDropdown.style.display = isOpen ? 'none' : 'block';
      typeBtn.style.borderColor = isOpen ? 'rgba(255,255,255,0.08)' : '#4f9eff';
    });

    document.addEventListener('mousedown', (e) => {
      if (!typeWrapper.contains(e.target)) {
        typeDropdown.style.display = 'none';
        typeBtn.style.borderColor = 'rgba(255,255,255,0.08)';
      }
    }, { capture: true });

    const btnRow = document.createElement('div');
    Object.assign(btnRow.style, {
      display: 'flex',
      gap: '10px',
      padding: '4px 24px 24px',
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    Object.assign(cancelBtn.style, {
      flex: '1',
      backgroundColor: '#2a2a2a',
      color: 'rgba(255,255,255,0.8)',
      padding: '13px',
      borderRadius: '8px',
      border: '1px solid rgba(255,255,255,0.1)',
      cursor: 'pointer',
      fontSize: '14px',
      fontWeight: '500',
      transition: 'background-color 0.2s',
      fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
    });
    cancelBtn.addEventListener('mouseenter', () => { cancelBtn.style.backgroundColor = '#333'; });
    cancelBtn.addEventListener('mouseleave', () => { cancelBtn.style.backgroundColor = '#2a2a2a'; });
    cancelBtn.onclick = () => closeModal();

    const submitBtn = document.createElement('button');
    submitBtn.textContent = 'Submit Issue';
    Object.assign(submitBtn.style, {
      flex: '1',
      backgroundColor: '#4f9eff',
      color: '#ffffff',
      padding: '13px',
      borderRadius: '8px',
      border: 'none',
      cursor: 'pointer',
      fontSize: '14px',
      fontWeight: '600',
      transition: 'background-color 0.2s',
      fontFamily: 'ui-sans-serif, system-ui, -apple-system, sans-serif',
    });
    submitBtn.addEventListener('mouseenter', () => { submitBtn.style.backgroundColor = '#3d8ae6'; });
    submitBtn.addEventListener('mouseleave', () => { submitBtn.style.backgroundColor = '#4f9eff'; });

    let isSubmitting = false;

    submitBtn.onclick = async () => {
      // Prevent double-submit — ignore any click while a request is in flight
      if (isSubmitting) return;

      const title = issueInput.value.trim();
      const comment = descriptionInput.value.trim();
      const priority = prioritySelect.value;
      const type = typeSelect.value;

      let hasError = false;
      if (!title) { showFieldError(issueInput, 'Please enter a title for the issue.'); hasError = true; }
      if (!comment) { showFieldError(descriptionInput, 'Please enter a description.'); hasError = true; }
      if (hasError) return;

      // Lock the button immediately before any async work
      isSubmitting = true;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Submitting…';
      submitBtn.style.opacity = '0.6';
      submitBtn.style.cursor = 'not-allowed';

      const unlock = () => {
        isSubmitting = false;
        submitBtn.disabled = false;
        submitBtn.textContent = 'Submit Issue';
        submitBtn.style.opacity = '1';
        submitBtn.style.cursor = 'pointer';
      };

      let screenshotBlob;
      try {
        screenshotBlob = await compressScreenshot(image);
      } catch (err) {
        showToast('Failed to process screenshot: ' + err.message, 'error');
        unlock();
        return;
      }

      ext.storage.session.get(['token', 'user'], async ({ token, user }) => {
        const result = { token, user };

        if (!token) {
          showToast('You must be logged in to submit a report.', 'error');
          unlock();
          return;
        }

        // Use selected team if selector is visible, otherwise fall back to auto-selected or first team
        const teamId =
          teamWrapper.style.display !== 'none'
            ? teamSelect.value
            : (teamSelect.dataset.autoTeamId || user?.teams?.[0]?.teamId);

        if (!teamId) {
          showToast('No team found for this account.', 'error');
          unlock();
          return;
        }

        // The recording was already extracted at click time (before this modal opened) so
        // the buffer contains page activity, not 30 seconds of form-filling.
        const videoBlob = await (recordingPromise ?? Promise.resolve(null));

        const formData = new FormData();
        formData.append('screenshot', screenshotBlob, 'screenshot.png');
        if (videoBlob) formData.append('video', videoBlob, 'recording.webm');
        formData.append('title', title);
        formData.append('comment', comment);
        formData.append('priority', priority);
        formData.append('type', type);
        formData.append('url', scrubSensitiveParams(window.location.href));
        formData.append('pageTitle', document.title);
        formData.append('browser', getBrowserFull());
        formData.append('os', getOSFull());
        formData.append('screenSize', `${screen.width}x${screen.height}`);
        formData.append('viewport', `${window.innerWidth}x${window.innerHeight}`);
        formData.append('cssPath', cssPath || '');
        formData.append('consoleLogs', JSON.stringify(consoleLogs));
        formData.append('x', x.toString());
        formData.append('y', y.toString());
        formData.append('teamId', teamId);

        try {
          const res = await fetchWithTimeout(
            `${BACKEND_URL}/api/report`,
            {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}` },
              body: formData,
            },
            30000 // 30s for multipart uploads
          );

          if (!res.ok) {
            // Read as text first so HTML/plain-text bodies never crash JSON.parse
            let errorMsg = `Server error: ${res.status} ${res.statusText}`;
            try {
              const text = await res.text();
              if (text && !text.trimStart().startsWith('<')) {
                const data = JSON.parse(text);
                if (data && data.error) errorMsg = data.error;
              }
            } catch (parseErr) { /* keep default message */ }

            // Session expired — clear stored credentials and prompt re-login
            if (res.status === 401) {
              ext.storage.session.remove(['token', 'user']);
              unlock();
              showToast('Your session has expired. Click the Annoture icon to log in again.', 'error');
              return;
            }

            // Plan limit errors — show upgrade CTA instead of plain error toast
            if (res.status === 402 || res.status === 403) {
              unlock();
              showUpgradeToast(errorMsg);
              return;
            }

            throw new Error(errorMsg);
          }

          overlay.remove();
          marker.remove();
          showToast('Issue submitted! Click Capture in the banner to report another.', 'success');
        } catch (err) {
          unlock(); // re-enable so the user can try again
          showToast('Failed to submit: ' + err.message, 'error');
        }
      });
    };

    modal.appendChild(header);
    header.appendChild(headerTitle);
    header.appendChild(headerButton);
    headerButton.appendChild(headerButtonContent);

    modal.appendChild(imageWrapper);
    imageWrapper.appendChild(imageInner);
    imageInner.appendChild(img);
    imageWrapper.appendChild(markerText);

    modal.appendChild(envBar);

    modal.appendChild(form);
    form.appendChild(issueWrapper);
    issueWrapper.appendChild(issueLabel);
    issueWrapper.appendChild(issueInput);

    form.appendChild(descriptionWrapper);
    descriptionWrapper.appendChild(descriptionLabel);
    descriptionWrapper.appendChild(descriptionInput);

    form.appendChild(fieldGrid);
    fieldGrid.appendChild(priorityWrapper);
    fieldGrid.appendChild(typeWrapper);

    typeWrapper.style.position = 'relative';
    typeWrapper.appendChild(typeLabel);
    typeWrapper.appendChild(typeSelect);
    typeWrapper.appendChild(typeBtn);
    typeWrapper.appendChild(typeDropdown);

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(submitBtn);
    modal.appendChild(btnRow);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }

  function getCSSPath(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE) return '';
    const parts = [];
    while (el && el.nodeType === Node.ELEMENT_NODE && el !== document.documentElement) {
      let selector = el.nodeName.toLowerCase();
      if (el.id) {
        selector += '#' + el.id;
        parts.unshift(selector);
        break; // ID is unique — stop here
      }
      // Append up to 2 stable class names (skip state/utility classes)
      const classes = Array.from(el.classList)
        .filter((c) => !/^(is-|has-|js-|active|disabled|focus|hover)/.test(c))
        .slice(0, 2);
      if (classes.length) selector += '.' + classes.join('.');
      // Disambiguate siblings of the same type
      const parent = el.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (s) => s.nodeName === el.nodeName,
        );
        if (siblings.length > 1) {
          selector += `:nth-of-type(${siblings.indexOf(el) + 1})`;
        }
      }
      parts.unshift(selector);
      el = el.parentElement;
    }
    return parts.join(' > ') || el?.nodeName?.toLowerCase() || '';
  }

  function getBrowser() {
    const ua = navigator.userAgent;
    if (ua.includes('Edg/'))               return 'Edge';
    if (ua.includes('OPR/') || ua.includes('Opera')) return 'Opera';
    if (ua.includes('Chrome/'))            return 'Chrome';
    if (ua.includes('Firefox/'))           return 'Firefox';
    if (ua.includes('Safari/'))            return 'Safari';
    return 'Unknown';
  }

  function getBrowserFull() {
    const ua = navigator.userAgent;
    let name = 'Unknown', version = '';
    if (ua.includes('Edg/')) {
      name = 'Edge';
      version = (ua.match(/Edg\/([\d.]+)/) || [])[1] || '';
    } else if (ua.includes('OPR/')) {
      name = 'Opera';
      version = (ua.match(/OPR\/([\d.]+)/) || [])[1] || '';
    } else if (ua.includes('Chrome/')) {
      name = 'Chrome';
      version = (ua.match(/Chrome\/([\d.]+)/) || [])[1] || '';
    } else if (ua.includes('Firefox/')) {
      name = 'Firefox';
      version = (ua.match(/Firefox\/([\d.]+)/) || [])[1] || '';
    } else if (ua.includes('Safari/') && ua.includes('Version/')) {
      name = 'Safari';
      version = (ua.match(/Version\/([\d.]+)/) || [])[1] || '';
    }
    return version ? `${name} ${version}` : name;
  }

  function getOS() {
    const ua = navigator.userAgent;
    if (ua.includes('Windows NT')) return 'Windows';
    if (ua.includes('Mac OS X'))   return 'macOS';
    if (ua.includes('Android'))    return 'Android';
    if (ua.includes('iPhone') || ua.includes('iPad')) return 'iOS';
    if (ua.includes('Linux'))      return 'Linux';
    return 'Unknown';
  }

  function getOSFull() {
    const ua = navigator.userAgent;
    if (ua.includes('Windows NT')) {
      const v = (ua.match(/Windows NT ([\d.]+)/) || [])[1] || '';
      const map = { '10.0': '10/11', '6.3': '8.1', '6.2': '8', '6.1': '7' };
      return `Windows ${map[v] || v}`;
    }
    if (ua.includes('Mac OS X')) {
      const raw = (ua.match(/Mac OS X ([\d_]+)/) || [])[1] || '';
      const ver = raw.replace(/_/g, '.');
      return `macOS ${ver}`;
    }
    if (ua.includes('Android')) {
      const v = (ua.match(/Android ([\d.]+)/) || [])[1] || '';
      return `Android ${v}`;
    }
    if (ua.includes('iPhone') || ua.includes('iPad')) {
      const v = (ua.match(/OS ([\d_]+)/) || [])[1] || '';
      return `iOS ${v.replace(/_/g, '.')}`;
    }
    if (ua.includes('Linux')) return 'Linux';
    return 'Unknown';
  }

  function cleanupQA() {
    if (qaEnabled) {
      disableQAOverlay();
      removeBanner();
      qaEnabled = false;
    }
  }

  window.addEventListener('qa-mode-toggle', () => {
    if (qaEnabled) {
      cleanupQA();
    } else {
      qaEnabled = true;
      showBanner();
    }
  });

  window.addEventListener('qa-tab-activated', () => {
    cleanupQA();
  });

  window.addEventListener('qa-tab-unloaded', () => {
    cleanupQA();
  });

  window.addEventListener('beforeunload', () => {
    cleanupQA();
  });
})();
