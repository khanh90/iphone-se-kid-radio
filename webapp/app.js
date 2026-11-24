/* ==========================================================================
   iPhone SE Kid's Radio — Hybrid Offline (IndexedDB + Audio) & YouTube Engine
   ========================================================================== */

const STORAGE_KEY = "kid_radio_iphone_se_v1";
const IDB_NAME = "kid_radio_audio_db";
const IDB_STORE = "tracks";

const DEFAULT_DATA = {
  pin: "1234",
  displayMode: "radio", // "radio" | "mini-video"
  clickSfx: true,
  calGrid: false,
  offsetX: 0,
  offsetY: 0,
  channelIndex: 0,
  trackIndex: 0,
  channels: [
    {
      id: "en-kids",
      icon: "🇬🇧",
      freq: "FM 88.5",
      name: "TIẾNG ANH BÉ YÊU",
      tracks: [
        { type: "youtube", id: "hq3yfQnllfQ", title: "Phonics Song with TWO Words" },
        { type: "youtube", id: "e_04ZrNroTo", title: "Wheels on the Bus — CoComelon" },
        { type: "youtube", id: "yCjJyiqpAuU", title: "Twinkle Twinkle Little Star" },
      ],
    },
    {
      id: "stories",
      icon: "📖",
      freq: "FM 92.0",
      name: "KỂ CHUYỆN & NGỦ NGON",
      tracks: [
        { type: "youtube", id: "1ZYbU82GVz4", title: "Nhạc Ru Ngủ Êm Dịu Cho Bé" },
        { type: "youtube", id: "lFcSrYw-ARY", title: "Âm Thanh Thiên Nhiên Thư Giãn" },
      ],
    },
    {
      id: "music",
      icon: "🎵",
      freq: "FM 98.4",
      name: "NHẠC THIẾU NHI VUI",
      tracks: [
        { type: "youtube", id: "XqZsoesa55w", title: "Baby Shark Dance" },
        { type: "youtube", id: "75p-N9YKqNo", title: "ABC Song — Bảng Chữ Cái" },
        { type: "youtube", id: "DR-cfDsHCGA", title: "Count to 10 — Tập Đếm Số" },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// IndexedDB Offline Audio Store (100% Airplane Mode / No Wi-Fi)
// ---------------------------------------------------------------------------
function openAudioDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveOfflineAudio(id, blob, size) {
  const db = await openAudioDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put({ id, blob, size, createdAt: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getOfflineAudio(id) {
  const db = await openAudioDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const req = tx.objectStore(IDB_STORE).get(id);
    req.onsuccess = () => resolve(req.result ? req.result.blob : null);
    req.onerror = () => reject(req.error);
  });
}

async function deleteOfflineAudio(id) {
  try {
    const db = await openAudioDB();
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Ignore DB cleanup errors
  }
}

async function getOfflineStats() {
  try {
    const db = await openAudioDB();
    return new Promise((resolve) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).getAll();
      req.onsuccess = () => {
        const items = req.result || [];
        const bytes = items.reduce((acc, it) => acc + (it.size || (it.blob ? it.blob.size : 0)), 0);
        resolve({ count: items.length, mb: (bytes / (1024 * 1024)).toFixed(1) });
      };
      req.onerror = () => resolve({ count: 0, mb: "0.0" });
    });
  } catch {
    return { count: 0, mb: "0.0" };
  }
}

// ---------------------------------------------------------------------------
// State & Persistence
// ---------------------------------------------------------------------------
function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_DATA);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.channels) || parsed.channels.length === 0) {
      return structuredClone(DEFAULT_DATA);
    }
    return { ...structuredClone(DEFAULT_DATA), ...parsed };
  } catch {
    return structuredClone(DEFAULT_DATA);
  }
}

let state = loadState();
let ytPlayer = null;
let ytReady = false;
let isPlaying = false;
let activeEngine = "none"; // "offline" | "youtube" | "none"
let currentBlobUrl = null;
let loadedOfflineTrackId = null;
let progressTimer = null;
let sleepEndTime = null;
let sleepTimerInterval = null;
let consecutiveErrors = 0;

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage quota errors
  }
}

function currentChannel() {
  if (state.channelIndex >= state.channels.length) state.channelIndex = 0;
  return state.channels[state.channelIndex];
}

