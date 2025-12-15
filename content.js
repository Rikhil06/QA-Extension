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
      backgroundColor: '#1e1e1e', // bg-[#1e1e1e]
      borderRadius: '0.75rem', // rounded-xl
      boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)', // shadow-2xl
      border: '1px solid rgba(255, 255, 255, 0.05)', // border border-white/5
      width: '100%', // w-full
      maxWidth: '42rem', // max-w-2xl
      maxHeight: '90vh', // max-h-[90vh]
      overflow: 'auto',
      // padding: '16px',
    });

    const img = document.createElement('img');
    img.src = image;
    img.style.width = '100%';
    img.style.borderRadius = '4px';
    img.alt = 'Screenshot';

    const header = document.createElement('div');
    Object.assign(header.style, {
      display: 'flex', // flex
      alignItems: 'center', // items-center
      justifyContent: 'space-between', // justify-between
      padding: '24px', // p-6 (6 * 0.25rem = 1.5rem)
      borderBottom: '1px solid rgba(255, 255, 255, 0.05)', // border-b border-white/5
    });

    const headerTitle = document.createElement('h2');
    headerTitle.textContent = 'Report Issue';
    Object.assign(headerTitle.style, {
      color: '#fff',
      fontSize: '20px',
      fontWeight: '500',
    });

    const headerButton = document.createElement('button');
    Object.assign(headerButton.style, {
      color: '#ffffff99',
    });

    const headerButtonContent = document.createElement('span');
    headerButtonContent.textContent = 'X';

    const imageWrapper = document.createElement('div');
    Object.assign(imageWrapper.style, {
      padding: '24px', // p-6 (6 * 0.25rem = 1.5rem)
      borderBottom: '1px solid rgba(255, 255, 255, 0.05)', // border-b border-white/5
    });

    const imageInner = document.createElement('div');
    Object.assign(imageInner.style, {
      backgroundColor: '#121212', // bg-[#121212]
      borderRadius: '0.5rem', // rounded-lg
      overflow: 'hidden', // overflow-hidden
      border: '1px solid rgba(255, 255, 255, 0.05)', // border border-white/5
    });

    const markerText = document.createElement('p');
    markerText.textContent = 'Click location marked on screenshot';
    Object.assign(markerText.style, {
      marginTop: '16px', // bg-[#121212]
      color: '#ffffff66',
      fontSize: '16px',
    });

    const form = document.createElement('div');
    Object.assign(form.style, {
      padding: '24px',
    });

    const issueWrapper = document.createElement('div');
    Object.assign(issueWrapper.style, {
      marginBottom: '24px',
    });
    const issueLabel = document.createElement('label');
    issueLabel.textContent = 'Name of Issue';
    Object.assign(issueLabel.style, {
      display: 'block',
      color: '#ffffff99',
      marginBottom: '8px',
    });
    const issueInput = document.createElement('input');
    issueInput.placeholder = 'Brief title for the issue';
    issueInput.required = true;
    issueInput.type = 'text';
    Object.assign(issueInput.style, {
      width: '100%', // w-full
      backgroundColor: '#121212', // bg-[#121212]
      color: '#ffffff', // text-white
      paddingLeft: '1rem', // px-4
      paddingRight: '1rem', // px-4
      paddingTop: '0.625rem', // py-2.5
      paddingBottom: '0.625rem', // py-2.5
      borderRadius: '0.5rem', // rounded-lg
      border: '1px solid rgba(255, 255, 255, 0.05)', // border border-white/5
      transition: 'border-color 0.3s, color 0.3s', // transition-colors
      outline: 'none',
    });
    issueInput.addEventListener('focus', () => {
      issueInput.style.borderColor = '#4f9eff';
    });

    issueInput.addEventListener('blur', () => {
      issueInput.style.borderColor = 'rgba(255, 255, 255, 0.05)';
    });

    const descriptionWrapper = document.createElement('div');
    const descriptionLabel = document.createElement('label');
    descriptionLabel.textContent = 'Description';
    Object.assign(descriptionLabel.style, {
      display: 'block',
      color: '#ffffff99',
      marginBottom: '8px',
    });
    const descriptionInput = document.createElement('textarea');
    descriptionInput.required = true;
    descriptionInput.placeholder = 'Describe the issue in detail...';
    descriptionInput.rows = 4;
    Object.assign(descriptionInput.style, {
      width: '100%', // w-full
      backgroundColor: '#121212', // bg-[#121212]
      color: '#ffffff', // text-white
      paddingLeft: '1rem', // px-4
      paddingRight: '1rem', // px-4
      paddingTop: '0.625rem', // py-2.5
      paddingBottom: '0.625rem', // py-2.5
      borderRadius: '0.5rem', // rounded-lg
      border: '1px solid rgba(255, 255, 255, 0.05)', // border border-white/5
      transition: 'border-color 0.3s, color 0.3s', // transition-colors
      outline: 'none',
    });
    descriptionInput.addEventListener('focus', () => {
      issueInput.style.borderColor = '#4f9eff';
    });

    descriptionInput.addEventListener('blur', () => {
      issueInput.style.borderColor = 'rgba(255, 255, 255, 0.05)';
    });

    // Grid wrapper (grid grid-cols-2 gap-4)
    const fieldGrid = document.createElement('div');
    Object.assign(fieldGrid.style, {
      display: 'grid',
      gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
      gap: '1rem',
      paddingBottom: '24px',
      paddingLeft: '24px',
      paddingRight: '24px',
    });

    // ---------- Priority field ----------
    const priorityWrapper = document.createElement('div');

    const priorityLabel = document.createElement('label');
    priorityLabel.textContent = 'Priority';
    Object.assign(priorityLabel.style, {
      display: 'block',
      color: 'rgba(255,255,255,0.6)',
      marginBottom: '0.5rem',
    });

    const prioritySelect = document.createElement('select');
    prioritySelect.required = true;
    Object.assign(prioritySelect.style, {
      width: '100%',
      backgroundColor: '#121212',
      color: '#ffffff',
      padding: '0.625rem 1rem', // py-2.5 px-4
      borderRadius: '0.5rem',
      border: '1px solid rgba(255,255,255,0.05)',
      outline: 'none',
      cursor: 'pointer',
      transition: 'border-color 0.2s ease',
    });

    prioritySelect.addEventListener('focus', () => {
      prioritySelect.style.borderColor = '#4f9eff';
    });
    prioritySelect.addEventListener('blur', () => {
      prioritySelect.style.borderColor = 'rgba(255,255,255,0.05)';
    });

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
    Object.assign(typeLabel.style, {
      display: 'block',
      color: 'rgba(255,255,255,0.6)',
      marginBottom: '0.5rem',
    });

    const typeSelect = document.createElement('select');
    Object.assign(typeSelect.style, {
      width: '100%',
      backgroundColor: '#121212',
      color: '#ffffff',
      padding: '0.625rem 1rem',
      borderRadius: '0.5rem',
      border: '1px solid rgba(255,255,255,0.05)',
      outline: 'none',
      cursor: 'pointer',
      transition: 'border-color 0.2s ease',
    });

    typeSelect.addEventListener('focus', () => {
      typeSelect.style.borderColor = '#4f9eff';
    });
    typeSelect.addEventListener('blur', () => {
      typeSelect.style.borderColor = 'rgba(255,255,255,0.05)';
    });

    ['Bug', 'Suggestion', 'Task'].forEach((value) => {
      const option = document.createElement('option');
      option.value = value.toLowerCase();
      option.textContent = value;
      typeSelect.appendChild(option);
    });

    const btnRow = document.createElement('div');
    btnRow.style.marginTop = '10px';
    btnRow.style.display = 'flex';
    btnRow.style.justifyContent = 'flex-end';
    btnRow.style.gap = '10px';
    btnRow.style.paddingLeft = '24px';
    btnRow.style.paddingRight = '24px';
    btnRow.style.paddingBottom = '24px';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    Object.assign(cancelBtn.style, {
      flex: '1', // flex-1
      backgroundColor: 'rgba(255, 255, 255, 0.05)', // bg-white/5
      color: '#ffffff', // text-white
      paddingTop: '0.625rem', // py-2.5
      paddingBottom: '0.625rem', // py-2.5
      borderRadius: '0.5rem', // rounded-lg
      transition: 'background-color 0.3s', // transition-colors
      border: 'none',
      cursor: 'pointer',
    });
    // hover:bg-white/10
    cancelBtn.addEventListener('mouseenter', () => {
      cancelBtn.style.backgroundColor = 'rgba(255, 255, 255, 0.10)';
    });

    cancelBtn.addEventListener('mouseleave', () => {
      cancelBtn.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
    });
    cancelBtn.onclick = () => {
      overlay.remove();
      marker.remove();
    };

    const submitBtn = document.createElement('button');
    submitBtn.textContent = 'Submit Issue';
    Object.assign(submitBtn.style, {
      flex: '1', // flex-1
      backgroundColor: '#4f9eff', // bg-[#4f9eff]
      color: '#ffffff', // text-white
      paddingTop: '0.625rem', // py-2.5
      paddingBottom: '0.625rem', // py-2.5
      borderRadius: '0.5rem', // rounded-lg
      transition: 'background-color 0.3s', // transition-colors
      border: 'none',
      cursor: 'pointer',
    });

    // hover:bg-[#3d8ae6]
    submitBtn.addEventListener('mouseenter', () => {
      submitBtn.style.backgroundColor = '#3d8ae6';
    });

    submitBtn.addEventListener('mouseleave', () => {
      submitBtn.style.backgroundColor = '#4f9eff';
    });

    submitBtn.onclick = async () => {
      const title = issueInput.value.trim();
      const comment = descriptionInput.value.trim();
      const priority = prioritySelect.value;
      const type = typeSelect.value;

      if (!title) return alert('Please enter a title for the issue.');
      if (!comment) return alert('Please enter a comment.');
      if (!priority) return alert('Please select a priority.');

      const screenshotBlob = dataURLtoBlob(image);

      chrome.storage.local.get(['token'], async (result) => {
        const token = result.token;
        if (!token) {
          alert('You must be logged in to submit a report.');
          return;
        }

        const formData = new FormData();
        formData.append('screenshot', screenshotBlob, 'screenshot.png');
        formData.append('title', title);
        formData.append('comment', comment);
        formData.append('priority', priority);
        formData.append('type', type);
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

    modal.appendChild(header);
    header.appendChild(headerTitle);
    header.appendChild(headerButton);
    headerButton.appendChild(headerButtonContent);

    modal.appendChild(imageWrapper);
    imageWrapper.appendChild(imageInner);
    imageInner.appendChild(img);
    imageWrapper.appendChild(markerText);

    modal.appendChild(form);
    form.appendChild(issueWrapper);
    issueWrapper.appendChild(issueLabel);
    issueWrapper.appendChild(issueInput);

    form.appendChild(descriptionWrapper);
    descriptionWrapper.appendChild(descriptionLabel);
    descriptionWrapper.appendChild(descriptionInput);

    modal.append(fieldGrid);
    fieldGrid.appendChild(priorityWrapper);
    fieldGrid.appendChild(typeWrapper);

    typeWrapper.appendChild(typeLabel);
    typeWrapper.appendChild(typeSelect);

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(submitBtn);
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
