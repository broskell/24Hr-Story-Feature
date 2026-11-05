const STORAGE_KEY = "stories:v1";
const EXPIRY_MS = 24 * 60 * 60 * 1000;
const MAX_WIDTH = 1080;
const MAX_HEIGHT = 1920;
const DEFAULT_DURATION_SEC = 15;
const MIN_DURATION_SEC = 15;
const MAX_DURATION_SEC = 60;
const MAX_COMMENT_LENGTH = 250;
const COMMENT_AUTHOR = "You";
const SWIPE_THRESHOLD = 50;

let viewerStack = [];
let viewerIndex = 0;
let timerId = null;
let timerStartedAt = 0;
let timerElapsedBeforePause = 0;
let isTimerPaused = false;
let touchStartX = 0;
let touchStartY = 0;
let didSwipe = false;

const loadStories = () => {
  const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  return Array.isArray(data) ? data : [];
};

const saveStories = (stories) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stories));
    return true;
  } catch (error) {
    showUploadError("Storage is full. Remove old stories or use a smaller image.");
    return false;
  }
};

const clampDuration = (value) => {
  const num = Number(value);
  if (Number.isNaN(num)) return DEFAULT_DURATION_SEC;
  return Math.min(MAX_DURATION_SEC, Math.max(MIN_DURATION_SEC, Math.round(num)));
};

const createStory = (base64, durationSeconds) => ({
  id: Date.now(),
  base64,
  createdAt: Date.now(),
  seen: false,
  durationSeconds: clampDuration(durationSeconds),
  likeCount: 0,
  comments: [],
});

const addStory = (story) => {
  const stories = [story].concat(loadStories());
  saveStories(stories);
  return stories;
};

const markStorySeen = (id) => {
  const stories = loadStories().map((story) => {
    if (story.id !== id) return story;
    return {
      id: story.id,
      base64: story.base64,
      createdAt: story.createdAt,
      seen: true,
      durationSeconds: story.durationSeconds || DEFAULT_DURATION_SEC,
      likeCount: story.likeCount || 0,
      comments: Array.isArray(story.comments) ? story.comments : [],
    };
  });
  saveStories(stories);
  return stories;
};

const removeExpiredStories = () => {
  const now = Date.now();
  const active = loadStories().filter(
    (story) => now - story.createdAt < EXPIRY_MS
  );
  saveStories(active);
  return active;
};

const showUploadError = (message) => {
  const el = document.getElementById("upload-error");
  el.textContent = message;
  el.hidden = false;
};

const hideUploadError = () => {
  document.getElementById("upload-error").hidden = true;
};

const readFileAsDataURL = (file) =>
  new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });

// Center-crop to 9:16, then scale down to fit inside 1080×1920.
const cropImage = (src) =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const targetRatio = 9 / 16;
      let sourceWidth = img.width;
      let sourceHeight = img.height;
      let sourceX = 0;
      let sourceY = 0;

      const imageRatio = sourceWidth / sourceHeight;

      if (imageRatio > targetRatio) {
        sourceWidth = sourceHeight * targetRatio;
        sourceX = (img.width - sourceWidth) / 2;
      } else if (imageRatio < targetRatio) {
        sourceHeight = sourceWidth / targetRatio;
        sourceY = (img.height - sourceHeight) / 2;
      }

      let outWidth = sourceWidth;
      let outHeight = sourceHeight;

      if (outWidth > MAX_WIDTH || outHeight > MAX_HEIGHT) {
        const scale = Math.min(MAX_WIDTH / outWidth, MAX_HEIGHT / outHeight);
        outWidth = Math.floor(outWidth * scale);
        outHeight = Math.floor(outHeight * scale);
      } else {
        outWidth = Math.floor(outWidth);
        outHeight = Math.floor(outHeight);
      }

      const canvas = document.createElement("canvas");
      canvas.width = outWidth;
      canvas.height = outHeight;

      const ctx = canvas.getContext("2d");
      ctx.drawImage(
        img,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        outWidth,
        outHeight
      );

      resolve(canvas.toDataURL("image/jpeg", 0.92));
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });

