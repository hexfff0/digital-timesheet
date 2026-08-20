// ==== state.js ====
// ==== Live app state, mark lookup helpers, and editing selection state.
// ==== =============================================================
// ---------------------------------------------------------------
// Live state, driven entirely by the side panel
// ---------------------------------------------------------------
const state = {
  showHeaderTable: true,
  // Red "/" slash marks under the end-of-time (TIME cutoff) line: a
  // warning-style hatch across the whole table width, one uniform angle,
  // 3 cells tall (toggle lives in the Header sidebar section).
  showEndSlash: true,
  sections: {
    ACTION: { visible: true, showHeader: true, showLetters: true, columns: 8 },
    SOUND: { visible: true, showHeader: true, columns: 1 }, // fixed, no letter row
    INBETWEEN: { visible: true, showHeader: true, showLetters: true, columns: 8 }, // mirrors ACTION
    CAMERA: { visible: true, showHeader: true, showLetters: true, columns: 3 }, // fixed, 1/2/3 as one row
  },
  // Keyframe/Breakdown marks placed on the ACTION grid.
  // key: `${blockId}_${col}_${row}` -> { type: 'keyframe'|'breakdown'|'plain', number: '1' }
  marks: {},
  // INBETWEEN's own marks, same key shape, only ever written by the
  // "Make In-Between" button (not directly click-editable).
  inbetweenMarks: {},
  // Whether Make In-Between carries the keyframe/breakdown SHAPE over
  // into the generated INBETWEEN numbers, or renders everything as plain
  // numbers regardless of the original ACTION symbol.
  inbetweenCarrySymbols: true,
  // "Book" markers: named layer-order notes attached to a vertical
  // divider line in ACTION (between/before/after its lettered columns),
  // drawn as a name in an oval/rectangle with a line pointing up at that
  // divider. Multiple books can share the same divider (stacked). Shape
  // and text direction are shared appearance settings for every book.
  // divider: 0 = before the first column, n = after the last column.
  books: [], // [{ divider, name }, ...] — multiple entries CAN share a divider
  bookStyle: { shape: 'none', vertical: false }, // 'oval' | 'rect' | 'none'
  // How overlapping Book stacks are untangled: 'branch' keeps labels
  // near their divider by branching left first / right second / raising
  // last; 'vertical' keeps every label on its own divider and raises
  // overlapping stacks above each other first, branching only when the
  // space above the grid runs out.
  bookLayoutStrategy: 'vertical',
  // Total shot duration in seconds (24 frames = 1 second). Determines how
  // far the LAST mark in every ACTION column auto-extends its line, and
  // how many pages the sheet needs (144 frames = 6 seconds per page).
  timeSeconds: 0,
  // The raw text the user typed for TIME in the sidebar (e.g. "3", "12+8").
  // Kept so the sidebar shows exactly what was typed instead of reformatting;
  // state.timeSeconds remains the numeric engine for page count / red line /
  // export. timeSidebarText() falls back to a formatted "S+F" when the raw
  // text no longer matches state.timeSeconds (canvas drag/sheet edit/import).
  timeSecondsRaw: '',
  // Where the circled KEYFRAME labels sit — 'side' = beside the guide
  // line at each keyframe's row (classic), 'vertical' = above the note's
  // head label / below its tail label (flipping to the other side of the
  // keyframe only when the preferred spot would cover the CAMERA section
  // header — never covered), 'dynamic' = vertical unless the label would
  // cover the CAMERA section header, another note's polygon, another
  // note's own rows, or another note's boundary label (notes touching or
  // one row apart), then side — so when two notes collide both boundary
  // labels move to the side. In dynamic, a middle keyframe's label always
  // shows beside the keyframe so it never sits on the note's own line.
  // The header is never covered; a shape that must be covered is the one
  // that gets covered. The red NAME label (PAN / OL / …) stays beside
  // the note's middle as always.
  // cameraLabelMode is the DEFAULT for pages without their own override;
  // cameraLabelModeByPage stores per-page overrides (keyed by 0-indexed
  // page number) set via the dropdown, so each page can have its own
  // placement.
  cameraLabelMode: 'side',
  cameraLabelModeByPage: {},
  // Custom display names, keyed by the BUILT-IN name. A missing/'' entry
  // means "use the built-in name". headerLabels renames the header-table's
  // label row (EPISODE/TITLE/…); sectionLabels renames each section's
  // header text (ACTION/SOUND/INBETWEEN/CAMERA) plus the MEMO box label.
  // Internally everything still keys off the built-in names, so renaming
  // never breaks behavior (e.g. PAGE stays auto-computed, TIME stays
  // numeric).
  headerLabels: {},
  sectionLabels: {},
  // Per-column letter/number overrides keyed 'SECTION:index', e.g.
  // 'CAMERA:0': 'Cam A' or 'ACTION:2': 'C'. Missing = built-in A/B/C…
  // (ACTION/INBETWEEN) or 1/2/3 (CAMERA).
  columnLabels: {},
  // Free-text values for the header-table cells. TIME is NOT stored here —
  // it stays numeric (in timeSeconds above), with its raw typed text kept in
  // timeSecondsRaw; the sidebar renders it as a normal row either way.
  // Keyed by the cell's label, e.g. headerValues['EPISODE'].
  headerValues: { EPISODE: '', TITLE: '', 'CUT / SCENE': '', ANIMATOR: '', PAGE: '', COMPOSITOR: '' },
  // 0-indexed page currently shown/edited. Each page holds 2 blocks x 72
  // rows = 144 frames = 6 seconds.
  currentPage: 0,
  // ---------------------------------------------------------------
  // Customize-mode layout overrides. Every value is either an explicit
  // override (same px units as the base constants) or null/0, meaning
  // "use the computed default". Widths compose left-to-right in a plain
  // flow (each item's un-nudged position is still based on the sizes
  // before it), then an X/Y "offset" nudges that item freely without
  // affecting where its siblings start.
  //   level 0 - scaleX/scaleY + wholeOffset: whole table (both blocks),
  //                       width and height scale INDEPENDENTLY + move
  //   level 1 - blockW + blockOffset: one block's width + free move
  //   level 2 - sectionW + sectionOffset: one section's width + move (x)
  //   level 3 - headerH + headerOffset: one block's shared header-band
  //                       height (kept common across its sections so
  //                       frame rows stay aligned) + move (y)
  //   level 4 - titleSplit: title-bar vs letter-row split, PER section
  // ---------------------------------------------------------------
  layout: {
    scaleX: 1,
    scaleY: 1,
    wholeOffset: { x: 0, y: 0 },
    blockW: { 0: null, 1: null },
    blockOffset: { 0: { x: 0, y: 0 }, 1: { x: 0, y: 0 } },
    sectionW: {},
    sectionOffset: {},
    headerH: { 0: null, 1: null },
    headerOffset: { 0: 0, 1: 0 },
    titleSplit: {}
  },
  // Move/resize overrides for the top EPISODE/TITLE/.../COMPOSITOR table.
  // colW is either null (defaults) or an array of 7 width overrides.
  titleTable: { x: null, y: null, w: null, h: null, colW: null },
  // Free text memo box that sits between the header table and the main
  // grid. Position/size are overrides (px, null = default); move/resize
  // it in Customize mode, click it in normal mode to type.
  memo: { text: '', x: null, y: null, w: null, h: null, showLabel: true, showBorder: true },
  // Whole-table opacity (0..1): the white sheet fill, grid lines, and text
  // all draw at this alpha, so an imported paper image underneath shows
  // through. 1 = fully opaque (the default look).
  tableOpacity: 1,
  // External company-paper image laid under the sheet, one shared box drawn
  // under EVERY page. x/y/w/h are in canvas px relative to the page origin;
  // dataUrl is a downscaled PNG/JPG data URL (≤ PAGE_W wide).
  paper: { dataUrl: null, x: 0, y: 0, w: 0, h: 0, visible: false },
  // Dialogue lines typed into the SOUND column (its frame grid stays
  // invisible). Each entry spans a frame range inside one block of one
  // page, and its text is drawn vertically down the narrow column.
  // speaker is the speaker's name; type is an optional dialogue marker
  // (SE/M/OFF/ME/N/T/ON/背/ノンモン/独) drawn in red above the speaker
  // box at the first frame (auto-sheet convention). `lane` is optional:
  // overlapping entries auto-split into side-by-side lanes, but a lane
  // the user dragged an entry to manually is honored (clearing it back
  // to null/undefined restores auto-assignment).
  //   { id, page, blockId, gFrom, gTo, speaker, type, text, lane? }
  dialogue: [],
  // Camera notes are KEYFRAME CHAINS, one note per lane region (a note
  // keeps its lane when edited — overlapping notes in the same lane are
  // staggered sideways instead of being moved to another lane; only a
  // manual drag moves it across). Each entry carries a sorted `keyframes`
  // array of { frame, label } — frame is the global frame number, label
  // the circled keyframe name (auto A/B/C…, freely editable). The
  // INTERPOLATION between two consecutive keyframes is the camera type
  // and rides on the START keyframe as { type, name, cam?, aFrame? }:
  // type picks how the segment is drawn (PAN/Follow/TU/TB/QTU/QTB =
  // straight line = linear, FI/FO/WI/WO/フォーカスイン/フォーカスアウト =
  // wedge, OL = hourglass, ハンディぶれ = zigzag; any free directive
  // draws a plain line), name is the label printed at the segment's
  // middle (defaults to the type, freely editable), cam holds the raw
  // XDTS coordinates captured from that keyframe's data frame (written
  // back verbatim on export, never shown), aFrame is the QTU/QTB ア
  // position. The LAST keyframe of a note has no outgoing segment (no
  // type). `auto` marks an auto-assigned label (A/B/C… renumbered by
  // frame position on structural edits); custom labels drop it. Old flat
  // entries ({gFrom,gTo,type,name,labelStart,labelEnd}) are migrated to
  // this shape on startup / JSON import.
  //   { id, page, blockId, lane, keyframes: [{ frame, label, auto?, type?, name?, cam?, aFrame? }, ...] }
  camera: [],
  // Freehand annotations drawn with the Pen tool over the sheet. Plain
  // JSON-serializable objects (ready for the future save system): each
  // stroke belongs to one sheet page and stores its polyline in canvas
  // coordinates, so zoom/pan keeps the ink glued to the sheet. color and
  // width are the pen settings at draw time.
  //   { id, page, points: [[x, y], ...], color, width }
  ink: [],
  // Active annotation tool: 'select' (default editing), 'pen', 'eraser'.
  activeTool: 'select',
  // Pen settings used for new strokes (top-bar controls).
  inkColor: '#e53935',
  inkWidth: 2
};