function currentTrack() {
  const ch = currentChannel();
  if (!ch || !ch.tracks.length) return null;
  if (state.trackIndex >= ch.tracks.length) state.trackIndex = 0;
  return ch.tracks[state.trackIndex];
}

function trackType(track) {
  return track && track.type === "offline" ? "offline" : "youtube";
}

// ---------------------------------------------------------------------------
// DOM References
// ---------------------------------------------------------------------------
const el = {
  offlineAudio: document.getElementById("offline-audio"),
  channelIcon: document.getElementById("channel-icon"),
  channelFreq: document.getElementById("channel-freq"),
  channelName: document.getElementById("channel-name"),
  sourceBadge: document.getElementById("source-badge"),
  trackCounter: document.getElementById("track-counter"),
  trackTitle: document.getElementById("track-title"),
  trackSubtitle: document.getElementById("track-subtitle"),
  stateDot: document.getElementById("state-dot"),
  eqBars: document.getElementById("eq-bars"),
  timeCurrent: document.getElementById("time-current"),
  timeTotal: document.getElementById("time-total"),
  progressFill: document.getElementById("progress-fill"),
  sleepBadge: document.getElementById("sleep-badge"),
  calOverlay: document.getElementById("calibration-overlay"),
  miniVideoShield: document.getElementById("mini-video-shield"),

  btnPrev: document.getElementById("btn-prev"),
  btnPlay: document.getElementById("btn-play"),
  btnNext: document.getElementById("btn-next"),
  btnChannel: document.getElementById("btn-channel"),
  iconPlay: document.getElementById("icon-play"),
  iconPause: document.getElementById("icon-pause"),
  playLabel: document.getElementById("play-label"),
  desktopParentBtn: document.getElementById("desktop-parent-btn"),

  pinDialog: document.getElementById("pin-dialog"),
  pinDots: document.getElementById("pin-dots"),
  pinError: document.getElementById("pin-error"),

  parentDialog: document.getElementById("parent-dialog"),
  adminChannelSelect: document.getElementById("admin-channel-select"),
  btnAddChannel: document.getElementById("btn-add-channel"),
  inputOfflineFiles: document.getElementById("input-offline-files"),
  offlineStorageInfo: document.getElementById("offline-storage-info"),
  offlineImportStatus: document.getElementById("offline-import-status"),
  addVideoForm: document.getElementById("add-video-form"),
  inputYtUrl: document.getElementById("input-yt-url"),
  inputYtTitle: document.getElementById("input-yt-title"),
  adminTrackList: document.getElementById("admin-track-list"),

  selectDisplayMode: document.getElementById("select-display-mode"),
  selectSleepTimer: document.getElementById("select-sleep-timer"),
  toggleClickSfx: document.getElementById("toggle-click-sfx"),
  toggleCalGrid: document.getElementById("toggle-cal-grid"),
  rangeOffsetX: document.getElementById("range-offset-x"),
  rangeOffsetY: document.getElementById("range-offset-y"),
  valOffsetX: document.getElementById("val-offset-x"),
  valOffsetY: document.getElementById("val-offset-y"),
  inputNewPin: document.getElementById("input-new-pin"),
  btnSavePin: document.getElementById("btn-save-pin"),
  btnResetDefaults: document.getElementById("btn-reset-defaults"),
};

// ---------------------------------------------------------------------------
// Synthesized Tactile Radio Click / Chime (Web Audio API — 100% Offline)
// ---------------------------------------------------------------------------
let audioCtx = null;
function playClickSfx(freq = 540, duration = 0.045) {
  if (!state.clickSfx) return;
  try {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audioCtx = new Ctx();
    }
    if (audioCtx.state === "suspended") audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.09, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch {
    // Ignore audio context restrictions
  }
}

// ---------------------------------------------------------------------------
// Native Offline <audio> Engine Events
// ---------------------------------------------------------------------------
el.offlineAudio.addEventListener("play", () => {
  if (activeEngine !== "offline") return;
  isPlaying = true;
  consecutiveErrors = 0;
  el.stateDot.dataset.state = "playing";
  el.trackSubtitle.textContent = "Đang phát Offline (Không cần mạng ✈️)";
  updatePlayButtonUI();
});

