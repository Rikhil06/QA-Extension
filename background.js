// Cross-browser shim — use `browser` in Firefox, fall back to `chrome` in Chrome.
const ext = typeof browser !== 'undefined' ? browser : chrome;

// chrome.storage.session.setAccessLevel is Chrome-only. In Firefox, session storage
// is accessible to content scripts by default so no call is needed.
if (ext.storage.session.setAccessLevel) {
  ext.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });
}

// Screen recording requires tabCapture + offscreen — both Chrome-only for now.
const canRecord = !!ext.tabCapture?.getMediaStreamId;

// On startup, check if the stored JWT is still valid and clear it if expired
ext.runtime.onStartup.addListener(checkTokenExpiry);
ext.runtime.onInstalled.addListener(checkTokenExpiry);

function checkTokenExpiry() {
  ext.storage.session.get(['token'], ({ token }) => {
    if (!token) return;
    try {
      const parts = token.split('.');
      if (parts.length !== 3) { ext.storage.session.remove(['token']); ext.storage.session.remove(['user']); return; }
      const payload = JSON.parse(atob(parts[1]));
      const isExpired = payload.exp && Date.now() >= payload.exp * 1000;
      if (isExpired) {
        ext.storage.session.remove(['token']);
        ext.storage.session.remove(['user']);
      }
    } catch (e) {
      // Malformed token — clear it
      ext.storage.session.remove(['token']);
      ext.storage.session.remove(['user']);
    }
  });
}

ext.action.onClicked.addListener((tab) => {
  ext.scripting.executeScript({
    target: { tabId: tab.id },
    function: () => {
      window.dispatchEvent(new CustomEvent('qa-mode-toggle'));
    },
  });
});

// ── Screen recording (Chrome only) ───────────────────────────────────────────

const OFFSCREEN_URL = ext.runtime.getURL('offscreen.html');

async function ensureOffscreenDocument() {
  // runtime.getContexts is Chrome-only; offscreen docs don't exist in Firefox
  const existing = await ext.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [OFFSCREEN_URL],
  });
  if (existing.length > 0) return;
  await ext.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['USER_MEDIA'],
    justification: 'Rolling tab-capture buffer for QA bug reports',
  });
}

function sendToOffscreen(msg) {
  return new Promise((resolve) => {
    ext.runtime.sendMessage({ ...msg, target: 'offscreen' }, (response) => {
      resolve(response ?? { error: 'No response from offscreen document' });
    });
  });
}

// ── Message handler ───────────────────────────────────────────────────────────

ext.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (sender.id !== ext.runtime.id) return;

  if (message.type === 'CAPTURE_SCREENSHOT') {
    ext.tabs.captureVisibleTab(sender.tab.windowId, { format: 'png' }, (dataUrl) => {
      if (ext.runtime.lastError) {
        sendResponse({ error: ext.runtime.lastError.message });
      } else {
        sendResponse({ dataUrl });
      }
    });
    return true;
  }

  if (message.type === 'START_RECORDING') {
    if (!canRecord) {
      sendResponse({ error: 'Screen recording is not supported in this browser' });
      return false;
    }
    const tabId = sender.tab?.id;
    if (!tabId) { sendResponse({ error: 'No tab id' }); return false; }

    ext.tabCapture.getMediaStreamId({ targetTabId: tabId }, async (streamId) => {
      if (ext.runtime.lastError || !streamId) {
        // Non-fatal — recording is a paid feature enhancement, not core functionality
        sendResponse({ error: ext.runtime.lastError?.message ?? 'tabCapture unavailable' });
        return;
      }
      try {
        await ensureOffscreenDocument();
        const result = await sendToOffscreen({ type: 'OFFSCREEN_START', streamId });
        sendResponse(result);
      } catch (e) {
        sendResponse({ error: e.message });
      }
    });
    return true;
  }

  if (message.type === 'STOP_RECORDING') {
    if (!canRecord) { sendResponse({ error: 'Not supported' }); return false; }
    sendToOffscreen({ type: 'OFFSCREEN_STOP' }).then(sendResponse);
    return true;
  }

  if (message.type === 'EXTRACT_RECORDING') {
    if (!canRecord) { sendResponse(null); return false; }
    sendToOffscreen({ type: 'OFFSCREEN_EXTRACT' }).then(sendResponse);
    return true;
  }
});

ext.tabs.onActivated.addListener(({ tabId }) => {
  ext.scripting.executeScript({
    target: { tabId },
    func: () => {
      window.dispatchEvent(new CustomEvent('qa-tab-activated'));
    },
  });
});

ext.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading') {
    ext.scripting.executeScript({
      target: { tabId },
      func: () => {
        window.dispatchEvent(new CustomEvent('qa-tab-unloaded'));
      },
    });
  }
});
