// ==== edit.js ====
// ==== Cell editing, shape menu, and Book divider menu.
// ==== =============================================================

// ---------------------------------------------------------------
// Keyframe / Breakdown entry
// Left-click an ACTION cell -> selects it (highlight) and lets you type
// digits directly on the canvas (no popup). Enter confirms, Backspace
// edits, Escape cancels. Right-click a cell -> opens a small menu to pick
// the enclosing shape (Keyframe / Breakdown / plain) or delete it.
// The TIME box in the header table works the same way (click, type
// digits/+, Enter/Escape) and stays in sync with the sidebar TIME field.
// ---------------------------------------------------------------
const shapeMenu = document.getElementById('shapeMenu');
let shapeMenuTarget = null; // { page, blockId, col, row }

function canvasPointFromEvent(e) {
  const rect = canvas.getBoundingClientRect();
  // renderScale (1 in single view) maps the canvas's own pixels back to
  // the base 1754x2480-per-page units that all hit regions live in
  return {
    x: (e.clientX - rect.left) * (canvas.width / rect.width) / (renderScale || 1),
    y: (e.clientY - rect.top) * (canvas.height / rect.height) / (renderScale || 1)
  };
}

function findActionCell(x, y) {
  for (const region of actionHitRegions) {
    const width = region.colW * region.n;
    if (x < region.x0 || x >= region.x0 + width) continue;
    if (y < region.letterBot) continue;
    const row = Math.floor((y - region.letterBot) / region.rowH) + 1;
    if (row < 1 || row > ROWS) continue;
    const col = Math.min(region.n - 1, Math.floor((x - region.x0) / region.colW));
    return { page: region.page, blockId: region.blockId, col, row };
  }
  return null;
}

function findHeaderCellAt(x, y) {
  return headerCellRegions.find(r => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1) || null;
}
function findHeaderLabelAt(x, y) {
  return headerLabelRegions.find(r => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1) || null;
}

// Hit-tests a section-header name on the sheet (ACTION/SOUND/…/CAMERA),
// and a per-column letter/number label (A/B/C… or 1/2/3…). Clicking them
// edits the display name directly on the sheet, like header values.
function findSectionNameAt(x, y) {
  return sectionNameRegions.find(r => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1) || null;
}
function findColLabelAt(x, y) {
  return colLabelRegions.find(r => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1) || null;
}

// Hit-tests the red end-of-time (TIME cutoff) line. Returns the block
// (and page, for multi-page view) it sits in, or null. TIME spans the
// whole shot, so the line is only visible on the page whose frame range
// actually contains the cutoff frame.
function findTimeLineAt(x, y) {
  if (!state.timeSeconds) return null;
  const cutoffG = Math.round(state.timeSeconds * 24);
  const shift = state.showHeaderTable ? 0 : (HDR_BOT - HDR_TOP);
  const TOL = 22;
  const pages = totalPagesNeeded();
  const multi = viewMode === 'multi' && pages > 1;
  const pageCount = multi ? pages : 1;
  for (let p = 0; p < pageCount; p++) {
    const page = multi ? p : state.currentPage;
    const pos = multi ? multiPagePos(p) : { x: 0, y: 0 };
    const GRID_TOP = GRID_TOP_BASE - shift + pos.y;
    const pageStart = page * ROWS * 2;
    for (let blockId = 0; blockId < 2; blockId++) {
      const band = getHeaderBand(GRID_TOP, blockId);
      const LETTER_BOT = band.bottom;
      const x0 = getBlockX(blockId) + pos.x;
      const x1 = x0 + getBlockWidth(blockId);
      const domainLo = pageStart + (blockId === 0 ? 0 : ROWS);
      const domainHi = domainLo + ROWS;
      if (cutoffG > domainLo && cutoffG <= domainHi) {
        const lineY = LETTER_BOT + (cutoffG - domainLo) * getRowH();
        if (x >= x0 - 10 && x <= x1 + 10 && Math.abs(lineY - y) <= TOL) {
          return { blockId, page };
        }
      }
    }
  }
  return null;
}

// Commits whatever was typed on the currently selected cell (if anything
// changed) into state.marks, then clears the editing buffer. A buffer of
// exactly "x"/"X" becomes "no image"; "." becomes the in-between dot;
// "r"/"R" becomes リピート (repeat); "s"/"S" becomes 止め (stop/hold);
// anything else is stored as a plain number.
function commitEditingIfAny() {
  if (!selectedCell || editingBuffer === null) return;
  const buf = editingBuffer;
  const bufLower = buf.toLowerCase();
  // applies the typed buffer to EVERY selected cell (anchor + extras)
  for (const cell of selectedCellList()) {
    const key = markKey(cell.page, cell.blockId, cell.col, cell.row);
    const existing = state.marks[key];
    if (buf === '') {
      delete state.marks[key];
    } else if (bufLower === 'x') {
      state.marks[key] = { type: 'x', number: '' };
    } else if (buf === '.') {
      state.marks[key] = { type: '.', number: '' };
    } else if (bufLower === 'r') {
      state.marks[key] = { type: 'repeat', number: '' };
    } else if (bufLower === 's') {
      state.marks[key] = { type: 'stop', number: '' };
    } else {
      state.marks[key] = { type: existing ? existing.type : 'plain', number: buf };
    }
  }
  editingBuffer = null;
}

// Commits whatever was typed into the currently-editing header cell.
// TIME parses as "S+F" seconds+frames; every other cell is stored as
// free text.
function commitHeaderEditingIfAny() {
  if (editingHeaderIndex === null) return;
  if (headerEditBuffer !== null) {
    const label = HEADER_LABELS[editingHeaderIndex];
    if (label === 'TIME') {
      state.timeSecondsRaw = headerEditBuffer;
      state.timeSeconds = parseTimeInput(headerEditBuffer);
    } else {
      state.headerValues[label] = headerEditBuffer;
    }
  }
  editingHeaderIndex = null;
  headerEditBuffer = null;
}

function commitMemoEditingIfAny() {
  if (!editingMemo) return;
  state.memo.text = memoEditor.value;
  memoEditor.style.display = 'none';
  editingMemo = false;
  memoEditBuffer = null;
}

