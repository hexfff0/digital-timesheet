// ==== layout.js ====
// ==== Canvas primitives, layout-geometry resolution, and shared interaction state.
// ==== =============================================================
// where integer G is the boundary between frame G and G+1, and G-0.5 is
// the center of frame G) that falls within one block's local 72-row
// span [domainLo, domainHi]. This is what lets a hold that starts in one
// block/page and ends in a later one look like one uninterrupted line,
// even though each block is drawn separately.
function clipAndDrawSegment(cx, s, e, domainLo, domainHi, letterBot) {
  const cs = Math.max(s, domainLo), ce = Math.min(e, domainHi);
  if (cs >= ce) return;
  const y0 = letterBot + (cs - domainLo) * getRowH();
  const y1 = letterBot + (ce - domainLo) * getRowH();
  line(cx, y0, cx, y1, LW_NORMAL);
}

function line(x0, y0, x1, y1, w) {
  ctx.lineWidth = w;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

function rect(x, y, w, h, lw) {
  ctx.lineWidth = lw;
  ctx.strokeRect(x, y, w, h);
}

function text(str, x, y, size, opts) {
  opts = opts || {};
  const weight = opts.bold ? 'bold' : 'normal';
  ctx.font = `${weight} ${size}px Arial, Helvetica, sans-serif`;
  ctx.textAlign = opts.align || 'center';
  ctx.fillText(str, x, y);
}

function alphaLabels(n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(String.fromCharCode(65 + (i % 26)));
  return out;
}

function numericLabels(n) {
  const out = [];
  for (let i = 1; i <= n; i++) out.push(String(i));
  return out;
}

// ---------------------------------------------------------------
// Layout customization: resolves the overrides in state.layout into
// actual pixel geometry. Everything composes left-to-right / top-to-
// bottom in a plain flow, so growing one part simply pushes later parts
// along rather than ever overlapping them.
// ---------------------------------------------------------------
function getScaleX() { return state.layout.scaleX || 1; }
function getScaleY() { return state.layout.scaleY || 1; }

// ---------------------------------------------------------------
// Multi-page view grid: pages flow two per row (Word-style), each full
// sheet spaced PAGE_GAP px apart, filling rows top-to-bottom, left-to-
// right. A PAGE_GAP strip is reserved along the TOP of the canvas too,
// so every sheet has room for its "Page N" badge to float in the gap
// ABOVE the paper (badges never sit on the sheet itself). Page i sits
// at multiPagePos(i); multiTotalSize gives the whole stack's canvas
// size (used to size the canvas and to fit-scale it).
// ---------------------------------------------------------------
const MULTI_PER_ROW = 2;
const PAGE_GAP = 48; // px between stacked sheets in the all-pages view
function multiPagePos(page) {
  const col = page % MULTI_PER_ROW;
  const row = Math.floor(page / MULTI_PER_ROW);
  return { x: col * (PAGE_W + PAGE_GAP), y: PAGE_GAP + row * (PAGE_H + PAGE_GAP) };
}
function multiTotalSize(pages) {
  const rows = Math.ceil(pages / MULTI_PER_ROW);
  return {
    w: MULTI_PER_ROW * PAGE_W + (MULTI_PER_ROW - 1) * PAGE_GAP,
    h: PAGE_GAP + rows * PAGE_H + (rows - 1) * PAGE_GAP,
    rows
  };
}

function getBlockBaseWidth(blockId) {
  const ov = state.layout.blockW[blockId];
  return ov != null ? ov : BLOCK_W;
}

// Resolved, ALREADY-SCALED section widths for one block, visible sections
// only, in fixed left-to-right order.
function getSectionWidths(blockId) {
  const visibleNames = SECTION_ORDER.filter(n => state.sections[n].visible);
  const totalBaseWidth = visibleNames.reduce((s, n) => s + BASE_WIDTHS[n], 0);
  const blockBase = getBlockBaseWidth(blockId);
  return visibleNames.map(name => {
    const proportional = totalBaseWidth > 0 ? (BASE_WIDTHS[name] / totalBaseWidth) * blockBase : 0;
    const ov = state.layout.sectionW[blockId + ':' + name];
    const base = ov != null ? ov : proportional;
    return { name, width: base * getScaleX() };
  });
}

function getBlockWidth(blockId) {
  return getSectionWidths(blockId).reduce((s, w) => s + w.width, 0);
}

function getBlockX(blockId) {
  const base = blockId === 0 ? BLOCK1_X : BLOCK1_X + getBlockWidth(0) + NUMCOL_W;
  return base + state.layout.wholeOffset.x + state.layout.blockOffset[blockId].x;
}

// This block's header band (GRID_TOP..LETTER_BOT) as absolute Y positions.
function getHeaderBand(GRID_TOP, blockId) {
  const ov = state.layout.headerH[blockId];
  const height = (ov != null ? ov : (LETTER_BOT_BASE - GRID_TOP_BASE)) * getScaleY();
  const top = GRID_TOP + state.layout.wholeOffset.y + state.layout.blockOffset[blockId].y + state.layout.headerOffset[blockId];
  return { top, bottom: top + height };
}

// Where the title-bar/letter-row divider sits for one SECTION, as an
// absolute Y — a fraction of that section's block's shared header band.
function getTitleSplitY(blockId, name, band) {
  const key = blockId + ':' + name;
  const ov = state.layout.titleSplit[key];
  const baseFrac = (TITLE_BOT_BASE - GRID_TOP_BASE) / (LETTER_BOT_BASE - GRID_TOP_BASE);
  const frac = ov != null ? ov : baseFrac;
  return band.top + (band.bottom - band.top) * frac;
}

// Resolves the top EPISODE/TITLE/.../COMPOSITOR table's geometry,
// including any move/resize overrides from state.titleTable. xOff/yOff
// (a multi-page view page offset) are added to every coordinate.
function getHeaderTableGeometry(xOff, yOff) {
  const ov = state.titleTable;
  const x0 = (ov.x != null ? ov.x : HDR_COLS[0]) + (xOff || 0);
  const y0 = (ov.y != null ? ov.y : HDR_TOP) + (yOff || 0);
  const totalBaseW = HDR_COLS[HDR_COLS.length - 1] - HDR_COLS[0];
  const totalBaseH = HDR_BOT - HDR_TOP;
  const w = ov.w != null ? ov.w : totalBaseW;
  const h = ov.h != null ? ov.h : totalBaseH;

  let colWidths;
  if (ov.colW) {
    colWidths = ov.colW.slice();
  } else {
    const baseWidths = [];
    for (let i = 0; i < HDR_COLS.length - 1; i++) baseWidths.push(HDR_COLS[i + 1] - HDR_COLS[i]);
    const sumBase = baseWidths.reduce((a, b) => a + b, 0);
    colWidths = baseWidths.map(bw => (bw / sumBase) * w);
  }

  const colXs = [x0];
  let acc = x0;
  for (const cw of colWidths) { acc += cw; colXs.push(acc); }

  const midFrac = (HDR_MID - HDR_TOP) / (HDR_BOT - HDR_TOP);
  return { x0, y0, x1: acc, y1: y0 + h, colXs, yMid: y0 + h * midFrac };
}

// Resolves the free-text memo box's geometry (position/size overrides in
// state.memo, or sensible defaults sitting in the gap between the header
// table and the main grid). xOff/yOff (a multi-page view page offset)
// are added to every coordinate.
function getMemoGeometry(xOff, yOff) {
  const m = state.memo;
  // defaults pin the memo to the title table's box (position + width) so the
  // memo always sits directly under the title — moving the title carries it
  const hdg = getHeaderTableGeometry();
  const x0 = (m.x != null ? m.x : hdg.x0) + (xOff || 0);
  const y0 = (m.y != null ? m.y : hdg.y1 + 25) + (yOff || 0);
  const w = m.w != null ? m.w : (hdg.x1 - hdg.x0);
  const h = m.h != null ? m.h : 110;
  return { x0, y0, x1: x0 + w, y1: y0 + h };
}

// Word-wraps text (respecting explicit \n breaks) to fit within maxWidth,
// using the canvas's current font. Returns an array of lines.
function wrapMemoText(str, maxWidth) {
  const lines = [];
  const paragraphs = str.split('\n');
  for (const para of paragraphs) {
    if (para === '') { lines.push(''); continue; }
    const words = para.split(' ');
    let cur = '';
    for (const word of words) {
      const test = cur ? cur + ' ' + word : word;
      if (ctx.measureText(test).width > maxWidth && cur) {
        lines.push(cur);
        cur = word;
      } else {
        cur = test;
      }
    }
    if (cur) lines.push(cur);
  }
  return lines;
}

function defaultSectionWidthPreScale(blockId, name) {
  const visibleNames = SECTION_ORDER.filter(n => state.sections[n].visible);
  const totalBaseWidth = visibleNames.reduce((s, n) => s + BASE_WIDTHS[n], 0);
  const blockBase = getBlockBaseWidth(blockId);
  return totalBaseWidth > 0 ? (BASE_WIDTHS[name] / totalBaseWidth) * blockBase : 0;
}

// Current override value (or computed default) in PRE-scale px units, for
// the currently selected layout level — this is the unit that overrides
// are actually stored in (drawing multiplies by getScaleX()/getScaleY() at the end).
function getCurrentValuePreScale(level) {
  if (!layoutSelection) return null;
  if (level === 1) {
    const ov = state.layout.blockW[layoutSelection.blockId];
    return ov != null ? ov : BLOCK_W;
  }
  if (level === 2) {
    const key = layoutSelection.blockId + ':' + layoutSelection.name;
    const ov = state.layout.sectionW[key];
    return ov != null ? ov : defaultSectionWidthPreScale(layoutSelection.blockId, layoutSelection.name);
  }
  if (level === 3) {
    const ov = state.layout.headerH[layoutSelection.blockId];
    return ov != null ? ov : (LETTER_BOT_BASE - GRID_TOP_BASE);
  }
  return null;
}

function buildSections(blockId) {
  // returns only the visible sections, in fixed order, with resolved widths.
  // `subLabels` is always the full physical set of sub-columns for that
  // section (the real table structure never changes based on label toggles).
  const widths = getSectionWidths(blockId); // [{name, width}, ...] already scaled

  return widths.map(({ name, width }) => {
    const s = state.sections[name];
    let subLabels;
    if (name === 'SOUND') subLabels = [''];
    else if (name === 'CAMERA') subLabels = numericLabels(s.columns);
    else subLabels = alphaLabels(s.columns);
    // custom per-column names (state.columnLabels) override the built-in
    // letters/numbers
    subLabels = subLabels.map((l, c) => columnDisplayLabel(name, c) || l);
    return { name, width, subLabels, showHeader: s.showHeader, showLetters: s.showLetters };
  });
}

// Clickable ACTION-column regions, rebuilt every render() so click
// hit-testing always matches whatever is currently on screen.
let actionHitRegions = [];
// Clickable regions for ALL header-table cells (EPISODE/TITLE/.../
// COMPOSITOR), rebuilt every render(). TIME is index-aware (its label is
// 'TIME') and keeps its numeric S+F editing; the rest are free text.
let headerCellRegions = [];
// Section-header name regions (ACTION/SOUND/INBETWEEN/CAMERA) and
// per-column letter/number label regions (A/B/C…, 1/2/3…), rebuilt every
// render() — clicking them edits the display name on the sheet.
let sectionNameRegions = [];
let colLabelRegions = [];
let editingHeaderIndex = null; // 0-6, or null
let headerEditBuffer = null; // null = not yet typed this session (shows stored value)
// Header-table LABEL renaming (like section/column names): the top half of
// each header cell above the values, click-to-rename with headerLabels.
// Per-column regions rebuilt every render(), same as sectionNameRegions.
let headerLabelRegions = [];
let editingHeaderLabel = null; // 0-6, or null
let headerLabelBuffer = null;
// Memo box (between header table and grid): click-to-type in normal mode.
// One region per drawn page copy (the memo is one shared value; clicking
// any copy starts editing it), rebuilt every render().
let memoHitRegions = [];
let editingMemo = false;
let memoEditBuffer = null;
// The page copy whose memo box the overlay editor sits on (multi view has
// one memo per page copy; the memo value itself is shared).
let memoEditPage = 0;
// "Book" divider markers in ACTION: rebuilt every render(), one entry per
// divider line (0..columns) per block, for right-click hit-testing.
let bookHitRegions = [];
// SOUND column (invisible frame grid): one region per block covering the
// whole column below the letter row, for click/drag to type dialogue.
let soundAreaRegions = [];
// Existing dialogue entries in the SOUND column: { entry, blockId, x0, x1, y0, y1 }.
let soundEntryRegions = [];
// CAMERA section: one region per block covering its whole grid, for
// click/drag to add camera notes (lane is picked from the x position).
let cameraAreaRegions = [];
// Existing camera notes: { entry, blockId, x0, x1, y0, y1 } (x0/x1 are the
// note's own lane x-range, possibly staggered).
let cameraSegRegions = [];
// Middle keyframe markers (diamonds) of camera notes — draggable to move
// that keyframe's frame: { entry, blockId, kfIndex, x, y, r }.
let cameraKeyRegions = [];
// The circled ア marker of QTU/QTB camera notes (draggable to move the
// animation-start position): { entry, blockId, x, y, r }.
let cameraAruRegions = [];

// Formats a global frame number (1-indexed) as "S+F" (seconds + frames),
// matching the TIME field's display, e.g. global frame 37 = 1+12.
function formatGlobalFrame(g) {
  const total = Math.max(0, (g || 1) - 1);
  const sec = Math.floor(total / 24);
  const frames = total % 24;
  return `${sec}+${frames}`;
}

// Parses a timecode in the TIME field's format — "S+F" (seconds + frames)
// or a bare number meaning whole seconds — into a 1-indexed global frame
// number. Returns null for invalid/empty input.
function parseGlobalFrame(str) {
  const s = String(str || '').trim();
  if (!s) return null;
  const m = s.match(/^(\d+(?:\.\d+)?)\s*\+\s*(\d+(?:\.\d+)?)$/);
  let total;
  if (m) {
    total = (parseFloat(m[1]) || 0) * 24 + (parseFloat(m[2]) || 0);
  } else {
    const n = parseFloat(s);
    if (isNaN(n) || n < 0) return null;
    total = n * 24;
  }
  return Math.max(1, Math.round(total) + 1);
}

// ---------------------------------------------------------------
// Customize (layout resize) mode
// ---------------------------------------------------------------
let customizeMode = false;
// { level: 0-4, blockId, name } for the grid hierarchy, or
// { level: 'titleWhole' } / { level: 'titleCell', cell } for the title table.
let layoutSelection = null;
// Rebuilt every render() while customizeMode is on: [{level, blockId, name, x0,y0,x1,y1}, ...]
let layoutHitRegions = [];
// Active edge/handle drag in progress (layout resize), or null.
let dragState = null;
// Mousedown landed on a "move" (body-drag) zone but hasn't moved past the
// threshold yet — lets a plain click still drill down instead of moving.
let pendingMove = null;
// When on, editing block 0's layout mirrors the same values onto block 1
// (and vice versa) — sections, header height, and the title/letter split
// all mirror together.
let syncBlocks = false;