const createStoryCircle = (story) => {
  const button = document.createElement("button");
  button.type = "button";
  button.className =
    "story-circle story-ring " + (story.seen ? "ring-seen" : "ring-unseen");
  button.dataset.storyId = String(story.id);
  button.setAttribute("aria-label", "View story");

  const inner = document.createElement("span");
  inner.className = "story-ring__inner";

  const img = document.createElement("img");
  img.className = "story-ring__thumb";
  img.src = story.base64;
  img.alt = "";
  img.width = 64;
  img.height = 64;

  inner.appendChild(img);
  button.appendChild(inner);
  return button;
};

const renderTray = (stories) => {
  const tray = document.getElementById("story-tray");
  Array.from(tray.querySelectorAll(".story-circle")).forEach((circle) =>
    circle.remove()
  );
  stories.forEach((story) => tray.appendChild(createStoryCircle(story)));
};

const processUpload = async (file) => {
  hideUploadError();
  if (!file || !file.type.startsWith("image/")) {
    showUploadError("Please choose a valid image file.");
    return;
  }

  const durationSeconds = clampDuration(
    document.getElementById("story-duration").value
  );

  const base64 = await readFileAsDataURL(file);
  if (!base64) return;

  const cropped = await cropImage(base64);
  if (!cropped) {
    showUploadError("Could not process this image. Try another file.");
    return;
  }

  addStory(createStory(cropped, durationSeconds));
  renderTray(loadStories());
};

const handleFileSelect = (event) => {
  const file = event.target.files[0];
  processUpload(file);
  event.target.value = "";
};

const handleAddClick = () => {
  document.getElementById("file-input").click();
};

const getStackFrom = (startId) => {
  const stories = loadStories();
  const startIndex = stories.findIndex(
    (story) => story.id === Number(startId)
  );
  if (startIndex === -1) return [];
  return stories.slice(startIndex);
};

const getDurationMsForStory = (story) => {
  const seconds = story.durationSeconds || DEFAULT_DURATION_SEC;
  return seconds * 1000;
};

const stopTimer = () => {
  if (timerId !== null) {
    clearInterval(timerId);
    timerId = null;
  }
};

const getElapsedMs = () => {
  if (isTimerPaused) {
    return timerElapsedBeforePause;
  }
  return timerElapsedBeforePause + (Date.now() - timerStartedAt);
};

const updateActiveProgress = () => {
  const active = document.querySelector(
    "#progress-segments .progress-segment.is-active .progress-segment__fill"
  );
  if (!active) return;

  const story = viewerStack[viewerIndex];
  if (!story) return;

  const durationMs = getDurationMsForStory(story);
  const elapsed = getElapsedMs();
  let percent = (elapsed / durationMs) * 100;
  if (percent > 100) percent = 100;
  active.style.width = percent + "%";
};

const renderProgressSegments = () => {
  const container = document.getElementById("progress-segments");
  container.innerHTML = "";

  viewerStack.forEach((story, index) => {
    const segment = document.createElement("div");
    segment.className = "progress-segment";

    if (index < viewerIndex) {
      segment.className = "progress-segment is-complete";
    } else if (index === viewerIndex) {
      segment.className = "progress-segment is-active";
    }

    const fill = document.createElement("span");
    fill.className = "progress-segment__fill";
    if (index < viewerIndex) {
      fill.style.width = "100%";
    } else if (index === viewerIndex) {
      fill.style.width = "0%";
    }
    segment.appendChild(fill);
    container.appendChild(segment);
  });
};

