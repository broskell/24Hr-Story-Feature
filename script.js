const STORAGE_KEY = 'stories_app_data';
const EXPIRY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DURATION_SEC = 15;
const MIN_DURATION_SEC = 15;
const MAX_DURATION_SEC = 60;
const MAX_WIDTH = 1080;
const MAX_HEIGHT = 1920;
const MAX_COMMENT_LENGTH = 250;
const COMMENT_AUTHOR = 'You';
const SWIPE_THRESHOLD = 50;

const storiesListEl = document.getElementById('stories-list');
const addStoryBtn = document.getElementById('add-story-btn');
const fileInput = document.getElementById('story-file-input');
const uploadPanel = document.getElementById('upload-panel');
const durationInput = document.getElementById('story-duration');
const appMessage = document.getElementById('app-message');

const storyViewer = document.getElementById('story-viewer');
const viewerClose = document.getElementById('viewer-close');
const progressContainer = document.getElementById('progress-container');
const storyImage = document.getElementById('story-image');
const tapPrev = document.getElementById('tap-prev');
const tapNext = document.getElementById('tap-next');
const likeBtn = document.getElementById('like-btn');
const likeCountEl = document.getElementById('like-count');
const commentsList = document.getElementById('comments-list');
const commentEmpty = document.getElementById('comment-empty');
const commentForm = document.getElementById('comment-form');
const commentInput = document.getElementById('comment-input');

let viewerOpen = false;
let currentIndex = 0;
let storiesInViewer = [];
let animationFrameId = null;
let timerStartMs = 0;
let pausedElapsedMs = 0;
let timerPaused = false;
let touchStartX = 0;
let touchStartY = 0;

const showMessage = (text, isInfo = false) => {
  appMessage.textContent = text;
  appMessage.hidden = false;
  appMessage.classList.toggle('app-message--info', isInfo);
  clearTimeout(showMessage._timer);
  showMessage._timer = setTimeout(() => {
    appMessage.hidden = true;
  }, 5000);
};

const loadStories = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const saveStories = (stories) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stories));
    return true;
  } catch {
    showMessage('Storage is full. Remove old stories or use a smaller image.');
    return false;
  }
};

const migrateStory = (story) => ({
  ...story,
  durationSeconds: story.durationSeconds ?? DEFAULT_DURATION_SEC,
  likeCount: typeof story.likeCount === 'number' ? story.likeCount : 0,
  comments: Array.isArray(story.comments) ? story.comments : [],
});

const removeExpiredStories = () => {
  const now = Date.now();
  const stories = loadStories().map(migrateStory);
  const active = stories.filter((s) => s.expiresAt > now);
  if (active.length !== stories.length) {
    saveStories(active);
  }
  return active;
};

const getActiveStories = () => {
  const active = removeExpiredStories();
  return [...active].sort((a, b) => a.createdAt - b.createdAt);
};

const createStoryId = () =>
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const clampDuration = (value) => {
  const num = Number(value);
  if (Number.isNaN(num)) return DEFAULT_DURATION_SEC;
  return Math.min(MAX_DURATION_SEC, Math.max(MIN_DURATION_SEC, Math.round(num)));
};

const validateImageFile = (file) => {
  if (!file || !file.type.startsWith('image/')) {
    return false;
  }
  return true;
};

const resizeImage = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Invalid image'));
      img.onload = () => {
        let { width, height } = img;
        const ratio = Math.min(MAX_WIDTH / width, MAX_HEIGHT / height, 1);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

const addStory = (imageData, durationSeconds) => {
  const now = Date.now();
  const story = {
    id: createStoryId(),
    imageData,
    createdAt: now,
    expiresAt: now + EXPIRY_MS,
    durationSeconds: clampDuration(durationSeconds),
    likeCount: 0,
    comments: [],
  };
  const stories = getActiveStories();
  stories.push(story);
  if (saveStories(stories)) {
    showMessage('Story added!', true);
  }
};

const renderStories = () => {
  const existingThumbs = storiesListEl.querySelectorAll('.story-thumb');
  existingThumbs.forEach((el) => el.remove());

  const stories = getActiveStories();
  stories.forEach((story, index) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'story-thumb';
    btn.setAttribute('aria-label', `View story ${index + 1}`);
    btn.dataset.index = String(index);

    const img = document.createElement('img');
    img.src = story.imageData;
    img.alt = '';
    btn.appendChild(img);

    btn.addEventListener('click', () => openStory(index));
    storiesListEl.appendChild(btn);
  });
};