// Positions the memo overlay textarea over the memo box on screen.
// canvasPointFromEvent maps screen->canvas with `canvas.width/rect.width`,
// so this is the inverse: screen px per canvas px = rect.width/canvas.width.
// The overlay lives in #previewWrap (absolute), so it must replicate the
// canvas rect and the zoom/pan baked into the canvas's rendered size.
function renderMemoEditor() {
  if (!editingMemo) return;
  const rect = canvas.getBoundingClientRect();
  const wrapRect = previewWrap.getBoundingClientRect();
  const s = rect.width / canvas.width; // screen px per canvas px (zoom baked in)
  const pos = memoEditPage != null && viewMode === 'multi' ? multiPagePos(memoEditPage) : { x: 0, y: 0 };
  const geo = getMemoGeometry(pos.x, pos.y);
  const memoPad = 8;
  const memoFontSize = 13;
  const left = rect.left - wrapRect.left + geo.x0 * s;
  const top = rect.top - wrapRect.top + geo.y0 * s;
  memoEditor.style.left = left + 'px';
  memoEditor.style.top = top + 'px';
  memoEditor.style.width = ((geo.x1 - geo.x0) * s) + 'px';
  memoEditor.style.height = ((geo.y1 - geo.y0) * s) + 'px';
  memoEditor.style.fontSize = (memoFontSize * s) + 'px';
  memoEditor.style.padding = (memoPad * s) + 'px';
  memoEditor.style.lineHeight = (memoFontSize * 1.4 * s) + 'px';
}

function selectCell(target) {
  commitEditingIfAny();
  commitHeaderEditingIfAny();
  commitSectionNameEditingIfAny();
  commitColLabelEditingIfAny();
  commitMemoEditingIfAny();
  commitHeaderLabelEditingIfAny();
  selectedCell = target;
  selectedExtra = []; // a plain click collapses to a single cell
  navActive = null;
  editingBuffer = null; // nothing typed yet this selection
  render();
}

function deselectCell() {
  commitEditingIfAny();
  commitHeaderEditingIfAny();
  commitSectionNameEditingIfAny();
  commitColLabelEditingIfAny();
  commitMemoEditingIfAny();
  commitHeaderLabelEditingIfAny();
  selectedCell = null;
  selectedExtra = [];
  navActive = null;
  editingBuffer = null;
  render();
}

// Shift+click: select the rectangle from the anchor to the clicked cell
// (same page and block only — otherwise a plain select). The anchor stays
// in place so repeated Shift-clicks keep extending the range from it.
function selectCellRange(target) {
  commitEditingIfAny();
  commitHeaderEditingIfAny();
  commitSectionNameEditingIfAny();
  commitColLabelEditingIfAny();
  commitMemoEditingIfAny();
  commitHeaderLabelEditingIfAny();
  navActive = null;
  if (!selectedCell || selectedCell.page !== target.page || selectedCell.blockId !== target.blockId) {
    selectedCell = target;
    selectedExtra = [];
  navActive = null;
  } else {
    const a = selectedCell;
    const loC = Math.min(a.col, target.col), hiC = Math.max(a.col, target.col);
    const loR = Math.min(a.row, target.row), hiR = Math.max(a.row, target.row);
    selectedExtra = [];
  navActive = null;
    for (let c = loC; c <= hiC; c++) {
      for (let r = loR; r <= hiR; r++) {
        if (c === a.col && r === a.row) continue; // the anchor stays the anchor
        selectedExtra.push({ page: a.page, blockId: a.blockId, col: c, row: r });
      }
    }
  }
  editingBuffer = null;
  render();
}

// Ctrl/Cmd+click: toggle the cell in/out of the selection without
// collapsing it. Removing the anchor hands the anchor role to the first
// remaining extra cell.
function toggleCell(target) {
  commitEditingIfAny();
  commitHeaderEditingIfAny();
  commitSectionNameEditingIfAny();
  commitColLabelEditingIfAny();
  commitMemoEditingIfAny();
  commitHeaderLabelEditingIfAny();
  navActive = null;
  const tKey = cellKey(target);
  const idx = selectedExtra.findIndex(c => cellKey(c) === tKey);
  if (selectedCell && cellKey(selectedCell) === tKey) {
    if (idx >= 0) selectedExtra.splice(idx, 1);
    if (selectedExtra.length) selectedCell = selectedExtra.shift();
    else selectedCell = null;
  } else if (idx >= 0) {
    selectedExtra.splice(idx, 1);
  } else {
    if (!selectedCell) selectedCell = target;
    else selectedExtra.push(target);
  }
  editingBuffer = null;
  render();
}

function startHeaderEditing(index) {
  // PAGE is auto-computed (current/total pages) — not editable.
  if (HEADER_LABELS[index] === 'PAGE') return;
  commitEditingIfAny();
  commitHeaderEditingIfAny();
  commitSectionNameEditingIfAny();
  commitColLabelEditingIfAny();
  commitMemoEditingIfAny();
  commitHeaderLabelEditingIfAny();
  selectedCell = null;
  selectedExtra = [];
  navActive = null;
  editingBuffer = null;
  editingHeaderIndex = index;
  headerEditBuffer = null;
  render();
}

// Section-header / column-letter display-name editing, mirroring the
// header-cell editor: click the name on the sheet, type, Enter commits
// ('' = back to the built-in name), Esc cancels.
let editingSectionName = null; // section key (ACTION/SOUND/INBETWEEN/CAMERA)
let sectionNameBuffer = null;
let editingColLabel = null;    // { sec, index }
let colLabelBuffer = null;

function startSectionNameEditing(sec) {
  commitEditingIfAny();
  commitHeaderEditingIfAny();
  commitSectionNameEditingIfAny();
  commitColLabelEditingIfAny();
  commitMemoEditingIfAny();
  commitHeaderLabelEditingIfAny();
  selectedCell = null;
  selectedExtra = [];
  navActive = null;
  editingBuffer = null;
  editingSectionName = sec;
  sectionNameBuffer = null;
  render();
}

function startColLabelEditing(sec, index) {
  commitEditingIfAny();
  commitHeaderEditingIfAny();
  commitSectionNameEditingIfAny();
  commitColLabelEditingIfAny();
  commitMemoEditingIfAny();
  commitHeaderLabelEditingIfAny();
  selectedCell = null;
  selectedExtra = [];
  navActive = null;
  editingBuffer = null;
  editingColLabel = { sec, index };
  colLabelBuffer = null;
  render();
}

function commitSectionNameEditingIfAny() {
  if (editingSectionName === null) return;
  if (sectionNameBuffer !== null) {
    const v = sectionNameBuffer.trim();
    if (v) state.sectionLabels[editingSectionName] = v;
    else delete state.sectionLabels[editingSectionName];
  }
  editingSectionName = null;
  sectionNameBuffer = null;
  syncSectionNameInputs(); // keep the sidebar in sync
}

function commitColLabelEditingIfAny() {
  if (editingColLabel === null) return;
  if (colLabelBuffer !== null) {
    const key = editingColLabel.sec + ':' + editingColLabel.index;
    const v = colLabelBuffer.trim();
    if (v) state.columnLabels[key] = v;
    else delete state.columnLabels[key];
  }
  editingColLabel = null;
  colLabelBuffer = null;
  buildColumnLabelInputs(); // keep the sidebar in sync
}

