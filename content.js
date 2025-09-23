(() => {
  const FLAG = '__QA_SCRIPT_LOADED__';

  if (window[FLAG]) {
    console.log('⚠️ QA script already loaded');
    return;
  }
  window[FLAG] = true;

  // ✅ your whole script goes here, inside this block

  let qaOverlay = null;
  let qaBanner = null;
  let qaEnabled = true;

  enableQAOverlay();
  showBanner();

  function showBanner() {
    qaBanner = document.createElement('div');
    qaBanner.textContent =
      '🛠️ QA Mode Enabled — Click anywhere to report an issue. Click the extension icon again to exit.';
    Object.assign(qaBanner.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100%',
      padding: '12px',
      background: '#000',
      color: '#fff',
      fontSize: '14px',
      fontFamily: 'Arial, sans-serif',
      zIndex: '1000001',
      textAlign: 'center',
      boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
    });
    document.body.appendChild(qaBanner);
  }

  function removeBanner() {
    if (qaBanner) qaBanner.remove();
  }

  function enableQAOverlay() {
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
  }

  function disableQAOverlay() {
    if (qaOverlay) qaOverlay.remove();
    qaOverlay = null;
  }

  async function handleClick(e) {
    e.preventDefault();
    e.stopPropagation();

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

    chrome.runtime.sendMessage({ type: 'CAPTURE_SCREENSHOT' }, (response) => {
      if (response?.dataUrl) {
        showScreenshotModal(response.dataUrl, e.pageX, e.pageY, marker);
      } else {
        alert(
          'Failed to capture screenshot: ' +
            (response?.error || 'Unknown error')
        );
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

  function showScreenshotModal(image, x, y, marker) {
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
      background: '#fff',
      borderRadius: '8px',
      padding: '16px',
      width: '400px',
      maxWidth: '90vw',
      boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
      fontFamily: 'Arial, sans-serif',
    });

    const img = document.createElement('img');
    img.src = image;
    img.style.width = '100%';
    img.style.borderRadius = '4px';
    img.alt = 'Screenshot';

    const textarea = document.createElement('textarea');
    textarea.placeholder = 'Describe the issue...';
    textarea.style.width = '100%';
    textarea.style.marginTop = '10px';
    textarea.style.minHeight = '80px';
    textarea.style.padding = '8px';
    textarea.style.fontSize = '14px';
    textarea.style.resize = 'vertical';

    const btnRow = document.createElement('div');
    btnRow.style.marginTop = '10px';
    btnRow.style.display = 'flex';
    btnRow.style.justifyContent = 'flex-end';
    btnRow.style.gap = '10px';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.padding = '6px 12px';
    cancelBtn.onclick = () => {
      overlay.remove();
      marker.remove();
    };

    const submitBtn = document.createElement('button');
    submitBtn.textContent = 'Submit';
    submitBtn.style.padding = '6px 12px';
    submitBtn.style.background = '#007bff';
    submitBtn.style.color = '#fff';
    submitBtn.style.border = 'none';
    submitBtn.style.cursor = 'pointer';

    submitBtn.onclick = async () => {
      const comment = textarea.value.trim();
      if (!comment) return alert('Please enter a comment.');

      const screenshotBlob = dataURLtoBlob(image);

      chrome.storage.local.get(['token'], async (result) => {
        const token = result.token;
        if (!token) {
          alert('You must be logged in to submit a report.');
          return;
        }

        const formData = new FormData();
        formData.append('screenshot', screenshotBlob, 'screenshot.png');
        formData.append('comment', comment);
        formData.append('url', window.location.href);
        formData.append('x', x.toString());
        formData.append('y', y.toString());

        try {
          const res = await fetch('http://localhost:4000/api/report', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${token}`,
            },
            body: formData,
          });

          if (!res.ok) throw new Error(`Server error: ${res.statusText}`);

          alert('Issue submitted!');
          overlay.remove();
          marker.remove();
          disableQAOverlay();
          removeBanner();
          qaEnabled = false;
        } catch (err) {
          alert('Failed to submit issue: ' + err.message);
        }
      });
    };

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(submitBtn);
    modal.appendChild(img);
    modal.appendChild(textarea);
    modal.appendChild(btnRow);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
  }

  function cleanupQA() {
    if (qaEnabled) {
      disableQAOverlay();
      removeBanner();
      qaEnabled = false;
      console.log('🧹 QA UI cleaned up due to tab switch or reload');
    }
  }

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