const startTimer = () => {
  stopTimer();
  isTimerPaused = false;
  timerStartedAt = Date.now();
  updateActiveProgress();

  timerId = setInterval(() => {
    if (isTimerPaused) return;

    updateActiveProgress();
    const story = viewerStack[viewerIndex];
    if (!story) return;

    const elapsed = getElapsedMs();
    if (elapsed >= getDurationMsForStory(story)) {
      goNext();
    }
  }, 50);
};

const pauseTimer = () => {
  if (isTimerPaused) return;
  isTimerPaused = true;
  timerElapsedBeforePause = getElapsedMs();
  stopTimer();
};

const resumeTimer = () => {
  if (!isTimerPaused) return;
  isTimerPaused = false;
  timerStartedAt = Date.now();
  startTimer();
};

const renderComments = (story) => {
  const listEl = document.getElementById("comments-list");
  const emptyEl = document.getElementById("comment-empty");
  listEl.innerHTML = "";

  const comments = Array.isArray(story.comments) ? story.comments : [];
  emptyEl.hidden = comments.length > 0;

  comments.forEach((comment) => {
    const li = document.createElement("li");
    const author = document.createElement("span");
    author.className = "comment-author";
    author.textContent = comment.author + ":";
    const text = document.createElement("span");
    text.textContent = comment.text;
    li.appendChild(author);
    li.appendChild(text);
    listEl.appendChild(li);
  });
};

const refreshLikeAndComments = () => {
  const story = viewerStack[viewerIndex];
  if (!story) return;

  document.getElementById("like-count").textContent = String(
    story.likeCount || 0
  );
  renderComments(story);
};

const incrementLike = (storyId) => {
  const stories = loadStories().map((story) => {
    if (story.id !== storyId) return story;
    return {
      ...story,
      likeCount: (story.likeCount || 0) + 1,
    };
  });
  saveStories(stories);

  const updated = stories.find((s) => s.id === storyId);
  if (updated && viewerStack[viewerIndex]) {
    viewerStack[viewerIndex] = updated;
  }
  return updated;
};

const addComment = (storyId, text) => {
  const newComment = {
    id: Date.now(),
    author: COMMENT_AUTHOR,
    text,
    createdAt: Date.now(),
  };

  const stories = loadStories().map((story) => {
    if (story.id !== storyId) return story;
    const comments = Array.isArray(story.comments) ? story.comments : [];
    return {
      ...story,
      comments: comments.concat([newComment]),
    };
  });
  saveStories(stories);

  const updated = stories.find((s) => s.id === storyId);
  if (updated && viewerStack[viewerIndex]) {
    viewerStack[viewerIndex] = updated;
  }
  return updated;
};

const handleLikeClick = (event) => {
  event.stopPropagation();
  const story = viewerStack[viewerIndex];
  if (!story) return;
  incrementLike(story.id);
  refreshLikeAndComments();
};

const handleCommentSubmit = (event) => {
  event.preventDefault();
  event.stopPropagation();

  const story = viewerStack[viewerIndex];
  if (!story) return;

  const input = document.getElementById("comment-input");
  const text = input.value.trim();
  if (!text) return;
  if (text.length > MAX_COMMENT_LENGTH) {
    showUploadError(
      "Comments are limited to " + MAX_COMMENT_LENGTH + " characters."
    );
    return;
  }

  addComment(story.id, text);
  input.value = "";
  refreshLikeAndComments();
  resumeTimer();
};

const showStoryAt = (index) => {
  viewerIndex = index;
  const story = viewerStack[viewerIndex];
  if (!story) {
    closeViewer();
    return;
  }

  timerElapsedBeforePause = 0;
  document.getElementById("viewer-image").src = story.base64;
  markStorySeen(story.id);
  renderTray(loadStories());

  const fresh = loadStories().find((s) => s.id === story.id);
  if (fresh) viewerStack[viewerIndex] = fresh;

  refreshLikeAndComments();
  renderProgressSegments();
  startTimer();
};