const clearStoryTimer = () => {
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
  timerPaused = false;
  pausedElapsedMs = 0;
};

const getCurrentStory = () => storiesInViewer[currentIndex];

const updateActiveProgressFill = (progress01) => {
  const segments = progressContainer.querySelectorAll('.progress-segment');
  const active = segments[currentIndex];
  if (!active) return;
  const fill = active.querySelector('.progress-fill');
  if (fill) {
    fill.style.width = `${Math.min(100, progress01 * 100)}%`;
  }
};

const renderProgressBars = () => {
  progressContainer.innerHTML = '';
  storiesInViewer.forEach((_, index) => {
    const segment = document.createElement('div');
    segment.className = 'progress-segment';
    if (index < currentIndex) {
      segment.classList.add('is-done');
    }
    const fill = document.createElement('div');
    fill.className = 'progress-fill';
    if (index < currentIndex) {
      fill.style.width = '100%';
    }
    segment.appendChild(fill);
    progressContainer.appendChild(segment);
  });
};

const renderComments = (story) => {
  commentsList.innerHTML = '';
  const list = story.comments ?? [];
  commentEmpty.hidden = list.length > 0;

  for (const comment of list) {
    const li = document.createElement('li');
    const author = document.createElement('span');
    author.className = 'comment-author';
    author.textContent = `${comment.author}:`;
    const text = document.createElement('span');
    text.textContent = comment.text;
    li.appendChild(author);
    li.appendChild(text);
    commentsList.appendChild(li);
  }
};

const syncViewerUi = () => {
  const story = getCurrentStory();
  if (!story) return;

  storyImage.src = story.imageData;
  likeCountEl.textContent = String(story.likeCount ?? 0);
  renderProgressBars();
  renderComments(story);
};

const tickStoryTimer = () => {
  if (!viewerOpen || timerPaused) return;

  const story = getCurrentStory();
  if (!story) return;

  const durationMs = (story.durationSeconds ?? DEFAULT_DURATION_SEC) * 1000;
  const elapsed = pausedElapsedMs + (performance.now() - timerStartMs);
  const progress = elapsed / durationMs;
  updateActiveProgressFill(progress);

  if (elapsed >= durationMs) {
    nextStory();
    return;
  }

  animationFrameId = requestAnimationFrame(tickStoryTimer);
};

const startStoryTimer = () => {
  clearStoryTimer();
  timerStartMs = performance.now();
  pausedElapsedMs = 0;
  timerPaused = false;
  animationFrameId = requestAnimationFrame(tickStoryTimer);
};

const pauseStoryTimer = () => {
  if (!viewerOpen || timerPaused) return;
  timerPaused = true;
  pausedElapsedMs += performance.now() - timerStartMs;
  if (animationFrameId !== null) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
};

const resumeStoryTimer = () => {
  if (!viewerOpen || !timerPaused) return;
  timerPaused = false;
  timerStartMs = performance.now();
  animationFrameId = requestAnimationFrame(tickStoryTimer);
};

const goToStory = (index) => {
  if (index < 0 || index >= storiesInViewer.length) return;
  currentIndex = index;
  commentInput.value = '';
  syncViewerUi();
  startStoryTimer();
};

const nextStory = () => {
  if (currentIndex >= storiesInViewer.length - 1) {
    closeStory();
    return;
  }
  goToStory(currentIndex + 1);
};

const previousStory = () => {
  if (currentIndex <= 0) {
    goToStory(0);
    return;
  }
  goToStory(currentIndex - 1);
};

const openStory = (index) => {
  storiesInViewer = getActiveStories();
  if (storiesInViewer.length === 0) return;
  if (index < 0 || index >= storiesInViewer.length) return;

  viewerOpen = true;
  currentIndex = index;
  storyViewer.hidden = false;
  requestAnimationFrame(() => storyViewer.classList.add('is-open'));

  commentInput.value = '';
  syncViewerUi();
  startStoryTimer();
};

