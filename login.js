document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;

  try {
    const res = await fetch('http://localhost:4000/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await res.json();

    if (!res.ok) {
      document.getElementById('error').textContent =
        data.error || 'Login failed';
      return;
    }

    // Save token to local storage or chrome.storage
    chrome.storage.local.set({ token: data.token, user: data.user }, () => {
      console.log('User logged in');
      // Redirect to main extension UI
    });

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs[0].id;

      // then inject your content script
      chrome.scripting.executeScript({
        target: { tabId },
        files: ['content.js'],
      });
    });
  } catch (err) {
    console.error('Login error:', err);
    document.getElementById('error').textContent = 'An error occurred';
  }
});