const goNext = () => {
  if (viewerIndex >= viewerStack.length - 1) {
    closeViewer();
    return;
  }
  showStoryAt(viewerIndex + 1);
};

const goPrev = () => {
  if (viewerIndex <= 0) return;
  showStoryAt(viewerIndex - 1);
};

const openViewer = (startId) => {
  viewerStack = getStackFrom(startId);
  if (viewerStack.length === 0) return;

  viewerIndex = 0;
  document.getElementById("comment-input").value = "";
  document.getElementById("viewer").hidden = false;
  showStoryAt(0);
};

const closeViewer = () => {
  stopTimer();
  isTimerPaused = false;
  timerElapsedBeforePause = 0;
  viewerStack = [];
  viewerIndex = 0;
  document.getElementById("viewer-image").src = "";
  document.getElementById("comment-input").value = "";
  document.getElementById("viewer").hidden = true;
};

const handleTrayClick = (event) => {
  const circle = event.target.closest(".story-circle");
  if (!circle) return;
  openViewer(circle.dataset.storyId);
};

const handleFrameClick = (event) => {
  if (document.getElementById("viewer").hidden) return;
  if (event.target.closest("#viewer-close")) return;
  if (event.target.closest(".viewer-footer")) return;
  if (event.target.closest("#like-btn")) return;

  if (didSwipe) {
    didSwipe = false;
    return;
  }

  const frame = document.getElementById("viewer-frame");
  const rect = frame.getBoundingClientRect();
  const x = event.clientX - rect.left;

  if (x < rect.width / 2) {
    goPrev();
  } else {
    goNext();
  }
};

const handleTouchStart = (event) => {
  touchStartX = event.changedTouches[0].screenX;
  touchStartY = event.changedTouches[0].screenY;
};

const handleTouchEnd = (event) => {
  const dx = event.changedTouches[0].screenX - touchStartX;
  const dy = event.changedTouches[0].screenY - touchStartY;

  if (Math.abs(dx) < SWIPE_THRESHOLD) return;
  if (Math.abs(dx) <= Math.abs(dy)) return;

  didSwipe = true;
  if (dx < 0) {
    goNext();
  } else {
    goPrev();
  }

  setTimeout(() => {
    didSwipe = false;
  }, 100);
};

const handleCloseClick = (event) => {
  event.stopPropagation();
  closeViewer();
};

const handleBackdropClick = (event) => {
  if (event.target !== event.currentTarget) return;
  closeViewer();
};

const cleanupExpiredStories = () => {
  const beforeCount = loadStories().length;
  const active = removeExpiredStories();
  if (active.length !== beforeCount) {
    renderTray(active);
  }
};

const bindGestures = () => {
  const frame = document.getElementById("viewer-frame");
  frame.addEventListener("click", handleFrameClick);
  frame.addEventListener("touchstart", handleTouchStart, { passive: true });
  frame.addEventListener("touchend", handleTouchEnd, { passive: true });
};

const bindEvents = () => {
  document.getElementById("add-story-btn").addEventListener("click", handleAddClick);
  document.getElementById("file-input").addEventListener("change", handleFileSelect);
  document.getElementById("story-tray").addEventListener("click", handleTrayClick);
  document.getElementById("viewer-close").addEventListener("click", handleCloseClick);
  document.getElementById("viewer-backdrop").addEventListener("click", handleBackdropClick);
  document.getElementById("like-btn").addEventListener("click", handleLikeClick);
  document.getElementById("comment-form").addEventListener("submit", handleCommentSubmit);

  document.getElementById("comment-input").addEventListener("focus", pauseTimer);
  document.getElementById("comment-input").addEventListener("blur", () => {
    resumeTimer();
  });

  bindGestures();
};

const init = () => {
  document.getElementById("viewer").hidden = true;
  removeExpiredStories();
  renderTray(loadStories());
  bindEvents();
  setInterval(cleanupExpiredStories, 60000);
};

init();