el.offlineAudio.addEventListener("pause", () => {
  if (activeEngine !== "offline") return;
  if (!el.offlineAudio.ended) {
    isPlaying = false;
    el.stateDot.dataset.state = "paused";
    el.trackSubtitle.textContent = "Đã tạm dừng — Nhấn ▶ để nghe tiếp";
    updatePlayButtonUI();
  }
});

el.offlineAudio.addEventListener("timeupdate", () => {
  if (activeEngine !== "offline") return;
  const cur = el.offlineAudio.currentTime || 0;
  const dur = el.offlineAudio.duration || 0;
  el.timeCurrent.textContent = formatTime(cur);
  el.timeTotal.textContent = formatTime(dur);
  const pct = dur > 0 ? Math.min(100, (cur / dur) * 100) : 0;
  el.progressFill.style.width = `${pct.toFixed(1)}%`;
});

el.offlineAudio.addEventListener("ended", () => {
  if (activeEngine !== "offline") return;
  isPlaying = false;
  nextTrack(true);
});

el.offlineAudio.addEventListener("error", () => {
  if (activeEngine !== "offline") return;
  isPlaying = false;
  el.stateDot.dataset.state = "paused";
  el.trackSubtitle.textContent = "Không đọc được file âm thanh offline này.";
  updatePlayButtonUI();
});

// ---------------------------------------------------------------------------
// YouTube IFrame Player API (Loaded only when online)
// ---------------------------------------------------------------------------
function loadYouTubeAPI() {
  if (!navigator.onLine) return;
  if (window.YT && window.YT.Player) return;
  const tag = document.createElement("script");
  tag.src = "https://www.youtube.com/iframe_api";
  tag.onerror = () => {
    // Offline mode: silently skip YouTube API
  };
  document.head.appendChild(tag);
}

window.addEventListener("online", () => {
  if (!ytReady) loadYouTubeAPI();
});

window.onYouTubeIframeAPIReady = function () {
  const track = currentTrack();
  const initialId = track && trackType(track) === "youtube" ? track.id : "";
  ytPlayer = new YT.Player("yt-player", {
    videoId: initialId,
    playerVars: {
      autoplay: 0,
      controls: 0,
      disablekb: 1,
      fs: 0,
      modestbranding: 1,
      playsinline: 1,
      rel: 0,
      iv_load_policy: 3,
    },
    events: {
      onReady: () => {
        ytReady = true;
        renderRadioUI();
      },
      onStateChange: onYTStateChange,
      onError: onYTError,
    },
  });
};

function onYTStateChange(event) {
  if (activeEngine !== "youtube") return;
  const s = event.data;
  if (s === YT.PlayerState.PLAYING) {
    isPlaying = true;
    consecutiveErrors = 0;
    el.stateDot.dataset.state = "playing";
    el.trackSubtitle.textContent = "Đang phát YouTube trên Đài Học Tập";
    startProgressLoop();
  } else if (s === YT.PlayerState.BUFFERING) {
    el.stateDot.dataset.state = "loading";
    el.trackSubtitle.textContent = "Đang dò sóng kênh...";
  } else if (s === YT.PlayerState.PAUSED || s === YT.PlayerState.CUED) {
    isPlaying = false;
    el.stateDot.dataset.state = "paused";
    el.trackSubtitle.textContent = "Đã tạm dừng — Nhấn ▶ để nghe tiếp";
    stopProgressLoop();
  } else if (s === YT.PlayerState.ENDED) {
    isPlaying = false;
    stopProgressLoop();
    nextTrack(true);
  }
  updatePlayButtonUI();
}

function onYTError() {
  if (activeEngine !== "youtube") return;
  consecutiveErrors += 1;
  el.stateDot.dataset.state = "paused";
  el.trackSubtitle.textContent = "Video bị hạn chế nhúng — Đang chuyển bài...";
  const ch = currentChannel();
  if (ch && ch.tracks.length > 1 && consecutiveErrors < ch.tracks.length) {
    setTimeout(() => nextTrack(true), 1200);
  } else {
    el.trackSubtitle.textContent = "Không phát được video. Hãy thêm file Offline hoặc đổi link YouTube.";
  }
}