// Dialogue speaker suffix types (auto-sheet set): drawn as a red "(SE)"
// tag above the speaker box. Empty string = no tag.
const DIALOGUE_TYPES = ['', 'SE', 'M', 'OFF', 'ME', 'N', 'T', 'ON', '背', 'ノンモン', '独'];
// Camera note types offered in the creation popup — the camera-symbol
// set from the manual (PAN with arrowheads at both ends, Follow drawn
// the same way with a different name, TU/TB truck arrows with their
// QTU/QTB quick variants, FI/FO fade wedges, OL overlap diamond, and
// ハンディぶれ handheld shake as a zigzag line). Any other text is
// accepted as a custom type and draws as a plain line + label.
const CAMERA_TYPES = ['PAN', 'Follow', 'TU', 'TB', 'QTU', 'QTB', 'FI', 'FO', 'WI', 'WO', 'フォーカスイン', 'フォーカスアウト', 'OL', 'ハンディぶれ'];

// Optional human-readable suffix shown next to a type in the creation
// popup's dropdown (which is generated from CAMERA_TYPES). A type without
// an entry just shows its own name.
const CAMERA_TYPE_HINTS = {
  FI: 'fade-in',
  FO: 'fade-out',
  WI: 'ホワイトイン',
  WO: 'ホワイトアウト',
  OL: 'overlap',
  'ハンディぶれ': '(handheld)',
};