// Header-table label renaming (EPISODE/TITLE/…/COMPOSITOR), mirroring the
// section/column-name editors: click the label on the sheet, type, Enter
// commits ('' = back to the built-in name), Esc cancels. PAGE keeps its
// auto-computed value but its label can still be renamed.
function startHeaderLabelEditing(index) {
  commitEditingIfAny();
  commitHeaderEditingIfAny();
  commitSectionNameEditingIfAny();
  commitColLabelEditingIfAny();
  commitMemoEditingIfAny();
  commitHeaderLabelEditingIfAny();
  selectedCell = null;
  selectedExtra = [];
  navActive = null;
  editingBuffer = null;
  editingHeaderIndex = null;
  headerEditBuffer = null;
  editingHeaderLabel = index;
  headerLabelBuffer = null;
  render();
}

function commitHeaderLabelEditingIfAny() {
  if (editingHeaderLabel === null) return;
  if (headerLabelBuffer !== null) {
    const key = HEADER_LABELS[editingHeaderLabel];
    const v = headerLabelBuffer.trim();
    if (v) state.headerLabels[key] = v;
    else delete state.headerLabels[key];
    syncHeaderLabelInputs(); // keep the sidebar in sync
  }
  editingHeaderLabel = null;
  headerLabelBuffer = null;
}

function startMemoEditing(page) {
  commitEditingIfAny();
  commitHeaderEditingIfAny();
  commitSectionNameEditingIfAny();
  commitColLabelEditingIfAny();
  commitMemoEditingIfAny();
  commitHeaderLabelEditingIfAny();
  selectedCell = null;
  selectedExtra = [];
  navActive = null;
  editingBuffer = null;
  editingHeaderIndex = null;
  headerEditBuffer = null;
  editingMemo = true;
  memoEditBuffer = null;
  memoEditPage = page != null ? page : state.currentPage;
  memoEditor.value = state.memo.text;
  render(); // draw memo box (without text, overlay shows it)
  renderMemoEditor(); // position the overlay on the memo box
  memoEditor.style.display = 'block';
  memoEditor.focus();
  // put the cursor at the end of the text
  const len = memoEditor.value.length;
  memoEditor.setSelectionRange(len, len);
}

// Commit the memo edit on Escape / Ctrl+Enter / Tab / losing focus.
memoEditor.addEventListener('blur', () => {
  if (editingMemo) { commitMemoEditingIfAny(); render(); }
});
memoEditor.addEventListener('keydown', e => {
  if (!editingMemo) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    // Escape reverts to the committed text: restore and drop the editor
    memoEditor.value = state.memo.text;
    commitMemoEditingIfAny();
    render();
  } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault(); // Ctrl+Enter = done editing
    commitMemoEditingIfAny();
    render();
  } else if (e.key === 'Tab') {
    e.preventDefault(); // Tab = done editing, keep the text
    commitMemoEditingIfAny();
    render();
  }
});

// The moving end of a Shift+arrow range (the fixed end is selectedCell).
// Mouse-driven selection resets it so the next Shift+arrow starts from
// the clicked cell.
let navActive = null;

// Cell-grid clipboard (Ctrl+C / Ctrl+X / Ctrl+V): a rectangular region of
// marks captured from a selection, pasted at the anchor cell. Stored as a
// w×h grid of mark objects (or null for blank cells); blank source cells
// clear the destination on paste, like Excel.
let clipboard = null; // { w, h, grid: [[mark|null]*w]*h }

function copySelectionToClipboard(cut) {
  const cells = selectedCellList();
  if (!cells.length) return;
  let minC = Infinity, maxC = -1, minR = Infinity, maxR = -1;
  for (const c of cells) {
    minC = Math.min(minC, c.col); maxC = Math.max(maxC, c.col);
    minR = Math.min(minR, c.row); maxR = Math.max(maxR, c.row);
  }
  const w = maxC - minC + 1, h = maxR - minR + 1;
  const page = cells[0].page, blockId = cells[0].blockId;
  const grid = [];
  for (let r = 0; r < h; r++) {
    const rowArr = [];
    for (let c = 0; c < w; c++) {
      const key = markKey(page, blockId, minC + c, minR + r);
      rowArr.push(state.marks[key] ? Object.assign({}, state.marks[key]) : null);
    }
    grid.push(rowArr);
  }
  clipboard = { w, h, grid };
  if (cut) {
    for (const c of cells) delete state.marks[markKey(c.page, c.blockId, c.col, c.row)];
    render();
  }
}

function pasteClipboard() {
  if (!clipboard || !selectedCell) return;
  commitEditingIfAny();
  const { w, h, grid } = clipboard;
  const page = selectedCell.page, blockId = selectedCell.blockId;
  const n = state.sections.ACTION.columns;
  const col0 = selectedCell.col, row0 = selectedCell.row;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const col = col0 + c, row = row0 + r;
      if (col >= n || row > ROWS) continue; // clip at the block edge
      const key = markKey(page, blockId, col, row);
      const mark = grid[r][c];
      if (mark) state.marks[key] = Object.assign({}, mark);
      else delete state.marks[key]; // blank source cell clears the target
    }
  }
  // select the pasted region (its top-left becomes the anchor)
  selectedCell = { page, blockId, col: col0, row: row0 };
  selectedExtra = [];
  navActive = null;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      if (r === 0 && c === 0) continue;
      if (col0 + c >= n || row0 + r > ROWS) continue;
      selectedExtra.push({ page, blockId, col: col0 + c, row: row0 + r });
    }
  }
  editingBuffer = null;
  render();
}

// Moves one cell from (cell) by (dCol, dRow), wrapping across blocks and
// pages in reading order (col-major: down past row 72 flows into the next
// block, past the last block into the next page). Returns null at the
// shot's outer edges.
function navCellFrom(cell, dCol, dRow, pages, n) {
  let { page, blockId, col, row } = cell;
  if (dCol !== 0) {
    col += dCol;
    if (col < 0) {
      if (blockId === 1) { blockId = 0; col = n - 1; }
      else if (page > 0) { page--; blockId = 1; col = n - 1; }
      else return null;
    } else if (col >= n) {
      if (blockId === 0) { blockId = 1; col = 0; }
      else if (page < pages - 1) { page++; blockId = 0; col = 0; }
      else return null;
    }
  }
  if (dRow !== 0) {
    row += dRow;
    if (row < 1) {
      if (blockId === 1) { blockId = 0; row = ROWS; }
      else if (page > 0) { page--; blockId = 1; row = ROWS; }
      else return null;
    } else if (row > ROWS) {
      if (blockId === 0) { blockId = 1; row = 1; }
      else if (page < pages - 1) { page++; blockId = 0; row = 1; }
      else return null;
    }
  }
  return { page, blockId, col, row };
}