function startProgressLoop() {
  stopProgressLoop();
  progressTimer = setInterval(() => {
    if (activeEngine !== "youtube" || !ytReady || !ytPlayer || typeof ytPlayer.getCurrentTime !== "function") return;
    const cur = ytPlayer.getCurrentTime() || 0;
    const dur = ytPlayer.getDuration() || 0;
    el.timeCurrent.textContent = formatTime(cur);
    el.timeTotal.textContent = formatTime(dur);
    const pct = dur > 0 ? Math.min(100, (cur / dur) * 100) : 0;
    el.progressFill.style.width = `${pct.toFixed(1)}%`;
  }, 500);
}

function stopProgressLoop() {
  if (progressTimer) {
    clearInterval(progressTimer);
    progressTimer = null;
  }
}

function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return "0:00";
  const s = Math.floor(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${r < 10 ? "0" : ""}${r}`;
}

// ---------------------------------------------------------------------------
// Unified Hybrid Playback Controls (Offline Audio + YouTube)
// ---------------------------------------------------------------------------
function stopAllEngines() {
  stopProgressLoop();
  if (!el.offlineAudio.paused) {
    el.offlineAudio.pause();
  }
  if (ytReady && ytPlayer && typeof ytPlayer.pauseVideo === "function") {
    try {
      ytPlayer.pauseVideo();
    } catch {
      // Ignore
    }
  }
  isPlaying = false;
}

async function playCurrentTrack(autoStart = true) {
  const track = currentTrack();
  renderRadioUI();
  stopAllEngines();

  if (!track) {
    activeEngine = "none";
    el.trackTitle.textContent = "Kênh chưa có bài học";
    el.trackSubtitle.textContent = "Giữ nút KÊNH 2.5 giây để phụ huynh thêm bài Offline / YouTube";
    return;
  }

  el.progressFill.style.width = "0%";
  el.timeCurrent.textContent = "0:00";
  el.timeTotal.textContent = "0:00";

  // --- OFFLINE AUDIO ENGINE ---
  if (trackType(track) === "offline") {
    activeEngine = "offline";
    el.stateDot.dataset.state = "loading";
    el.trackSubtitle.textContent = "Đang mở file âm thanh Offline...";
    try {
      const blob = await getOfflineAudio(track.id);
      if (!blob) {
        el.stateDot.dataset.state = "paused";
        el.trackSubtitle.textContent = "File offline không còn trong bộ nhớ. Hãy nạp lại.";
        return;
      }
      if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl);
      currentBlobUrl = URL.createObjectURL(blob);
      loadedOfflineTrackId = track.id;
      el.offlineAudio.src = currentBlobUrl;
      if (autoStart) {
        await el.offlineAudio.play();
      }
    } catch {
      el.stateDot.dataset.state = "paused";
      el.trackSubtitle.textContent = "Nhấn ▶ để phát bài Offline";
      updatePlayButtonUI();
    }
    return;
  }

  // --- YOUTUBE ENGINE ---
  activeEngine = "youtube";
  if (!navigator.onLine) {
    el.stateDot.dataset.state = "paused";
    const ch = currentChannel();
    const offlineIdx = ch ? ch.tracks.findIndex((t) => trackType(t) === "offline") : -1;
    if (offlineIdx >= 0 && offlineIdx !== state.trackIndex) {
      el.trackSubtitle.textContent = "Đang Offline — Tự chuyển sang bài Offline ✈️";
      state.trackIndex = offlineIdx;
      saveState();
      setTimeout(() => playCurrentTrack(autoStart), 700);
    } else {
      el.trackSubtitle.textContent = "Đang không có mạng — Hãy thêm file MP3/M4A Offline!";
    }
    updatePlayButtonUI();
    return;
  }

  if (!ytReady || !ytPlayer) {
    loadYouTubeAPI();
    el.trackSubtitle.textContent = "Đang kết nối YouTube...";
    return;
  }

  if (autoStart) {
    ytPlayer.loadVideoById(track.id);
    ytPlayer.playVideo();
  } else {
    ytPlayer.cueVideoById(track.id);
  }
}

async function togglePlay() {
  playClickSfx(isPlaying ? 440 : 620);
  const track = currentTrack();
  if (!track) return;

  if (trackType(track) === "offline") {
    if (activeEngine === "offline" && loadedOfflineTrackId === track.id && el.offlineAudio.src) {
      if (el.offlineAudio.paused) {
        try {
          await el.offlineAudio.play();
        } catch {
          // Ignore
        }
      } else {
        el.offlineAudio.pause();
      }
    } else {
      await playCurrentTrack(true);
    }
    return;
  }

  // YouTube track
  if (!navigator.onLine) {
    playCurrentTrack(true);
    return;
  }
  if (!ytReady || !ytPlayer) return;
  if (activeEngine !== "youtube") {
    await playCurrentTrack(true);
    return;
  }
  if (isPlaying) {
    ytPlayer.pauseVideo();
  } else {
    const curData = ytPlayer.getVideoData ? ytPlayer.getVideoData() : null;
    if (!curData || curData.video_id !== track.id) {
      ytPlayer.loadVideoById(track.id);
    }
    ytPlayer.playVideo();
  }
}

function prevTrack() {
  playClickSfx(480);
  const ch = currentChannel();
  if (!ch || !ch.tracks.length) return;
  state.trackIndex = (state.trackIndex - 1 + ch.tracks.length) % ch.tracks.length;
  saveState();
  playCurrentTrack(true);
}

function nextTrack(fromAuto = false) {
  if (!fromAuto) playClickSfx(560);
  const ch = currentChannel();
  if (!ch || !ch.tracks.length) return;
  state.trackIndex = (state.trackIndex + 1) % ch.tracks.length;
  saveState();
  playCurrentTrack(true);
}

function switchChannel() {
  playClickSfx(740, 0.07);
  if (!state.channels.length) return;
  state.channelIndex = (state.channelIndex + 1) % state.channels.length;
  state.trackIndex = 0;
  saveState();
  playCurrentTrack(true);
}

// ---------------------------------------------------------------------------
// UI Rendering & Calibration
// ---------------------------------------------------------------------------
function updatePlayButtonUI() {
  el.iconPlay.hidden = isPlaying;
  el.iconPause.hidden = !isPlaying;
  el.playLabel.textContent = isPlaying ? "DỪNG" : "PHÁT";
  el.btnPlay.classList.toggle("is-playing", isPlaying);
  el.eqBars.classList.toggle("playing", isPlaying);
}

function renderRadioUI() {
  const ch = currentChannel();
  const track = currentTrack();
  if (ch) {
    el.channelIcon.textContent = ch.icon || "📻";
    el.channelFreq.textContent = ch.freq || "FM 90.0";
    el.channelName.textContent = ch.name || "ĐÀI CỦA BÉ";
    el.trackCounter.textContent = ch.tracks.length
      ? `${state.trackIndex + 1} / ${ch.tracks.length}`
      : "0 / 0";
  }
  if (track) {
    const t = trackType(track);
    el.trackTitle.textContent = track.title;
    el.sourceBadge.dataset.source = t;
    el.sourceBadge.textContent = t === "offline" ? "✈️ OFFLINE" : "YT";
  } else {
    el.trackTitle.textContent = "Chưa có bài trong kênh này";
    el.sourceBadge.dataset.source = "offline";
    el.sourceBadge.textContent = "TRỐNG";
  }
  updatePlayButtonUI();
}

function applyDisplayAndCalibration() {
  const isMini = state.displayMode === "mini-video";
  document.body.classList.toggle("mini-video-mode", isMini);
  el.miniVideoShield.hidden = !isMini;
  el.calOverlay.hidden = !state.calGrid;
  document.documentElement.style.setProperty("--offset-x", `${state.offsetX}%`);
  document.documentElement.style.setProperty("--offset-y", `${state.offsetY}%`);
}

// ---------------------------------------------------------------------------
// Sleep Timer
// ---------------------------------------------------------------------------
function setSleepTimer(minutes) {
  if (sleepTimerInterval) {
    clearInterval(sleepTimerInterval);
    sleepTimerInterval = null;
  }
  if (!minutes || minutes <= 0) {
    sleepEndTime = null;
    el.sleepBadge.hidden = true;
    return;
  }
  sleepEndTime = Date.now() + minutes * 60 * 1000;
  updateSleepBadge();
  sleepTimerInterval = setInterval(updateSleepBadge, 5000);
}

function updateSleepBadge() {
  if (!sleepEndTime) {
    el.sleepBadge.hidden = true;
    return;
  }
  const remMs = sleepEndTime - Date.now();
  if (remMs <= 0) {
    setSleepTimer(0);
    el.selectSleepTimer.value = "0";
    stopAllEngines();
    updatePlayButtonUI();
    el.trackSubtitle.textContent = "Đã hết giờ nghe đài — Bé nghỉ ngơi nhé! 🌙";
    return;
  }
  const remMin = Math.ceil(remMs / 60000);
  el.sleepBadge.textContent = `⏱ ${remMin}p`;
  el.sleepBadge.hidden = false;
}

// ---------------------------------------------------------------------------
// Button Event Binding (2.5s Long-Press on Channel for Parent Gate)
// ---------------------------------------------------------------------------
el.btnPrev.addEventListener("click", prevTrack);
el.btnPlay.addEventListener("click", togglePlay);
el.btnNext.addEventListener("click", () => nextTrack(false));

let holdTimer = null;
let didLongPress = false;

function startChannelHold(e) {
  if (e.type === "mousedown" && e.button !== 0) return;
  didLongPress = false;
  el.btnChannel.classList.add("holding");
  holdTimer = setTimeout(() => {
    didLongPress = true;
    el.btnChannel.classList.remove("holding");
    playClickSfx(880, 0.09);
    openPinDialog();
  }, 2500);
}

function cancelChannelHold() {
  el.btnChannel.classList.remove("holding");
  if (holdTimer) {
    clearTimeout(holdTimer);
    holdTimer = null;
  }
}

el.btnChannel.addEventListener("touchstart", startChannelHold, { passive: true });
el.btnChannel.addEventListener("touchend", cancelChannelHold);
el.btnChannel.addEventListener("touchcancel", cancelChannelHold);
el.btnChannel.addEventListener("mousedown", startChannelHold);
el.btnChannel.addEventListener("mouseup", cancelChannelHold);
el.btnChannel.addEventListener("mouseleave", cancelChannelHold);
el.btnChannel.addEventListener("click", () => {
  if (didLongPress) {
    didLongPress = false;
    return;
  }
  switchChannel();
});

if (el.desktopParentBtn) {
  el.desktopParentBtn.addEventListener("click", openPinDialog);
}

// ---------------------------------------------------------------------------
// Parent PIN Gate
// ---------------------------------------------------------------------------
let pinBuffer = "";

function openPinDialog() {
  pinBuffer = "";
  el.pinError.hidden = true;
  renderPinDots();
  el.pinDialog.showModal();
}

function renderPinDots() {
  const dots = el.pinDots.querySelectorAll("span");
  dots.forEach((d, i) => d.classList.toggle("filled", i < pinBuffer.length));
}

document.querySelector(".pin-keypad").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-pin]");
  if (!btn) return;
  const val = btn.dataset.pin;
  el.pinError.hidden = true;
  if (val === "clear") {
    pinBuffer = "";
  } else if (val === "back") {
    pinBuffer = pinBuffer.slice(0, -1);
  } else if (pinBuffer.length < 4) {
    pinBuffer += val;
  }
  renderPinDots();

  if (pinBuffer.length === 4) {
    if (pinBuffer === state.pin) {
      el.pinDialog.close();
      openParentDashboard();
    } else {
      el.pinError.hidden = false;
      pinBuffer = "";
      setTimeout(renderPinDots, 250);
    }
  }
});

document.querySelectorAll("[data-close-dialog]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const dlg = document.getElementById(btn.dataset.closeDialog);
    if (dlg) dlg.close();
  });
});

// ---------------------------------------------------------------------------
// Parent Dashboard Logic
// ---------------------------------------------------------------------------
function openParentDashboard() {
  syncAdminControls();
  el.parentDialog.showModal();
}

document.querySelector(".parent-tabs").addEventListener("click", (e) => {
  const tab = e.target.closest(".tab-btn");
  if (!tab) return;
  const name = tab.dataset.tab;
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b === tab));
  document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.dataset.panel === name));
});

async function refreshOfflineStorageInfo() {
  const stats = await getOfflineStats();
  el.offlineStorageInfo.textContent = `${stats.count} bài offline (${stats.mb} MB)`;
}

function syncAdminControls() {
  el.adminChannelSelect.innerHTML = "";
  state.channels.forEach((ch, idx) => {
    const opt = document.createElement("option");
    opt.value = String(idx);
    opt.textContent = `${ch.icon} ${ch.freq} — ${ch.name}`;
    el.adminChannelSelect.appendChild(opt);
  });
  el.adminChannelSelect.value = String(state.channelIndex);
  renderAdminTrackList();
  refreshOfflineStorageInfo();

  el.selectDisplayMode.value = state.displayMode;
  el.toggleClickSfx.checked = state.clickSfx;
  el.toggleCalGrid.checked = state.calGrid;
  el.rangeOffsetX.value = String(state.offsetX);
  el.rangeOffsetY.value = String(state.offsetY);
  el.valOffsetX.textContent = `${state.offsetX}%`;
  el.valOffsetY.textContent = `${state.offsetY}%`;
}

function renderAdminTrackList() {
  const chIdx = Number(el.adminChannelSelect.value) || 0;
  const ch = state.channels[chIdx];
  el.adminTrackList.innerHTML = "";
  if (!ch || !ch.tracks.length) {
    const empty = document.createElement("li");
    empty.className = "admin-track-item";
    empty.textContent = "Chưa có bài học nào trong kênh này. Hãy chọn file MP3/M4A Offline hoặc dán link YouTube!";
    el.adminTrackList.appendChild(empty);
    return;
  }

  ch.tracks.forEach((tr, tIdx) => {
    const li = document.createElement("li");
    li.className = "admin-track-item";

    const info = document.createElement("div");
    info.className = "admin-track-info";
    const titleEl = document.createElement("div");
    titleEl.className = "admin-track-title";
    const badge = trackType(tr) === "offline" ? "✈️ [Offline] " : "▶ [YT] ";
    titleEl.textContent = `${tIdx + 1}. ${badge}${tr.title}`;
    const idEl = document.createElement("div");
    idEl.className = "admin-track-id";
    idEl.textContent = trackType(tr) === "offline"
      ? `Lưu trong máy (${tr.sizeMb || "?"} MB)`
      : `YouTube ID: ${tr.id}`;
    info.append(titleEl, idEl);

    const actions = document.createElement("div");
    actions.className = "admin-track-actions";

    const playBtn = document.createElement("button");
    playBtn.type = "button";
    playBtn.className = "btn-mini";
    playBtn.textContent = "▶ Phát";
    playBtn.addEventListener("click", () => {
      state.channelIndex = chIdx;
      state.trackIndex = tIdx;
      saveState();
      el.parentDialog.close();
      playCurrentTrack(true);
    });

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn-mini del";
    delBtn.textContent = "Xóa";
    delBtn.addEventListener("click", async () => {
      const removed = ch.tracks.splice(tIdx, 1)[0];
      if (removed && trackType(removed) === "offline") {
        await deleteOfflineAudio(removed.id);
      }
      if (state.channelIndex === chIdx && state.trackIndex >= ch.tracks.length) {
        state.trackIndex = 0;
      }
      saveState();
      renderAdminTrackList();
      refreshOfflineStorageInfo();
      renderRadioUI();
    });

    actions.append(playBtn, delBtn);
    li.append(info, actions);
    el.adminTrackList.appendChild(li);
  });
}

// Multi-file Offline Audio Import (MP3 / M4A / WAV / AAC)
el.inputOfflineFiles.addEventListener("change", async (e) => {
  const files = Array.from(e.target.files || []);
  if (!files.length) return;
  const chIdx = Number(el.adminChannelSelect.value) || 0;
  el.offlineImportStatus.textContent = `Đang lưu ${files.length} file vào bộ nhớ Offline...`;

  let added = 0;
  for (const file of files) {
    try {
      const id = `off_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const cleanTitle = file.name.replace(/\.[^/.]+$/, "").replace(/[_-]+/g, " ").trim();
      await saveOfflineAudio(id, file, file.size);
      state.channels[chIdx].tracks.unshift({
        type: "offline",
        id,
        title: cleanTitle || "Bài học Offline",
        sizeMb: (file.size / (1024 * 1024)).toFixed(1),
      });
      added += 1;
    } catch {
      // Skip unreadable file
    }
  }

  saveState();
  el.inputOfflineFiles.value = "";
  el.offlineImportStatus.textContent = `Đã thêm ${added} bài Offline thành công! Bật Chế độ máy bay vẫn phát mượt.`;
  renderAdminTrackList();
  refreshOfflineStorageInfo();
  renderRadioUI();
});