// The polygon camera shapes, driven by ONE config table so a new shape
// type is a single line here: `shape` picks the geometry (wedge-in /
// wedge-out / hourglass) and `fill` whether it is filled blue or drawn
// as a bare outline. WI/WO (ホワイトイン/ホワイトアウト) share FI/FO's
// wedges but render outline-only; OL is the overlap hourglass.
const CAMERA_SHAPES = {
  FI: { shape: 'wedge-in', fill: true },
  FO: { shape: 'wedge-out', fill: true },
  WI: { shape: 'wedge-in', fill: false },
  WO: { shape: 'wedge-out', fill: false },
  'フォーカスイン': { shape: 'wedge-in', fill: true },
  'フォーカスアウト': { shape: 'wedge-out', fill: true },
  OL: { shape: 'hourglass', fill: true },
};

// Display-name helpers: resolve a custom name (''/missing = built-in).
function headerDisplayName(label) { return (state.headerLabels && state.headerLabels[label]) || label; }
function sectionDisplayName(name) { return (state.sectionLabels && state.sectionLabels[name]) || name; }
function columnDisplayLabel(section, c) { return (state.columnLabels && state.columnLabels[section + ':' + c]) || null; }

// True if a camera type is one of the special polygon shapes (see
// CAMERA_SHAPES above).
function isCameraShapeType(type) {
  return Object.prototype.hasOwnProperty.call(CAMERA_SHAPES, String(type || '').trim().toUpperCase());
}

