// ==== drawing-time.js ====
// ==== TIME parsing/formatting and page-count helpers.
// ==== =============================================================

// Parses the TIME field. Accepts "S+F" (S seconds + F frames, e.g. "1+12"
// = 1 second 12 frames) or a bare number, which means whole seconds
// (unchanged from before, e.g. "3" = 3 seconds). Returns total seconds
// (may be fractional) for storage in state.timeSeconds.
function parseTimeInput(str) {
  str = (str || '').trim();
  if (!str) return 0;
  const m = str.match(/^(\d+(?:\.\d+)?)\s*\+\s*(\d+(?:\.\d+)?)$/);
  if (m) {
    const sec = parseFloat(m[1]) || 0;
    const frames = parseFloat(m[2]) || 0;
    return sec + frames / 24;
  }
  const n = parseFloat(str);
  return isNaN(n) || n < 0 ? 0 : n;
}

// Text to show in the sidebar's TIME value field: exactly what the user
// typed (e.g. "3", "12+8") while it still matches the parsed state.timeSeconds;
// otherwise (canvas drag of the red line, sheet-cell edit, import) a formatted
// "S+F", so the field is never stale.
function timeSidebarText() {
  const raw = state.timeSecondsRaw || '';
  if (raw && parseTimeInput(raw) === state.timeSeconds) return raw;
  return state.timeSeconds > 0 ? formatTimeDisplay(state.timeSeconds) : '';
}

// Formats stored seconds back into "S+F" for the on-canvas header display.
function formatTimeDisplay(seconds) {
  const totalFrames = Math.round(seconds * 24);
  const sec = Math.floor(totalFrames / 24);
  const frames = totalFrames % 24;
  return `${sec}+${frames}`;
}

// Total pages needed to cover the current TIME value (144 frames/page).
function totalPagesNeeded() {
  const totalFrames = Math.round((state.timeSeconds || 0) * 24);
  if (totalFrames <= 0) return 1;
  return Math.max(1, Math.ceil(totalFrames / (ROWS * 2)));
}

function clampCurrentPage() {
  const maxPage = totalPagesNeeded() - 1;
  if (state.currentPage > maxPage) state.currentPage = maxPage;
  if (state.currentPage < 0) state.currentPage = 0;
}