// Excel-style cell navigation: arrow keys move the active cell, Enter /
// Tab commit and move on (Shift reverses), Shift+arrows extend the range
// from the anchor (clamped to the block, like Excel at the sheet edge),
// Home/End jump to the row's first/last column (Ctrl = shot's very first
// / last cell), PageUp/PageDown switch pages keeping the same position.
// Keyboard navigation to a cell on another page switches the current
// page first (label dropdown syncs + that page's keyframe labels renumber)
// so the target cell is actually visible.
function ensureNavPage(cell) {
  if (cell.page !== state.currentPage) activatePage(cell.page);
}

function handleNavKey(e) {
  const pages = totalPagesNeeded();
  const n = state.sections.ACTION.columns;
  const start = selectedCell || { page: state.currentPage, blockId: 0, col: 0, row: 1 };

  if (e.key === 'PageDown' || e.key === 'PageUp') {
    const dir = e.key === 'PageDown' ? 1 : -1;
    const np = Math.max(0, Math.min(pages - 1, state.currentPage + dir));
    if (np === state.currentPage) return;
    const cell = { page: np, blockId: start.blockId, col: start.col, row: start.row };
    goToPage(np);
    navActive = cell;
    selectCell(cell);
    return;
  }

  if (e.key === 'Home' || e.key === 'End') {
    const cell = e.ctrlKey
      ? (e.key === 'Home'
        ? { page: 0, blockId: 0, col: 0, row: 1 }
        : { page: pages - 1, blockId: 1, col: n - 1, row: ROWS })
      : { page: start.page, blockId: start.blockId, col: e.key === 'Home' ? 0 : n - 1, row: start.row };
    ensureNavPage(cell);
    navActive = cell;
    selectCell(cell);
    return;
  }

  let dCol = 0, dRow = 0;
  switch (e.key) {
    case 'ArrowLeft': dCol = -1; break;
    case 'ArrowRight': dCol = 1; break;
    case 'ArrowUp': dRow = -1; break;
    case 'ArrowDown': dRow = 1; break;
    case 'Enter': dRow = e.shiftKey ? -1 : 1; break;
    case 'Tab': dCol = e.shiftKey ? -1 : 1; break;
    default: return;
  }

  if (e.shiftKey && e.key.indexOf('Arrow') === 0) {
    // extend the range from the anchor, clamped inside the block
    if (navActive === null) navActive = selectedCell || start;
    const t = {
      page: navActive.page, blockId: navActive.blockId,
      col: Math.max(0, Math.min(n - 1, navActive.col + dCol)),
      row: Math.max(1, Math.min(ROWS, navActive.row + dRow))
    };
    if (t.col === navActive.col && t.row === navActive.row) return;
    selectCellRange(t); // resets navActive (a mouse range would too)
    navActive = t;
    return;
  }

  // plain move: wrap across blocks/pages (Enter/Tab commit via selectCell)
  const t = navCellFrom(start, dCol, dRow, pages, n);
  if (!t) return;
  ensureNavPage(t);
  navActive = t;
  selectCell(t);
}

document.addEventListener('keydown', (e) => {
  const tag = document.activeElement && document.activeElement.tagName;
  const inFormField = tag === 'INPUT' || tag === 'TEXTAREA';

  // Escape closes whichever floating menu is open (shape / book / export /
  // track), whether or not focus is inside one of their inputs. With
  // nothing open it falls through to the normal editing shortcuts below.
  if (e.key === 'Escape') {
    if (bookMenu.style.display === 'flex') { e.preventDefault(); hideBookMenu(); return; }
    if (shapeMenu.style.display === 'flex') { e.preventDefault(); hideShapeMenu(); return; }
    if (exportMenu.style.display === 'flex') { e.preventDefault(); hideExportMenu(); return; }
    if (importMenu.style.display === 'flex') { e.preventDefault(); hideImportMenu(); return; }
    if (trackMenu.style.display === 'flex') { e.preventDefault(); hideTrackMenu(); return; }
  }

  if (e.code === 'Space' && !inFormField) {
    if (!spacePressed) {
      spacePressed = true;
      canvas.classList.add('panning-ready');
    }
    e.preventDefault();
    return;
  }

  if (inFormField) return;

  if (editingSectionName !== null || editingColLabel !== null || editingHeaderLabel !== null) {
    // display-name editing: Enter commits (+ clears), Esc cancels,
    // Backspace trims, printable keys append
    if (e.key === 'Enter') {
      e.preventDefault();
      if (editingSectionName !== null) commitSectionNameEditingIfAny();
      else if (editingColLabel !== null) commitColLabelEditingIfAny();
      else commitHeaderLabelEditingIfAny();
      render();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      editingSectionName = null; sectionNameBuffer = null;
      editingColLabel = null; colLabelBuffer = null;
      editingHeaderLabel = null; headerLabelBuffer = null;
      render();
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      if (editingSectionName !== null) sectionNameBuffer = (sectionNameBuffer === null ? '' : sectionNameBuffer).slice(0, -1);
      else if (editingColLabel !== null) colLabelBuffer = (colLabelBuffer === null ? '' : colLabelBuffer).slice(0, -1);
      else headerLabelBuffer = (headerLabelBuffer === null ? '' : headerLabelBuffer).slice(0, -1);
      render();
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      if (editingSectionName !== null) sectionNameBuffer = (sectionNameBuffer === null ? '' : sectionNameBuffer) + e.key;
      else if (editingColLabel !== null) colLabelBuffer = (colLabelBuffer === null ? '' : colLabelBuffer) + e.key;
      else headerLabelBuffer = (headerLabelBuffer === null ? '' : headerLabelBuffer) + e.key;
      render();
    }
    return;
  }

  if (editingHeaderIndex !== null) {
    const idx = editingHeaderIndex;
    const isTime = HEADER_LABELS[idx] === 'TIME';
    if (e.key === 'Enter') {
      e.preventDefault();
      commitHeaderEditingIfAny();
      editingHeaderIndex = idx; // stay in edit mode, buffer resets to committed value
      render();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      editingHeaderIndex = null;
      headerEditBuffer = null;
      render();
    } else if (e.key === 'Backspace') {
      e.preventDefault();
      headerEditBuffer = headerEditBuffer === null ? '' : headerEditBuffer.slice(0, -1);
      render();
    } else if (isTime && (/^[0-9]$/.test(e.key) || e.key === '+')) {
      e.preventDefault();
      headerEditBuffer = headerEditBuffer === null ? e.key : headerEditBuffer + e.key;
      render();
    } else if (!isTime && e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      headerEditBuffer = headerEditBuffer === null ? e.key : headerEditBuffer + e.key;
      render();
    }
    return;
  }

  // ---- clipboard: Ctrl/Cmd+C copy, X cut, V paste the selected cells ----
  if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C' || e.key === 'x' || e.key === 'X' || e.key === 'v' || e.key === 'V')) {
    const menuOpen = shapeMenu.style.display === 'flex' || bookMenu.style.display === 'flex' ||
                     exportMenu.style.display === 'flex' || importMenu.style.display === 'flex' || trackMenu.style.display === 'flex';
    if (!menuOpen) {
      e.preventDefault();
      if (e.key === 'c' || e.key === 'C') copySelectionToClipboard(false);
      else if (e.key === 'x' || e.key === 'X') copySelectionToClipboard(true);
      else pasteClipboard();
      return;
    }
  }

  // ---- Excel-style cell navigation: arrows move, Enter/Tab commit and
  //      move on, Shift+arrows extend, Home/End jump, PageUp/Down switch
  //      pages. Skipped while a floating menu is open (focus stays there).
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight' ||
      e.key === 'Tab' || e.key === 'Home' || e.key === 'End' || e.key === 'PageUp' || e.key === 'PageDown' || e.key === 'Enter') {
    const menuOpen = shapeMenu.style.display === 'flex' || bookMenu.style.display === 'flex' ||
                     exportMenu.style.display === 'flex' || importMenu.style.display === 'flex' || trackMenu.style.display === 'flex';
    if (!menuOpen) {
      e.preventDefault();
      handleNavKey(e);
      return;
    }
  }

  if (!selectedCell) return;

  if (e.key === 'Escape') {
    e.preventDefault();
    selectedCell = null;
    selectedExtra = [];
  navActive = null;
    editingBuffer = null;
    render();
  } else if (e.key === 'Backspace') {
    e.preventDefault();
    editingBuffer = editingBuffer === null ? '' : editingBuffer.slice(0, -1);
    render();
  } else if (/^[0-9]$/.test(e.key) || e.key === 'x' || e.key === 'X' || e.key === '.' || e.key === 'r' || e.key === 'R' || e.key === 's' || e.key === 'S') {
    e.preventDefault();
    editingBuffer = editingBuffer === null ? e.key : editingBuffer + e.key;
    render();
  }
});

