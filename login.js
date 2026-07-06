// Cross-browser shim
const ext = typeof browser !== 'undefined' ? browser : chrome;

// ─── URLs ─────────────────────────────────────────────────────────────────────
// Change these constants when you deploy to a new environment.
const BACKEND_URL   = 'https://api.annoture.com';
const DASHBOARD_URL = 'https://app.annoture.com'; // app
const REGISTER_URL  = 'https://app.annoture.com/register';
// ─────────────────────────────────────────────────────────────────────────────

// If already logged in, skip the form and activate QA mode immediately
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
      return;
    }
    // Valid token — inject content script and close popup
    // (console-capture.js is injected automatically via manifest content_scripts at
    // document_start, so it's already running by the time this fires)
    ext.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      ext.scripting.executeScript(
        { target: { tabId: tabs[0].id }, files: ['content.js'] },
        () => window.close()
      );
    });
  } catch (e) {
    ext.storage.session.remove(['token']);
    ext.storage.session.remove(['user']);
  }
});

document.querySelector('.register button').addEventListener('click', () => {
  ext.tabs.create({ url: REGISTER_URL });
});

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const btn = document.querySelector('.submit-btn');
  btn.classList.add('loading');
  btn.disabled = true;
  document.getElementById('error').textContent = '';

  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;

  try {
    const res = await fetch(
      `${BACKEND_URL}/api/auth/login`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      }
    );

    const text = await res.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { /* non-JSON body — keep empty */ }

    if (!res.ok) {
      document.getElementById('error').textContent = data.error || 'Login failed';
      btn.classList.remove('loading');
      btn.disabled = false;
      return;
    }

    // Save token then inject content script, then close popup
    const safeUser = { id: data.user.id, email: data.user.email, name: data.user.name, teams: data.user.teams };
    await new Promise((resolve) => ext.storage.session.set({ token: data.token }, resolve));
    await new Promise((resolve) => ext.storage.session.set({ user: safeUser }, resolve));

    const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      await ext.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    }
    window.close();
  } catch (err) {
    document.getElementById('error').textContent = 'An error occurred';
    btn.classList.remove('loading');
    btn.disabled = false;
  }
});