// First/last global frame of a camera note (convenience over its sorted
// keyframe chain).
function camFrom(e) { return e.keyframes[0].frame; }
function camTo(e) { return e.keyframes[e.keyframes.length - 1].frame; }

// Auto label sequence for keyframes: A, B, C, …, Z, AA, BB, CC, …
// (each letter doubled once the single letters run out).
function labelAt(i) {
  const n = Math.max(0, i);
  return String.fromCharCode(65 + (n % 26)).repeat(Math.floor(n / 26) + 1);
}

// Re-numbers AUTO keyframe labels across ALL of the current page's camera
// notes in reading order (left to right by lane, top to bottom by start
// frame) — A, B, C, …, Z, AA, BB, CC… — so labels are unique and
// sequential across notes, not just within one chain. Custom labels
// (auto === false) keep their names and the sequence skips letters they
// use. Call after any add/remove/move that changes a note's keyframes.
function renumberCameraLabelsPage() {
  const page = state.currentPage;
  const pageStart = page * ROWS * 2;
  const notes = state.camera
    .filter(e => camFrom(e) >= pageStart + 1 && camFrom(e) <= pageStart + ROWS * 2)
    .sort((a, b) => (a.lane || 0) - (b.lane || 0) || camFrom(a) - camFrom(b));
  const used = new Set();
  notes.forEach(n => {
    n.keyframes.sort((a, b) => a.frame - b.frame);
    n.keyframes.forEach(kf => { if (kf.auto === false && kf.label) used.add(kf.label); });
  });
  let seq = 0;
  notes.forEach(n => {
    n.keyframes.forEach(kf => {
      if (kf.auto === false) return;
      let label = labelAt(seq);
      while (used.has(label)) label = labelAt(++seq);
      kf.label = label;
      used.add(label);
      seq++;
    });
  });
}

// Converts old flat camera entries ({gFrom, gTo, type, name,
// labelStart, labelEnd, aFrame, cam}) to the keyframe-chain shape.
// Idempotent — runs at startup and after JSON/extension imports so old
// saves keep working. The type/name/cam/aFrame land on the first
// keyframe (the segment A→B's start), matching the new semantics.
// Default labels (A/B) are marked auto so they renumber with the chain;
// renamed endpoint names are kept as custom labels.
function migrateCameraEntries() {
  state.camera.forEach((e, idx) => {
    if (!e || Array.isArray(e.keyframes)) return;
    const kfs = [
      { frame: e.gFrom, label: (e.labelStart || 'A'), auto: !(e.labelStart && e.labelStart !== 'A') },
      { frame: e.gTo, label: (e.labelEnd || 'B'), auto: !(e.labelEnd && e.labelEnd !== 'B') }
    ];
    if (e.type != null) kfs[0].type = e.type;
    if (e.name != null) kfs[0].name = e.name;
    if (e.cam) kfs[0].cam = e.cam;
    if (e.aFrame != null) kfs[0].aFrame = e.aFrame;
    state.camera[idx] = { id: e.id, page: e.page, blockId: e.blockId, lane: e.lane, keyframes: kfs };
  });
}
migrateCameraEntries();

// Older saves stored the side placement as 'horizontal' (before it was
// renamed to 'side', matching the dropdown's "Side"). Normalize both the
// global default and every per-page override so old JSON/XDTS files load
// identically.
function normalizeCameraLabelMode(v) {
  return v === 'horizontal' ? 'side' : v;
}
function migrateLabelPlacementValues() {
  state.cameraLabelMode = normalizeCameraLabelMode(state.cameraLabelMode);
  if (state.cameraLabelModeByPage) {
    Object.keys(state.cameraLabelModeByPage).forEach(k => {
      state.cameraLabelModeByPage[k] = normalizeCameraLabelMode(state.cameraLabelModeByPage[k]);
    });
  }
}