document.addEventListener('keyup', (e) => {
  if (e.code === 'Space') {
    spacePressed = false;
    canvas.classList.remove('panning-ready', 'panning-active');
  }
});

function updateShapeButtonHighlight() {
  const current = shapeMenuTarget && getEffectiveMark(shapeMenuTarget.page, shapeMenuTarget.blockId, shapeMenuTarget.col, shapeMenuTarget.row);
  shapeMenu.querySelectorAll('.shape-row button').forEach(b => {
    b.classList.toggle('active', current && b.dataset.shape === current.type);
  });
}

// Clamps a floating menu so it stays fully inside the viewport with a
// small margin. The menus grew (e.g. the ✕ close button), so hard-coded
// size estimates are no longer enough — measure the real size and clamp
// against that. Call right after the menu is displayed.
function fitMenuInViewport(menu, left, top, margin) {
  margin = margin == null ? 8 : margin;
  const w = menu.offsetWidth, h = menu.offsetHeight;
  const maxLeft = Math.max(margin, window.innerWidth - w - margin);
  const maxTop = Math.max(margin, window.innerHeight - h - margin);
  menu.style.left = Math.max(margin, Math.min(left, maxLeft)) + 'px';
  menu.style.top = Math.max(margin, Math.min(top, maxTop)) + 'px';
}

// Floating menus (shape/book/track + export/import) share a small
// enter/exit animation. Hiding fades the menu out (.closing) and defers
// display:none until the fade ends; showing clears any pending hide so
// the enter animation can play again. Reduced-motion users get an
// instant hide with no animation.
function showFloatingMenu(el) {
  clearTimeout(el._menuHideT);
  el.classList.remove('closing');
  el.style.display = 'flex';
}
function hideFloatingMenu(el) {
  if (el.style.display === 'none') return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.style.display = 'none';
    return;
  }
  el.classList.add('closing');
  clearTimeout(el._menuHideT);
  el._menuHideT = setTimeout(() => {
    el.style.display = 'none';
    el.classList.remove('closing');
  }, 150);
}

function showShapeMenu(clientX, clientY, target) {
  shapeMenuTarget = target;
  updateShapeButtonHighlight();
  showFloatingMenu(shapeMenu);
  fitMenuInViewport(shapeMenu, clientX, clientY);
}

function hideShapeMenu() {
  hideFloatingMenu(shapeMenu);
  shapeMenuTarget = null;
}

document.getElementById('shapeMenuCloseBtn').addEventListener('click', () => hideShapeMenu());

// ---------------------------------------------------------------
// "Book" divider markers (right-click near a column-divider line in
// ACTION to name/edit/delete a layer-order note there).
// ---------------------------------------------------------------
const bookMenu = document.getElementById('bookMenu');
let bookMenuDivider = null;

function findBookDividerAt(x, y) {
  const TOL = 14;
  let best = null, bestDist = Infinity;
  for (const r of bookHitRegions) {
    if (y < r.y0 || y > r.y1) continue;
    const d = Math.abs(x - r.x);
    if (d < TOL && d < bestDist) { bestDist = d; best = r; }
  }
  return best;
}

// Tag-style book entry: each book name is a separate tag at a divider
// (they stack on the sheet), added/removed one at a time instead of as a
// comma-separated blob.
function booksAtDivider(divider) {
  return state.books.filter(b => b.divider === divider).map(b => b.name);
}

function addBook(divider, name) {
  const n = name.trim();
  if (!n || state.books.some(b => b.divider === divider && b.name === n)) return false;
  state.books.push({ divider, name: n });
  return true;
}

function removeBook(divider, name) {
  state.books = state.books.filter(b => !(b.divider === divider && b.name === name));
}

// One removable chip. onRemove re-renders whatever owns the chip.
function makeBookChip(name, onRemove) {
  const chip = document.createElement('span');
  chip.className = 'book-tag';
  chip.textContent = name;
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'book-tag-x';
  x.textContent = '✕';
  x.title = 'Remove "' + name + '"';
  x.addEventListener('click', (e) => { e.stopPropagation(); onRemove(); });
  chip.appendChild(x);
  return chip;
}

function renderBookTagList() {
  const list = document.getElementById('bookTagList');
  list.innerHTML = '';
  booksAtDivider(bookMenuDivider).forEach(name => {
    list.appendChild(makeBookChip(name, () => {
      removeBook(bookMenuDivider, name);
      renderBookTagList();
      render();
    }));
  });
}

function addBookTagFromInput() {
  if (bookMenuDivider === null) return;
  const input = document.getElementById('bookNameInput');
  if (addBook(bookMenuDivider, input.value)) {
    input.value = '';
    renderBookTagList();
    render();
  }
}

