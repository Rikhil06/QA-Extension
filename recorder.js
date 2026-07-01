// Cross-browser shim
const ext = typeof browser !== 'undefined' ? browser : chrome;

// Runs in the offscreen document. Maintains a rolling 10-second recording window by
// restarting MediaRecorder every WINDOW_SECONDS on the same stream. This guarantees
// that initChunk and content chunks always form a contiguous, gap-free WebM file.

const WINDOW_SECONDS = 10;
const TIMESLICE_MS = 1000;

let stream = null;
let mediaRecorder = null;
let initChunk = null; // first chunk of current window — contains WebM EBML + Tracks header
let chunks = [];      // subsequent chunks of current window (each ~1s of video)
let restartTimer = null;
let isExtracting = false;

ext.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== 'offscreen') return;

  if (msg.type === 'OFFSCREEN_START') {
    startRecording(msg.streamId)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ error: e.message }));
    return true;
  }

  if (msg.type === 'OFFSCREEN_STOP') {
    stopRecording();
    sendResponse({ ok: true });
    return false;
  }

  if (msg.type === 'OFFSCREEN_EXTRACT') {
    extractRecording()
      .then((data) => sendResponse(data))
      .catch((e) => sendResponse({ error: e.message }));
    return true;
  }
});

async function startRecording(streamId) {
  stopRecording();

  stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId,
        maxWidth: 1280,
        maxHeight: 800,
        maxFrameRate: 15,
      },
    },
  });

  startWindow();
}

function startWindow() {
  if (!stream || !stream.active) return;

  // Clear the previous window's data (skip if extraction is in progress)
  if (!isExtracting) {
    initChunk = null;
    chunks = [];
  }

  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : 'video/webm';

  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 800_000,
  });
  mediaRecorder = recorder;

  recorder.ondataavailable = (e) => {
    // Ignore events from a stale recorder (race with restart)
    if (recorder !== mediaRecorder) return;
    if (e.data?.size > 0) {
      if (!initChunk) {
        initChunk = e.data;
      } else {
        chunks.push(e.data);
      }
    }
  };

  recorder.start(TIMESLICE_MS);

  // Schedule the next window restart
  restartTimer = setTimeout(() => {
    if (recorder === mediaRecorder && recorder.state !== 'inactive') {
      recorder.stop(); // fires final dataavailable then onstop — we don't need onstop
    }
    startWindow();
  }, WINDOW_SECONDS * 1000);
}

function stopRecording() {
  if (restartTimer) {
    clearTimeout(restartTimer);
    restartTimer = null;
  }
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  mediaRecorder = null;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  initChunk = null;
  chunks = [];
  isExtracting = false;
}

function extractRecording() {
  return new Promise((resolve) => {
    if (!initChunk && !chunks.length) {
      resolve({ base64: null });
      return;
    }

    isExtracting = true;

    let settled = false;
    const flush = () => {
      if (settled) return;
      settled = true;
      isExtracting = false;

      // initChunk always goes first — it holds the WebM EBML header and Tracks info.
      // All content chunks in this window are timestamp-contiguous with it.
      const allChunks = initChunk ? [initChunk, ...chunks] : [...chunks];
      const blob = new Blob(allChunks, { type: 'video/webm' });

      blob.arrayBuffer().then((buffer) => {
        // ArrayBuffers corrupt across the two-hop offscreen→background→content relay;
        // base64 string survives intact.
        const bytes = new Uint8Array(buffer);
        let binary = '';
        const CHUNK = 8192;
        for (let i = 0; i < bytes.length; i += CHUNK) {
          binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
        }
        resolve({ base64: btoa(binary) });
      });
    };

    if (mediaRecorder?.state === 'recording') {
      mediaRecorder.addEventListener('dataavailable', flush, { once: true });
      mediaRecorder.requestData();
      setTimeout(flush, 500); // safety fallback
    } else {
      flush();
    }
  });
}