function extractYouTubeId(input) {
  const s = input.trim();
  if (/^[a-zA-Z0-9_-]{11}$/.test(s)) return s;
  try {
    const url = new URL(s.startsWith("http") ? s : `https://${s}`);
    if (url.hostname.includes("youtu.be")) {
      const id = url.pathname.replace("/", "").slice(0, 11);
      if (/^[a-zA-Z0-9_-]{11}$/.test(id)) return id;
    }
    const v = url.searchParams.get("v");
    if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
    const parts = url.pathname.split("/").filter(Boolean);
    const markerIdx = parts.findIndex((p) => p === "embed" || p === "shorts" || p === "live");
    if (markerIdx >= 0 && parts[markerIdx + 1]) {
      const id = parts[markerIdx + 1].slice(0, 11);
      if (/^[a-zA-Z0-9_-]{11}$/.test(id)) return id;
    }
  } catch {
    // Fallback regex
  }
  const m = s.match(/(?:v=|\/)([a-zA-Z0-9_-]{11})/);
  return m ? m[1] : null;
}

el.adminChannelSelect.addEventListener("change", renderAdminTrackList);

el.addVideoForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const id = extractYouTubeId(el.inputYtUrl.value);
  const title = el.inputYtTitle.value.trim();
  if (!id) {
    alert("Không nhận diện được link YouTube. Vui lòng dán link dạng https://youtu.be/... hoặc https://www.youtube.com/watch?v=...");
    return;
  }
  const chIdx = Number(el.adminChannelSelect.value) || 0;
  state.channels[chIdx].tracks.push({ type: "youtube", id, title: title || `Video ${id}` });
  saveState();
  el.inputYtUrl.value = "";
  el.inputYtTitle.value = "";
  renderAdminTrackList();
  renderRadioUI();
});