function showBookMenu(clientX, clientY, divider) {
  bookMenuDivider = divider;
  document.getElementById('bookMenuTitle').textContent = bookDividerLabel(divider, state.sections.ACTION.columns);
  renderBookTagList();
  showFloatingMenu(bookMenu);
  fitMenuInViewport(bookMenu, clientX, clientY);
  const input = document.getElementById('bookNameInput');
  input.value = '';
  input.focus();
}

function hideBookMenu() {
  hideFloatingMenu(bookMenu);
  bookMenuDivider = null;
}

document.getElementById('bookDeleteBtn').addEventListener('click', () => {
  if (bookMenuDivider === null) return;
  state.books = state.books.filter(b => b.divider !== bookMenuDivider);
  renderBookTagList();
  render();
});
document.getElementById('bookMenuCloseBtn').addEventListener('click', () => hideBookMenu());
document.getElementById('bookNameInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); addBookTagFromInput(); }
  else if (e.key === 'Escape') { e.preventDefault(); hideBookMenu(); }
});
// Clicking anywhere outside the menu (including the sheet itself) closes
// it; clicks inside the menu (tags, input, buttons) are left alone.
document.addEventListener('click', (e) => {
  if (bookMenu.style.display === 'flex' && !bookMenu.contains(e.target)) {
    hideBookMenu();
  }
});

function bookDividerLabel(divider, columns) {
  const labels = alphaLabels(columns);
  if (divider === 0) return 'Before ' + labels[0];
  if (divider === columns) return 'After ' + labels[columns - 1];
  return 'Between ' + labels[divider - 1] + '-' + labels[divider];
}

function buildBookList() {
  const container = document.getElementById('bookListContainer');
  if (!container || container.contains(document.activeElement)) return;
  container.innerHTML = '';
  const n = state.sections.ACTION.columns;

  const usedDividers = [...new Set(state.books.filter(b => b.divider >= 0 && b.divider <= n).map(b => b.divider))].sort((a, b) => a - b);

  usedDividers.forEach(d => {
    const block = document.createElement('div');
    block.style.cssText = 'margin-top:5px;padding-top:5px;border-top:1px solid var(--separator);';

    // head row: divider label + delete-all button
    const head = document.createElement('div');
    head.style.cssText = 'display:flex;align-items:center;gap:6px;';
    const span = document.createElement('span');
    span.textContent = bookDividerLabel(d, n) + ':';
    span.style.cssText = 'font-size:11px;min-width:70px;flex-shrink:0;';
    const spacer = document.createElement('span');
    spacer.style.cssText = 'flex:1;';
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.textContent = '✕';
    delBtn.title = 'Delete all Books at this position';
    delBtn.style.cssText = 'padding:2px 7px;border:none;border-radius:999px;background:rgba(255,59,48,0.1);color:var(--red);font-size:11px;cursor:pointer;flex-shrink:0;';
    delBtn.addEventListener('click', () => {
      state.books = state.books.filter(b => b.divider !== d);
      render();
    });
    head.appendChild(span);
    head.appendChild(spacer);
    head.appendChild(delBtn);

    // tag chips (one per book at this divider)
    const tags = document.createElement('div');
    tags.className = 'book-tags';
    tags.style.cssText = 'margin-top:3px;';
    booksAtDivider(d).forEach(name => {
      tags.appendChild(makeBookChip(name, () => { removeBook(d, name); render(); }));
    });

    // add-one-more row
    const addRow = document.createElement('div');
    addRow.className = 'book-add-row';
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Add a book…';
    const addHere = () => { if (addBook(d, input.value)) { input.value = ''; render(); } };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addHere(); } });
    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.textContent = '+';
    addBtn.addEventListener('click', addHere);
    addRow.appendChild(input);
    addRow.appendChild(addBtn);

    block.appendChild(head);
    block.appendChild(tags);
    block.appendChild(addRow);
    container.appendChild(block);
  });

  // "add a new divider position" row — a dropdown so the sidebar doesn't
  // show n+1 empty boxes; only positions that actually have Books get a
  // row above, keeping this compact.
  const addRow = document.createElement('div');
  addRow.className = 'book-add-row';
  addRow.style.cssText = 'margin-top:6px;';

  const select = document.createElement('select');
  select.style.cssText = 'padding:3px;border:1px solid var(--separator);border-radius:8px;font-size:11px;flex-shrink:0;max-width:112px;';
  for (let d = 0; d <= n; d++) {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = bookDividerLabel(d, n);
    select.appendChild(opt);
  }

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = 'Book name, Enter to add';
  const addNew = () => {
    const d = parseInt(select.value, 10);
    if (addBook(d, nameInput.value)) { nameInput.value = ''; render(); }
  };
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addNew(); } });

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.textContent = '+';
  addBtn.addEventListener('click', addNew);

  addRow.appendChild(select);
  addRow.appendChild(nameInput);
  addRow.appendChild(addBtn);
  container.appendChild(addRow);
}

// ---------------------------------------------------------------
// Dialogue (SOUND column) / camera note (CAMERA section) entry popup.
// target: { kind:'dialogue'|'camera', entryId:null|id, page, blockId,
//          gFrom, gTo, lane } — entryId null means "create a new entry
//          with this range/lane", otherwise edit that existing entry.
// ---------------------------------------------------------------
const trackMenu = document.getElementById('trackMenu');
let trackMenuTarget = null;
// Camera keyframe editor state: the selected keyframe index, and a local
// draft ({ keyframes }) used while creating a NEW note (commit materializes
// it into state.camera). Existing notes are edited in place.
let trackKfSel = 0;
let trackDraft = null;