const closeStory = () => {
  clearStoryTimer();
  viewerOpen = false;
  storyViewer.classList.remove('is-open');
  storyImage.src = '';
  commentInput.value = '';
  setTimeout(() => {
    storyViewer.hidden = true;
  }, 250);
};

const updateStoryInStorage = (storyId, updater) => {
  const stories = getActiveStories();
  const idx = stories.findIndex((s) => s.id === storyId);
  if (idx === -1) return null;
  updater(stories[idx]);
  saveStories(stories);
  const inViewerIdx = storiesInViewer.findIndex((s) => s.id === storyId);
  if (inViewerIdx !== -1) {
    storiesInViewer[inViewerIdx] = { ...stories.find((s) => s.id === storyId) };
  }
  return stories[idx];
};

const handleLikeTap = () => {
  const story = getCurrentStory();
  if (!story) return;

  const updated = updateStoryInStorage(story.id, (s) => {
    s.likeCount = (s.likeCount ?? 0) + 1;
  });
  if (updated) {
    likeCountEl.textContent = String(updated.likeCount);
  }
};

const handleCommentSubmit = (event) => {
  event.preventDefault();
  const story = getCurrentStory();
  if (!story) return;

  const text = commentInput.value.trim();
  if (!text) return;
  if (text.length > MAX_COMMENT_LENGTH) {
    showMessage(`Comments are limited to ${MAX_COMMENT_LENGTH} characters.`);
    return;
  }

  const newComment = {
    id: createStoryId(),
    author: COMMENT_AUTHOR,
    text,
    createdAt: Date.now(),
  };

  updateStoryInStorage(story.id, (s) => {
    if (!Array.isArray(s.comments)) s.comments = [];
    s.comments.push(newComment);
  });

  const refreshed = getCurrentStory();
  if (refreshed) renderComments(refreshed);
  commentInput.value = '';
  resumeStoryTimer();
};

const handleImageUpload = async (event) => {
  const file = event.target.files?.[0];
  fileInput.value = '';
  if (!file) return;

  if (!validateImageFile(file)) {
    showMessage('Please choose a valid image file.');
    return;
  }

  const durationSeconds = clampDuration(durationInput.value);

  try {
    const imageData = await resizeImage(file);
    addStory(imageData, durationSeconds);
    renderStories();
  } catch {
    showMessage('Could not process that image. Try another file.');
  }
};

const handleAddClick = () => {
  uploadPanel.hidden = false;
  fileInput.click();
};

const handleSwipeEnd = (endX, endY) => {
  const diffX = endX - touchStartX;
  const diffY = endY - touchStartY;
  if (Math.abs(diffX) < SWIPE_THRESHOLD) return;
  if (Math.abs(diffY) > Math.abs(diffX)) return;

  if (diffX < 0) {
    nextStory();
  } else {
    previousStory();
  }
};

const init = () => {
  removeExpiredStories();
  renderStories();

  addStoryBtn.addEventListener('click', handleAddClick);
  fileInput.addEventListener('change', handleImageUpload);

  viewerClose.addEventListener('click', closeStory);
  tapPrev.addEventListener('click', previousStory);
  tapNext.addEventListener('click', nextStory);
  likeBtn.addEventListener('click', handleLikeTap);
  commentForm.addEventListener('submit', handleCommentSubmit);

  commentInput.addEventListener('focus', pauseStoryTimer);
  commentInput.addEventListener('blur', () => {
    if (document.activeElement !== commentInput) {
      resumeStoryTimer();
    }
  });

  storyViewer.addEventListener(
    'touchstart',
    (e) => {
      const touch = e.changedTouches[0];
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
    },
    { passive: true }
  );

  storyViewer.addEventListener(
    'touchend',
    (e) => {
      const touch = e.changedTouches[0];
      handleSwipeEnd(touch.clientX, touch.clientY);
    },
    { passive: true }
  );

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      removeExpiredStories();
      renderStories();
      if (viewerOpen) {
        storiesInViewer = getActiveStories();
        if (storiesInViewer.length === 0) {
          closeStory();
          return;
        }
        if (currentIndex >= storiesInViewer.length) {
          currentIndex = storiesInViewer.length - 1;
        }
        syncViewerUi();
        startStoryTimer();
      }
    }
  });

  storyViewer.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeStory();
  });
};

init();