el.btnAddChannel.addEventListener("click", () => {
  const name = prompt("Nhập tên kênh mới (VD: KHOA HỌC VUI):");
  if (!name || !name.trim()) return;
  const freq = `FM ${(88 + state.channels.length * 4.5).toFixed(1)}`;
  state.channels.push({
    id: `ch-${Date.now()}`,
    icon: "⭐",
    freq,
    name: name.trim().toUpperCase(),
    tracks: [],
  });
  saveState();
  syncAdminControls();
  el.adminChannelSelect.value = String(state.channels.length - 1);
  renderAdminTrackList();
});

el.selectDisplayMode.addEventListener("change", () => {
  state.displayMode = el.selectDisplayMode.value;
  saveState();
  applyDisplayAndCalibration();
});

el.selectSleepTimer.addEventListener("change", () => {
  setSleepTimer(Number(el.selectSleepTimer.value) || 0);
});

el.toggleClickSfx.addEventListener("change", () => {
  state.clickSfx = el.toggleClickSfx.checked;
  saveState();
});

el.toggleCalGrid.addEventListener("change", () => {
  state.calGrid = el.toggleCalGrid.checked;
  saveState();
  applyDisplayAndCalibration();
});

el.rangeOffsetX.addEventListener("input", () => {
  state.offsetX = Number(el.rangeOffsetX.value);
  el.valOffsetX.textContent = `${state.offsetX}%`;
  saveState();
  applyDisplayAndCalibration();
});

el.rangeOffsetY.addEventListener("input", () => {
  state.offsetY = Number(el.rangeOffsetY.value);
  el.valOffsetY.textContent = `${state.offsetY}%`;
  saveState();
  applyDisplayAndCalibration();
});

el.btnSavePin.addEventListener("click", () => {
  const np = el.inputNewPin.value.trim();
  if (!/^[0-9]{4}$/.test(np)) {
    alert("Mã PIN phải gồm đúng 4 chữ số!");
    return;
  }
  state.pin = np;
  saveState();
  el.inputNewPin.value = "";
  alert("Đã lưu mã PIN Phụ huynh mới!");
});

el.btnResetDefaults.addEventListener("click", () => {
  if (!confirm("Khôi phục lại toàn bộ kênh mặc định và cài đặt ban đầu?")) return;
  state = structuredClone(DEFAULT_DATA);
  saveState();
  applyDisplayAndCalibration();
  syncAdminControls();
  renderRadioUI();
});

// ---------------------------------------------------------------------------
// Register Service Worker for 100% Offline PWA Boot
// ---------------------------------------------------------------------------
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {
      // Service worker requires HTTPS or localhost
    });
  });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
applyDisplayAndCalibration();
renderRadioUI();
loadYouTubeAPI();