// ---- camera keyframe editor (trackMenu) ---------------------------
function trackKfs() {
  if (trackDraft) return trackDraft.keyframes;
  if (trackMenuTarget && trackMenuTarget.entryId != null) {
    const e = findTrackEntry('camera', trackMenuTarget.entryId);
    return e ? e.keyframes : null;
  }
  return null;
}
// The segment whose type/name the popup edits: the selected keyframe's
// outgoing segment (the LAST keyframe edits the last segment instead).
function kfToSegIndex() {
  const kfs = trackKfs();
  if (!kfs) return 0;
  return Math.min(trackKfSel, kfs.length - 2);
}
function trackSegKf() {
  const kfs = trackKfs();
  return kfs ? kfs[kfToSegIndex()] : null;
}
function clampKfFrame(kfs, i, g) {
  const lo = i > 0 ? kfs[i - 1].frame + 1 : 1;
  const hi = i < kfs.length - 1 ? kfs[i + 1].frame - 1 : totalPagesNeeded() * ROWS * 2;
  return Math.max(lo, Math.min(hi, g));
}
// The ア default position for the edited segment (existing value if valid,
// otherwise just past the segment's start keyframe).
function aruDefault() {
  const kfs = trackKfs();
  if (!kfs) return trackMenuTarget ? trackMenuTarget.gFrom + 1 : 1;
  const si = kfToSegIndex();
  const lo = kfs[si].frame;
  if (kfs[si].aFrame != null && kfs[si].aFrame >= lo && kfs[si].aFrame <= kfs[si + 1].frame) return kfs[si].aFrame;
  return lo + 1;
}
function syncAruField() {
  const aruInput = document.getElementById('trackAruInput');
  const type = document.getElementById('trackCameraTypeSelect').value;
  const isQuick = type === 'QTU' || type === 'QTB';
  aruInput.style.display = isQuick ? '' : 'none';
  aruInput.value = isQuick ? formatGlobalFrame(aruDefault()) : '';
}
function kfKeydown(e) {
  if (e.key === 'Enter') { e.preventDefault(); commitTrackMenu(); }
  else if (e.key === 'Escape') { e.preventDefault(); hideTrackMenu(); }
}
// Selects a keyframe: the type/name/ア fields now edit its outgoing segment.
function selectKf(i) {
  const kfs = trackKfs();
  if (!kfs || i < 0 || i >= kfs.length) return;
  trackKfSel = i;
  const segKf = trackSegKf();
  document.getElementById('trackCameraTypeSelect').value = segKf ? (segKf.type || '') : '';
  document.getElementById('trackNameInput').value = segKf ? (segKf.name || '') : '';
  syncAruField();
  renderTrackKfList();
}
function renderTrackKfList() {
  const list = document.getElementById('trackKfList');
  const kfs = trackKfs();
  if (!list || !kfs) return;
  list.innerHTML = '';
  kfs.forEach((kf, i) => {
    const row = document.createElement('div');
    row.className = 'track-kf-row' + (i === trackKfSel ? ' selected' : '');
    const label = document.createElement('input');
    label.type = 'text'; label.className = 'track-kf-label';
    label.value = kf.label || ''; label.maxLength = 8;
    label.title = 'Keyframe name — A, B, C… auto, or your own (auto names renumber by frame)';
    label.addEventListener('input', () => { kf.label = label.value.trim(); kf.auto = !kf.label; render(); });
    label.addEventListener('keydown', kfKeydown);
    label.addEventListener('focus', () => selectKf(i));
    const at = document.createElement('span');
    at.className = 'track-kf-at'; at.textContent = '@';
    const frame = document.createElement('input');
    frame.type = 'text'; frame.className = 'track-kf-frame';
    frame.value = formatGlobalFrame(kf.frame);
    frame.title = 'Frame (S+F) — type it or drag the marker on the sheet';
    frame.addEventListener('input', () => {
      const parsed = parseGlobalFrame(frame.value);
      if (parsed != null) { kf.frame = clampKfFrame(kfs, i, parsed); render(); }
    });
    frame.addEventListener('keydown', kfKeydown);
    frame.addEventListener('focus', () => selectKf(i));
    row.appendChild(label); row.appendChild(at); row.appendChild(frame);
    if (i > 0 && i < kfs.length - 1) {
      const del = document.createElement('button');
      del.type = 'button'; del.className = 'track-kf-del'; del.textContent = '✕';
      del.title = 'Remove this keyframe — merges the two neighboring segments';
      del.addEventListener('click', (ev) => { ev.stopPropagation(); removeKf(i); });
      row.appendChild(del);
    }
    list.appendChild(row);
  });
  const hint = document.getElementById('trackSegHint');
  if (hint && kfs.length > 1) {
    const si = kfToSegIndex();
    hint.textContent = `· type/name edit: ${kfs[si].label || labelAt(si)} → ${kfs[si + 1].label || labelAt(si + 1)}`;
  } else if (hint) hint.textContent = '';
  const rm = document.getElementById('trackRemoveKfBtn');
  if (rm) rm.disabled = kfs.length <= 2;
}
function addKf() {
  const kfs = trackKfs();
  if (!kfs) return;
  const si = kfToSegIndex();
  const a = kfs[si], b = kfs[si + 1];
  if (b.frame - a.frame < 2) return;
  const inherited = a.type;
  const nk = { frame: Math.round((a.frame + b.frame) / 2), label: '', auto: true };
  if (inherited) nk.type = inherited;
  kfs.splice(si + 1, 0, nk);
  renumberCameraLabelsPage();
  selectKf(si + 1);
  render();
}
function removeKf(i) {
  const kfs = trackKfs();
  if (!kfs || kfs.length <= 2 || i <= 0 || i >= kfs.length - 1) return;
  kfs.splice(i, 1);
  trackKfSel = Math.max(0, Math.min(trackKfSel, kfs.length - 1));
  renumberCameraLabelsPage();
  selectKf(trackKfSel);
  render();
}
document.getElementById('trackAddKfBtn').addEventListener('click', addKf);
document.getElementById('trackRemoveKfBtn').addEventListener('click', () => removeKf(trackKfSel));

function findTrackEntry(kind, id) {
  const arr = kind === 'camera' ? state.camera : state.dialogue;
  return arr.find(e => e.id === id) || null;
}

// Per-kind UI wiring for the track popup: dialogue shows speaker + type +
// text; camera shows type + name. The other row is hidden.
function trackMenuShowFields(kind) {
  document.getElementById('trackDialogueFields').style.display = kind === 'dialogue' ? '' : 'none';
  document.getElementById('trackCameraFields').style.display = kind === 'camera' ? '' : 'none';
}