// Monotonic id source for dialogue/camera entries.
let trackSeq = 1;
function nextTrackId() { return trackSeq++; }

function markKey(page, blockId, col, row) { return page + '_' + blockId + '_' + col + '_' + row; }

// Currently selected ACTION cell ({page, blockId, col, row} or null) and
// its live-typed number buffer (null = not being edited this selection,
// '' = cleared, otherwise the digits typed so far).
let selectedCell = null;
let editingBuffer = null;
// Extra cells selected alongside the anchor — Ctrl/Cmd+click toggles
// cells in/out, Shift+click fills the rectangle between the anchor and
// the clicked cell. Typing / deleting / symbol changes apply to every
// selected cell; the anchor is the one that keeps the typing buffer.
let selectedExtra = [];

function cellKey(cell) { return markKey(cell.page, cell.blockId, cell.col, cell.row); }

// True when the given cell is part of the current selection (the anchor
// or any Ctrl/Shift-added extra cell).
function isCellSelected(page, blockId, col, row) {
  if (selectedCell && selectedCell.page === page && selectedCell.blockId === blockId &&
    selectedCell.col === col && selectedCell.row === row) return true;
  return selectedExtra.some(c => c.page === page && c.blockId === blockId && c.col === col && c.row === row);
}

// Anchor + extras, deduped — the cells every action applies to (typing,
// symbol changes, deletion).
function selectedCellList() {
  const list = [];
  if (selectedCell) list.push(selectedCell);
  for (const c of selectedExtra) {
    if (!list.some(x => cellKey(x) === cellKey(c))) list.push(c);
  }
  return list;
}

// Bounding rectangle of the current selection (anchor + extras). All
// selected cells share one page/block by construction — the basis for the
// Excel-style fill handle, which sits at its bottom-right corner.
function selectionRect() {
  if (!selectedCell) return null;
  let loC = selectedCell.col, hiC = selectedCell.col;
  let loR = selectedCell.row, hiR = selectedCell.row;
  for (const c of selectedExtra) {
    loC = Math.min(loC, c.col); hiC = Math.max(hiC, c.col);
    loR = Math.min(loR, c.row); hiR = Math.max(hiR, c.row);
  }
  return { page: selectedCell.page, blockId: selectedCell.blockId, loC, hiC, loR, hiR };
}

// Returns what should actually be drawn for a given ACTION cell, taking
// any in-progress typing on the selected cells into account.
function getMarkForDisplay(page, blockId, col, row) {
  const key = markKey(page, blockId, col, row);
  const stored = state.marks[key];
  const isSelected = isCellSelected(page, blockId, col, row);
  if (isSelected && editingBuffer !== null) {
    if (editingBuffer === '') return null;
    const bufLower = editingBuffer.toLowerCase();
    if (bufLower === 'x') return { type: 'x', number: '' };
    if (editingBuffer === '.') return { type: '.', number: '' };
    if (bufLower === 'r') return { type: 'repeat', number: '' };
    if (bufLower === 's') return { type: 'stop', number: '' };
    return { type: stored ? stored.type : 'plain', number: editingBuffer };
  }
  return stored || null;
}

// Same as getMarkForDisplay, but the very first frame of the whole shot
// (page 0, block 0, row 1) automatically shows "x" (no image) once the
// user has entered at least one real mark anywhere in that column.
function getEffectiveMark(page, blockId, col, row) {
  const m = getMarkForDisplay(page, blockId, col, row);
  if (m) return m;
  if (page === 0 && blockId === 0 && row === 1 && columnHasAnyRealMark(col)) {
    return { type: 'x', number: '' };
  }
  return null;
}

// True if the column has at least one real, user-entered mark anywhere
// across every reachable page/block (used to gate the auto-x above).
function columnHasAnyRealMark(col) {
  const pages = totalPagesNeeded();
  for (let p = 0; p < pages; p++) {
    for (let b = 0; b < 2; b++) {
      for (let r = 1; r <= ROWS; r++) {
        if (getMarkForDisplay(p, b, col, r)) return true;
      }
    }
  }
  return false;
}