function showTrackMenu(clientX, clientY, target) {
  trackMenuTarget = target;
  const isNew = target.entryId == null;
  const existing = isNew ? null : findTrackEntry(target.kind, target.entryId);
  const title = target.kind === 'camera'
    ? `CAMERA lane ${target.lane + 1} · ${formatGlobalFrame(existing ? camFrom(existing) : target.gFrom)} – ${formatGlobalFrame(existing ? camTo(existing) : target.gTo)}`
    : `SOUND · ${formatGlobalFrame(target.gFrom)} – ${formatGlobalFrame(target.gTo)}`;
  document.getElementById('trackMenuTitle').textContent = title;
  trackMenuShowFields(target.kind);

  if (target.kind === 'camera') {
    const typeSelect = document.getElementById('trackCameraTypeSelect');
    const nameInput = document.getElementById('trackNameInput');
    if (isNew) {
      // a new note edits a local draft; commit materializes the entry
      trackDraft = { keyframes: [
        { frame: target.gFrom, label: labelAt(0), auto: true },
        { frame: target.gTo, label: labelAt(1), auto: true }
      ] };
      trackKfSel = 0;
      typeSelect.value = target.type || 'PAN';
      nameInput.value = '';
    } else {
      trackDraft = null;
      const kfs = existing.keyframes;
      trackKfSel = target.kfIndex != null ? target.kfIndex
        : (target.segIndex != null ? target.segIndex : 0);
      const segKf = kfs[Math.min(trackKfSel, kfs.length - 2)];
      typeSelect.value = segKf ? (segKf.type || '') : '';
      nameInput.value = segKf ? (segKf.name || '') : '';
    }
    document.getElementById('trackKfEditor').style.display = '';
    renderTrackKfList();
    syncAruField();
  } else {
    trackDraft = null;
    document.getElementById('trackKfEditor').style.display = 'none';
    document.getElementById('trackSpeakerInput').value = existing ? (existing.speaker || '') : '';
    document.getElementById('trackDialogueTypeSelect').value = existing ? (existing.type || '') : '';
    document.getElementById('trackTextInput').value = existing ? (existing.text || '') : '';
  }

  document.getElementById('trackDeleteBtn').style.display = isNew ? 'none' : '';
  showFloatingMenu(trackMenu);
  fitMenuInViewport(trackMenu, clientX, clientY);
  // focus the first editable field for the kind
  const first = target.kind === 'camera' ? document.getElementById('trackNameInput') : document.getElementById('trackSpeakerInput');
  if (existing) first.focus();
}

function hideTrackMenu() {
  hideFloatingMenu(trackMenu);
  trackMenuTarget = null;
  trackDraft = null;
}

// The camera type dropdown is generated from CAMERA_TYPES (with optional
// CAMERA_TYPE_HINTS suffixes) so adding a type is one line in state.js
// instead of editing the HTML.
(() => {
  const sel = document.getElementById('trackCameraTypeSelect');
  sel.innerHTML = '<option value="">Type…</option>' + CAMERA_TYPES.map(t => {
    const hint = CAMERA_TYPE_HINTS[t];
    return `<option value="${t}">${t}${hint ? ' ' + hint : ''}</option>`;
  }).join('');
})();

// When the user picks a camera type on a NEW entry, auto-fill the name
// with that type (they can then edit it freely — "choose the type first,
// rename later"). The type is applied to the edited segment at commit.
document.getElementById('trackCameraTypeSelect').addEventListener('change', (e) => {
  const type = e.target.value;
  syncAruField();
  if (!trackMenuTarget || trackMenuTarget.entryId != null) return;
  document.getElementById('trackNameInput').value = type || '';
});

function commitTrackMenu() {
  if (!trackMenuTarget) return;
  const t = trackMenuTarget;
  if (t.kind === 'camera') {
    const type = document.getElementById('trackCameraTypeSelect').value.trim();
    const name = document.getElementById('trackNameInput').value.trim() || type;
    const kfs = trackKfs();
    const segKf = trackSegKf();
    if (segKf) { segKf.type = type; segKf.name = name; }
    // QTU/QTB carry the circled ア position (animation start frame)
    if ((type === 'QTU' || type === 'QTB') && segKf) {
      const parsed = parseGlobalFrame(document.getElementById('trackAruInput').value);
      const si = kfToSegIndex();
      const lo = kfs[si].frame, hi = kfs[si + 1].frame;
      segKf.aFrame = parsed != null ? Math.max(lo, Math.min(parsed, hi)) : lo + 1;
    }
    if (t.entryId != null) {
      // existing note — its keyframes were edited in place
    } else if (type || name) {
      state.camera.push({ id: nextTrackId(), page: t.page, blockId: t.blockId, lane: t.lane,
        keyframes: kfs.map(k => Object.assign({}, k)) });
      // a brand-new note joins the page's label sequence (A, B, C… across
      // all notes in frame order) so its draft A/B never collide with
      // another note's labels
      renumberCameraLabelsPage();
    }
  } else {
    const speaker = document.getElementById('trackSpeakerInput').value.trim();
    const type = document.getElementById('trackDialogueTypeSelect').value;
    const text = document.getElementById('trackTextInput').value.trim();
    if (t.entryId != null) {
      const entry = findTrackEntry('dialogue', t.entryId);
      if (entry) { entry.speaker = speaker; entry.type = type; entry.text = text; }
    } else if (speaker || type || text) {
      state.dialogue.push({ id: nextTrackId(), page: t.page, blockId: t.blockId, gFrom: t.gFrom, gTo: t.gTo, speaker, type, text });
    }
  }
  hideTrackMenu();
  render();
}

document.getElementById('trackMenuCloseBtn').addEventListener('click', () => hideTrackMenu());
document.getElementById('trackSaveBtn').addEventListener('click', () => commitTrackMenu());
['trackTextInput', 'trackSpeakerInput', 'trackNameInput', 'trackAruInput'].forEach(id => {
  document.getElementById(id).addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitTrackMenu(); }
    else if (e.key === 'Escape') { e.preventDefault(); hideTrackMenu(); }
  });
});
document.getElementById('trackDeleteBtn').addEventListener('click', () => {
  if (!trackMenuTarget || trackMenuTarget.entryId == null) return;
  const t = trackMenuTarget;
  const arr = t.kind === 'camera' ? state.camera : state.dialogue;
  state[t.kind === 'camera' ? 'camera' : 'dialogue'] = arr.filter(e => e.id !== t.entryId);
  if (t.kind === 'camera') renumberCameraLabelsPage(); // removed note frees its letters
  hideTrackMenu();
  render();
});
// Clicking anywhere outside the popup (including the sheet itself) closes
// it; clicks inside (input/buttons) are left alone.
document.addEventListener('click', (e) => {
  if (trackMenu.style.display === 'flex' && !trackMenu.contains(e.target)) {
    hideTrackMenu();
  }
});

shapeMenu.querySelectorAll('.shape-row button').forEach(btn => {
  btn.addEventListener('click', () => {
    if (!shapeMenuTarget) return;
    // applies the chosen symbol to every selected cell, keeping each
    // cell's existing typed number
    for (const cell of selectedCellList()) {
      const key = markKey(cell.page, cell.blockId, cell.col, cell.row);
      const existing = state.marks[key];
      state.marks[key] = { type: btn.dataset.shape, number: existing ? existing.number : '' };
    }
    hideShapeMenu();
    render();
  });
});

document.getElementById('markDeleteBtn').addEventListener('click', () => {
  if (!shapeMenuTarget) return;
  for (const cell of selectedCellList()) {
    delete state.marks[markKey(cell.page, cell.blockId, cell.col, cell.row)];
  }
  if (isCellSelected(shapeMenuTarget.page, shapeMenuTarget.blockId, shapeMenuTarget.col, shapeMenuTarget.row)) {
    editingBuffer = null;
  }
  hideShapeMenu();
  render();
});

