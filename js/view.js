// ==== view.js ====
// ==== Pan/zoom, mouse interaction routing (click/drag/context), and drag logic.
// ==== =============================================================
// ---------------------------------------------------------------
// Pan (Space+drag or middle-click drag) and zoom (mouse wheel / buttons)
// ---------------------------------------------------------------
const zoomStage = document.getElementById('zoomStage');
const previewWrap = document.getElementById('previewWrap');
let spacePressed = false;
let isPanning = false;
let justPanned = false;
let panStart = { x: 0, y: 0 };
let panOrigin = { x: 0, y: 0 };
let zoom = 1;
let panX = 0, panY = 0;

// ---------------------------------------------------------------
// Pen / eraser annotation tools (top bar). While a tool is active,
// left-drag on the canvas draws freehand ink (pen) or deletes the
// whole stroke it touches (eraser) instead of the normal editing
// drags; pan/zoom still work. Strokes live in state.ink as plain
// JSON objects, per page, in canvas coordinates.
// ---------------------------------------------------------------
let activeInkStroke = null; // pen stroke currently being drawn
let eraserSwipe = null;     // { page, points: [[x, y], ...] } while erasing
let inkIdCounter = 0;
function nextInkId() { return 'ink' + (++inkIdCounter); }

const penToolBtn = document.getElementById('penToolBtn');
const eraserToolBtn = document.getElementById('eraserToolBtn');
const inkColorInput = document.getElementById('inkColorInput');
const inkWidthInput = document.getElementById('inkWidthInput');

function setActiveTool(tool) {
  state.activeTool = tool;
  penToolBtn.classList.toggle('active', tool === 'pen');
  eraserToolBtn.classList.toggle('active', tool === 'eraser');
  canvas.style.cursor = tool === 'select' ? '' : 'crosshair';
}
penToolBtn.addEventListener('click', () => setActiveTool(state.activeTool === 'pen' ? 'select' : 'pen'));
eraserToolBtn.addEventListener('click', () => setActiveTool(state.activeTool === 'eraser' ? 'select' : 'eraser'));
inkColorInput.addEventListener('input', () => { state.inkColor = inkColorInput.value; });
inkWidthInput.addEventListener('input', () => { state.inkWidth = Number(inkWidthInput.value); });

// Deletes every stroke on the swipe's page that comes within the eraser
// radius of any swipe point. Distance is measured to the stroke's drawn
// segments (not just its sampled points), so a tap on the middle of a
// long straight stroke still erases it. Returns true if anything was
// removed.
function eraseInkStrokes(swipe) {
  const ERASE_RADIUS = 8; // canvas px
  const R2 = ERASE_RADIUS * ERASE_RADIUS;
  const before = state.ink.length;
  // squared distance from point p to segment a-b
  const segDist2 = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const qx = a[0] + t * dx, qy = a[1] + t * dy;
    return (p[0] - qx) * (p[0] - qx) + (p[1] - qy) * (p[1] - qy);
  };
  state.ink = state.ink.filter(s => {
    if (s.page !== swipe.page) return true;
    const pts = s.points;
    for (const q of swipe.points) {
      if (pts.length === 1) {
        if ((pts[0][0] - q[0]) * (pts[0][0] - q[0]) + (pts[0][1] - q[1]) * (pts[0][1] - q[1]) <= R2) return false;
      } else {
        for (let i = 0; i < pts.length - 1; i++) {
          if (segDist2(q, pts[i], pts[i + 1]) <= R2) return false;
        }
      }
    }
    return true;
  });
  return state.ink.length !== before;
}

// Zoom is baked into the canvas element's CSS width instead of scaling the
// parent (#zoomStage). A parent scale() rasterizes the canvas layer at its
// fixed 620px layout size and then GPU-upscales it, which blurs the sheet.
// Resizing the canvas element keeps the layer near 1:1 with the display, so
// text and grid lines stay crisp at any zoom. Pan stays translate-only.
function applyTransform() {
  zoomStage.style.transform = `translate(${panX}px, ${panY}px)`;
  if (editingMemo) renderMemoEditor(); // keep the overlay glued to the memo box
}

function zoomAt(clientX, clientY, factor) {
  const rect = previewWrap.getBoundingClientRect();
  const mouseX = clientX - rect.left;
  const mouseY = clientY - rect.top;
  const stageX = (mouseX - panX) / zoom;
  const stageY = (mouseY - panY) / zoom;
  const newZoom = Math.min(4, Math.max(0.25, zoom * factor));
  const baseW = parseFloat(getComputedStyle(canvas).width) / zoom;
  panX = mouseX - stageX * newZoom;
  panY = mouseY - stageY * newZoom;
  zoom = newZoom;
  canvas.style.width = (baseW * zoom) + 'px';
  applyTransform();
}

let justResized = false;
const MOVE_THRESHOLD = 4; // px, before a mousedown-in-a-move-zone commits to dragging (vs. a plain click to drill)

// Drag-to-move for ACTION marks (their number + keyframe/breakdown symbol)
// and drag-to-adjust for the red end-of-time (TIME cutoff) line.
let markDrag = null;      // { page, blockId, col, row, grabCol, grabRow, startX, startY, key, mark, size, x, y, moved, targetCell, group, dCol, dRow }

// Applies a multi-selection mark drag: every group member moves by the
// same (dCol, dRow). A destination holding a mark that is NOT part of the
// group swaps with the member's origin (mirroring single-cell behavior).
function commitGroupMarkMove(drag) {
  const dCol = drag.dCol || 0, dRow = drag.dRow || 0;
  if (dCol === 0 && dRow === 0) return;
  const groupKeys = new Set(drag.group.map(m => m.key));
  // clear origins first so destinations that are other members' origins
  // are seen as empty
  for (const m of drag.group) delete state.marks[m.key];
  const swaps = [];
  for (const m of drag.group) {
    const destKey = markKey(m.cell.page, m.cell.blockId, m.cell.col + dCol, m.cell.row + dRow);
    const occupant = state.marks[destKey];
    state.marks[destKey] = m.mark;
    if (occupant && !groupKeys.has(destKey)) swaps.push({ srcKey: m.key, occupant });
  }
  for (const s of swaps) state.marks[s.srcKey] = s.occupant;
}
let timeLineDrag = null;  // { moved }
let justDragEnded = false; // suppresses the click that follows a completed drag

// Excel-style rubber-band selection: pressing on an EMPTY ACTION cell and
// dragging rubber-bands a rectangle (highlighted live as it grows). A plain
// press without movement still just clicks (selectCell / selectCellRange /
// toggleCell in the click handler below run as before). Ctrl/Cmd is skipped
// so its click stays a pure toggle.
let marqueeDrag = null; // { page, blockId, anchorCol, anchorRow, curCol, curRow, startX, startY, moved, shift }

// Excel-style drag-to-fill: grabbing the small handle at the selection's
// bottom-right corner and dragging repeats the selected marks into the
// dragged-over cells (copy down / copy right, tiled like Ctrl+D / Ctrl+R).
let fillDrag = null; // { page, blockId, sCol0, sRow0, sCol1, sRow1, curCol, curRow, startX, startY, moved, preview }

// The fill region is the bounding box of the source rectangle and the
// dragged-to cell; each fill cell takes its mark from the matching
// position in the source rect, repeated as a tile pattern.
const modPos = (a, m) => ((a % m) + m) % m;
function fillGeometry(d) {
  return {
    loC: Math.min(d.sCol0, d.curCol), hiC: Math.max(d.sCol1, d.curCol),
    loR: Math.min(d.sRow0, d.curRow), hiR: Math.max(d.sRow1, d.curRow),
    w: d.sCol1 - d.sCol0 + 1, h: d.sRow1 - d.sRow0 + 1
  };
}

// ---- Excel-style number-sequence continuation ----
// A source line (a full column for vertical fills, a full row for
// horizontal fills) is a numeric sequence when every cell holds an
// integer number and the successive differences are all equal. Sequences
// continue their step instead of repeating (1,2,3 dragged down -> 4,5,6,
// or 2,4 -> 6,8), exactly like Excel; lines that are not sequences still
// tile as before, and a single value still copies (no step to infer).
function numberOf(d, c, r) {
  const m = state.marks[markKey(d.page, d.blockId, c, r)];
  if (!m || !/^\d+$/.test(m.number)) return null;
  const n = parseInt(m.number, 10);
  return Number.isFinite(n) ? n : null;
}
// A line (a full source column for vertical fills, a full source row for
// horizontal fills) is a numeric sequence when its numeric marks — they
// need NOT sit in adjacent cells; empty/symbol cells between them are
// simply skipped — form an arithmetic progression (1,_,2,_,3 counts, as
// does 1,3,5). Returns { step, k } (step + mark count per period), or
// null when there is no progression (fewer than 2 numeric marks, or
// uneven differences). A single value copies rather than sequences.
function lineSeq(d, isColumn, idx) {
  const vals = [];
  if (isColumn) {
    for (let r = d.sRow0; r <= d.sRow1; r++) {
      const n = numberOf(d, idx, r);
      if (n !== null) vals.push(n);
    }
  } else {
    for (let c = d.sCol0; c <= d.sCol1; c++) {
      const n = numberOf(d, c, idx);
      if (n !== null) vals.push(n);
    }
  }
  if (vals.length < 2) return null;
  const step = vals[1] - vals[0];
  for (let i = 2; i < vals.length; i++) if (vals[i] - vals[i - 1] !== step) return null;
  return { step, k: vals.length };
}
// Which axes the fill actually extends along, and each line's sequence:
// colSeq[c] = { step, k } of source column c (for vertical fills),
// rowSeq[r] = { step, k } of source row r (for horizontal fills).
function fillAxes(d, geo) {
  const vert = geo.loR < d.sRow0 || geo.hiR > d.sRow1;
  const horiz = geo.loC < d.sCol0 || geo.hiC > d.sCol1;
  const colSeq = {}, rowSeq = {};
  if (vert) for (let c = d.sCol0; c <= d.sCol1; c++) colSeq[c] = lineSeq(d, true, c);
  if (horiz) for (let r = d.sRow0; r <= d.sRow1; r++) rowSeq[r] = lineSeq(d, false, r);
  return { vert, horiz, colSeq, rowSeq };
}
// The mark a fill cell receives: the tiled source mark, with its number
// continued along any sequence axis that extends. Continuation is
// period-based, so sparse marks keep their shape: marks 1,_,2,_,3 in a
// column (every other row) filled down yield 4,_,5,_,6 — same spacing,
// numbers continued. Non-sequence lines tile unchanged, and a fill cell
// whose tiled source position holds no number just copies it (empty
// stays empty, symbols copy).
function fillValueFor(d, axes, c, r) {
  const w = d.sCol1 - d.sCol0 + 1, h = d.sRow1 - d.sRow0 + 1;
  const srcC = d.sCol0 + modPos(c - d.sCol0, w);
  const srcR = d.sRow0 + modPos(r - d.sRow0, h);
  const base = state.marks[markKey(d.page, d.blockId, srcC, srcR)];
  if (!base) return null;
  const baseNum = numberOf(d, srcC, srcR);
  if (baseNum === null) return base; // a symbol / non-numeric mark tiles unchanged
  let num = baseNum;
  if (axes.vert) {
    const seq = axes.colSeq[srcC];
    if (seq) num += ((r - srcR) / h) * seq.k * seq.step;
  }
  if (axes.horiz) {
    const seq = axes.rowSeq[srcR];
    if (seq) num += ((c - srcC) / w) * seq.k * seq.step;
  }
  if (num === baseNum) return base;
  return { type: base.type, number: String(num) };
}
function buildFillPreview() {
  const d = fillDrag;
  const geo = fillGeometry(d);
  d.axes = fillAxes(d, geo);
  d.preview = [];
  for (let c = geo.loC; c <= geo.hiC; c++) {
    for (let r = geo.loR; r <= geo.hiR; r++) {
      if (c >= d.sCol0 && c <= d.sCol1 && r >= d.sRow0 && r <= d.sRow1) continue; // source stays put
      const m = fillValueFor(d, d.axes, c, r);
      if (m) d.preview.push({ col: c, row: r, mark: m });
    }
  }
}
function applyFill(d) {
  const geo = fillGeometry(d);
  const axes = fillAxes(d, geo);
  for (let c = geo.loC; c <= geo.hiC; c++) {
    for (let r = geo.loR; r <= geo.hiR; r++) {
      if (c >= d.sCol0 && c <= d.sCol1 && r >= d.sRow0 && r <= d.sRow1) continue;
      const m = fillValueFor(d, axes, c, r);
      const dstKey = markKey(d.page, d.blockId, c, r);
      if (m) state.marks[dstKey] = { type: m.type, number: m.number };
      else delete state.marks[dstKey];
    }
  }
}

// The fill handle's screen position: the bottom-right corner of the
// selection's bounding box (canvas coords, page offsets already baked in).
function fillHandlePos(rect) {
  const region = actionHitRegions.find(r => r.blockId === rect.blockId && r.page === rect.page);
  if (!region) return null;
  return {
    x: region.x0 + (rect.hiC + 1) * region.colW,
    y: region.letterBot + rect.hiR * region.rowH
  };
}
function findFillHandleAt(x, y) {
  const rect = selectionRect();
  if (!rect) return null;
  const pos = fillHandlePos(rect);
  if (!pos) return null;
  const TOL = 11; // generous — the handle is small
  if (Math.abs(x - pos.x) <= TOL && Math.abs(y - pos.y) <= TOL) return { rect, pos };
  return null;
}

// Live marquee selection: the rectangle from the anchor cell to the current
// cell, all inside the anchor's block. With Shift held the rectangle extends
// from the existing selection's anchor instead of the pressed cell.
function applyMarqueeSelection() {
  const d = marqueeDrag;
  const anchor = (d.shift && selectedCell && selectedCell.page === d.page && selectedCell.blockId === d.blockId)
    ? selectedCell
    : { page: d.page, blockId: d.blockId, col: d.anchorCol, row: d.anchorRow };
  const loC = Math.min(anchor.col, d.curCol), hiC = Math.max(anchor.col, d.curCol);
  const loR = Math.min(anchor.row, d.curRow), hiR = Math.max(anchor.row, d.curRow);
  selectedExtra = [];
  for (let c = loC; c <= hiC; c++) {
    for (let r = loR; r <= hiR; r++) {
      if (c === anchor.col && r === anchor.row) continue; // the anchor stays the anchor
      selectedExtra.push({ page: d.page, blockId: d.blockId, col: c, row: r });
    }
  }
  selectedCell = anchor;
  navActive = null;
  editingBuffer = null;
}

// Drags for SOUND (dialogue) and CAMERA (lane notes):
//   trackRangeDrag — selecting a frame range in an empty area to create a
//                    new entry; mouseup opens the type-in popup.
//   trackSegDrag   — grabbing an existing entry: 'from'/'to' resize its
//                    edges, 'move' shifts its frames (and, for camera,
//                    moves it across lanes by the horizontal drag).
let trackRangeDrag = null; // { kind, blockId, lane, region, startRow, curRow, moved }
let trackSegDrag = null;   // { kind, entry, mode, blockId, region, startRow, startLane, startX, startY, moved, origGFrom, origGTo }
const TRACK_EDGE_TOL = 8; // px, grab zone at an entry's top/bottom edge
// The dialogue/camera entry currently hovered, so drawing.js can show a
// time-adjustment handle: a grip bar at the top/bottom edge (resize the
// frame range) or grip dots in the middle (move the whole note).
let trackHover = null;     // { kind, blockId, entryId, mode, x0, x1, y0, y1 }
function clearTrackHover() {
  if (!trackHover) return;
  trackHover = null;
  canvas.classList.remove('track-edge-ready', 'track-move-ready');
}

// Hit-test helpers for the SOUND / CAMERA regions rebuilt each render().
function findSoundAreaAt(x, y) {
  for (const r of soundAreaRegions) {
    if (x >= r.x0 && x < r.x1 && y >= r.letterBot && y < r.letterBot + ROWS * r.rowH) return r;
  }
  return null;
}
function findSoundEntryAt(x, y) {
  for (const r of soundEntryRegions) {
    if (x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1) return r;
  }
  return null;
}
function findCameraAreaAt(x, y) {
  for (const r of cameraAreaRegions) {
    if (x >= r.x0 && x < r.x1 && y >= r.letterBot && y < r.letterBot + ROWS * r.rowH) return r;
  }
  return null;
}
function findCameraSegAt(x, y) {
  for (const r of cameraSegRegions) {
    if (x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1) return r;
  }
  return null;
}
// The circled ア of a QTU/QTB note (grab priority — it is small and sits
// inside the note's lane box).
function findCameraAruAt(x, y) {
  for (const r of cameraAruRegions) {
    if (Math.hypot(x - r.x, y - r.y) <= r.r + 5) return r;
  }
  return null;
}
// A middle keyframe marker (diamond) of a camera note — grab priority
// over the segment box (it sits on the note's guide line): dragging it
// moves that keyframe's frame.
function findCameraKeyAt(x, y) {
  for (const r of cameraKeyRegions) {
    if (Math.hypot(x - r.x, y - r.y) <= r.r + 4) return r;
  }
  return null;
}
function rowFromY(region, y) {
  const row = Math.floor((y - region.letterBot) / region.rowH) + 1;
  return Math.max(1, Math.min(ROWS, row));
}
// Raw row from a pointer y — NOT clamped to 1..ROWS, so a from/to
// resize handle can cross the block boundary into the previous/next
// block (globalFrameOf handles out-of-range rows arithmetically).
function rawRowFromY(region, y) {
  return Math.floor((y - region.letterBot) / region.rowH) + 1;
}
function laneFromX(region, x) {
  const lane = Math.floor((x - region.x0) / region.colW);
  return Math.max(0, Math.min(region.n - 1, lane));
}
// Converts a row (1..ROWS) of a block ON A GIVEN PAGE to its global frame
// number (the page comes from the drag/click context — in multi-page view
// several pages' blocks are visible at once).
function rowToGlobal(page, blockId, row) { return globalFrameOf(page, blockId, row); }

// Finds a region by blockId AND page (in multi-page view each block
// exists once per page).
function regionFor(list, blockId, page) {
  return list.find(r => r.blockId === blockId && r.page === page) || null;
}

// The page the pointer is over (multi-page view grid: two pages per row,
// flowing down) or the current page.
function pointerPage(x, y) {
  if (viewMode === 'multi' && totalPagesNeeded() > 1) {
    const n = totalPagesNeeded();
    // PAGE_GAP of desk is reserved above the first row (the badges live
    // there), so the row index starts below that strip
    const row = Math.floor((y - PAGE_GAP) / (PAGE_H + PAGE_GAP));
    const col = Math.floor(x / (PAGE_W + PAGE_GAP));
    return Math.max(0, Math.min(n - 1, row * MULTI_PER_ROW + col));
  }
  return state.currentPage;
}

canvas.addEventListener('mousedown', (e) => {
  // ---- pen / eraser tools take priority over editing drags ----
  if (state.activeTool !== 'select' && e.button === 0 && !spacePressed && !customizeMode) {
    const pt = canvasPointFromEvent(e);
    const page = pointerPage(pt.x, pt.y);
    if (state.activeTool === 'pen') {
      activeInkStroke = { id: nextInkId(), page, points: [[pt.x, pt.y]], color: state.inkColor, width: state.inkWidth };
      state.ink.push(activeInkStroke);
      render();
    } else {
      eraserSwipe = { page, points: [[pt.x, pt.y]] };
      eraseInkStrokes(eraserSwipe); // a tap on a stroke erases it immediately
      render();
    }
    e.preventDefault();
    return;
  }
  if (customizeMode && e.button === 0) {
    const pt = canvasPointFromEvent(e);
    const hit = edgeHitTest(pt.x, pt.y);
    if (hit) {
      if (hit.kind === 'move') {
        pendingMove = { pt, hit };
      } else {
        startLayoutDrag(pt, hit);
      }
      e.preventDefault();
      return;
    }
  }
  // Normal-mode drags: grab the red end-of-time line, or grab an existing
  // ACTION mark (its number + keyframe/breakdown symbol) to move it to
  // another frame. A plain click (no movement) still selects the cell.
  if (e.button === 0 && !spacePressed && !customizeMode) {
    const pt = canvasPointFromEvent(e);
    const lineHit = findTimeLineAt(pt.x, pt.y);
    if (lineHit) {
      hideShapeMenu();
      hideBookMenu();
      timeLineDrag = { moved: false, page: lineHit.page };
      canvas.classList.add('time-dragging');
      e.preventDefault();
      return;
    }
    // the fill handle (bottom-right corner of the selection) takes
    // priority over the cell underneath it — grabbing the exact corner
    // starts drag-to-fill, like Excel
    const fillHit = findFillHandleAt(pt.x, pt.y);
    if (fillHit) {
      hideShapeMenu();
      hideBookMenu();
      const r = fillHit.rect;
      fillDrag = {
        page: r.page, blockId: r.blockId,
        sCol0: r.loC, sRow0: r.loR, sCol1: r.hiC, sRow1: r.hiR,
        curCol: r.hiC, curRow: r.hiR,
        startX: pt.x, startY: pt.y, moved: false
      };
      canvas.classList.add('fill-ready');
      e.preventDefault();
      return;
    }
    const cell = findActionCell(pt.x, pt.y);
    if (cell) {
      commitEditingIfAny();
      commitHeaderEditingIfAny();
      commitHeaderLabelEditingIfAny();
      commitMemoEditingIfAny();
      const key = markKey(cell.page, cell.blockId, cell.col, cell.row);
      const stored = state.marks[key];
      if (stored) {
        hideShapeMenu();
        hideBookMenu();
        const region = actionHitRegions.find(r => r.blockId === cell.blockId && r.page === cell.page);
        // dragging a mark that is part of a multi-selection moves the whole
        // selected group together — only cells that actually hold marks
        // travel (empty selected cells stay behind)
        let group = null;
        if (isCellSelected(cell.page, cell.blockId, cell.col, cell.row) && selectedCellList().length > 1) {
          group = selectedCellList()
            .filter(c => state.marks[markKey(c.page, c.blockId, c.col, c.row)])
            .map(c => ({ cell: c, key: markKey(c.page, c.blockId, c.col, c.row), mark: state.marks[markKey(c.page, c.blockId, c.col, c.row)] }));
        }
        markDrag = {
          page: cell.page, blockId: cell.blockId, col: cell.col, row: cell.row,
          grabCol: cell.col, grabRow: cell.row,
          startX: pt.x, startY: pt.y,
          key, mark: stored,
          size: Math.min(getRowH(), region ? region.colW : 40) * 0.42,
          x: pt.x, y: pt.y, moved: false, targetCell: null,
          group, dCol: 0, dRow: 0
        };
        canvas.classList.add('mark-ready');
        e.preventDefault();
        return;
      }
      // ---- Excel-style marquee: pressing on an EMPTY ACTION cell and
      // dragging rubber-bands a rectangular selection (highlighted live).
      // Ctrl/Cmd is skipped so its click stays a pure toggle. A plain
      // press without movement still just clicks — the click handler
      // below runs selectCell / selectCellRange / toggleCell as before.
      if (!(e.ctrlKey || e.metaKey)) {
        marqueeDrag = {
          page: cell.page, blockId: cell.blockId,
          anchorCol: cell.col, anchorRow: cell.row,
          curCol: cell.col, curRow: cell.row,
          startX: pt.x, startY: pt.y, moved: false,
          shift: !!e.shiftKey
        };
        hideShapeMenu();
        hideBookMenu();
        canvas.classList.add('marquee-ready');
        e.preventDefault();
        return;
      }
    }

    // ---- SOUND / CAMERA track entries (dialogue + camera notes) ----
    const sEntry = findSoundEntryAt(pt.x, pt.y);
    if (sEntry) {
      hideShapeMenu();
      hideBookMenu();
      const region = regionFor(soundAreaRegions, sEntry.blockId, sEntry.page);
      const nearTop = Math.abs(pt.y - sEntry.y0) < TRACK_EDGE_TOL;
      const nearBottom = Math.abs(pt.y - sEntry.y1) < TRACK_EDGE_TOL;
      trackSegDrag = {
        kind: 'dialogue', entry: sEntry.entry, page: sEntry.page, blockId: sEntry.blockId, region,
        mode: nearTop ? 'from' : nearBottom ? 'to' : 'move',
        startRow: region ? rowFromY(region, pt.y) : 1, startLane: 0,
        startX: pt.x, startY: pt.y, moved: false,
        origGFrom: sEntry.entry.gFrom, origGTo: sEntry.entry.gTo
      };
      canvas.classList.add('mark-ready');
      e.preventDefault();
      return;
    }
    // the QTU/QTB ア marker drags first (it is small and inside the lane)
    const aru = findCameraAruAt(pt.x, pt.y);
    if (aru) {
      hideShapeMenu();
      hideBookMenu();
      const region = regionFor(cameraAreaRegions, aru.blockId, aru.page);
      trackSegDrag = {
        kind: 'camera', entry: aru.entry, page: aru.page, blockId: aru.blockId, region,
        mode: 'aru', segIndex: aru.segIndex, startRow: 1, startLane: 0,
        startX: pt.x, startY: pt.y, moved: false
      };
      canvas.classList.add('mark-ready');
      e.preventDefault();
      return;
    }
    // a middle keyframe marker drags its own frame (before the segment box)
    const cKey = findCameraKeyAt(pt.x, pt.y);
    if (cKey) {
      hideShapeMenu();
      hideBookMenu();
      const region = regionFor(cameraAreaRegions, cKey.blockId, cKey.page);
      trackSegDrag = {
        kind: 'camera', entry: cKey.entry, page: cKey.page, blockId: cKey.blockId, region,
        mode: 'kf', kfIndex: cKey.kfIndex,
        startRow: 1, startLane: 0,
        startX: pt.x, startY: pt.y, moved: false,
        origKfFrame: cKey.entry.keyframes[cKey.kfIndex].frame
      };
      canvas.classList.add('mark-ready');
      e.preventDefault();
      return;
    }
    const cSeg = findCameraSegAt(pt.x, pt.y);
    if (cSeg) {
      hideShapeMenu();
      hideBookMenu();
      const region = regionFor(cameraAreaRegions, cSeg.blockId, cSeg.page);
      const nearTop = Math.abs(pt.y - cSeg.y0) < TRACK_EDGE_TOL;
      const nearBottom = Math.abs(pt.y - cSeg.y1) < TRACK_EDGE_TOL;
      trackSegDrag = {
        kind: 'camera', entry: cSeg.entry, page: cSeg.page, blockId: cSeg.blockId, region,
        mode: nearTop ? 'from' : nearBottom ? 'to' : 'move',
        segIndex: cSeg.segIndex,
        kiFrom: cSeg.segIndex, kiTo: cSeg.segIndex + 1,
        startRow: region ? rowFromY(region, pt.y) : 1,
        startLane: region ? laneFromX(region, pt.x) : 0,
        startX: pt.x, startY: pt.y, moved: false,
        origGFrom: camFrom(cSeg.entry), origGTo: camTo(cSeg.entry),
        origKfs: cSeg.entry.keyframes.map(k => k.frame)
      };
      canvas.classList.add('mark-ready');
      e.preventDefault();
      return;
    }

    // ---- empty SOUND / CAMERA area: drag a frame range to create ----
    const sArea = findSoundAreaAt(pt.x, pt.y);
    if (sArea) {
      hideShapeMenu();
      hideBookMenu();
      trackRangeDrag = { kind: 'dialogue', page: sArea.page, blockId: sArea.blockId, lane: 0, region: sArea, startRow: rowFromY(sArea, pt.y), curRow: rowFromY(sArea, pt.y), moved: false };
      canvas.classList.add('mark-ready');
      e.preventDefault();
      return;
    }
    const cArea = findCameraAreaAt(pt.x, pt.y);
    if (cArea) {
      hideShapeMenu();
      hideBookMenu();
      trackRangeDrag = { kind: 'camera', page: cArea.page, blockId: cArea.blockId, lane: laneFromX(cArea, pt.x), region: cArea, startRow: rowFromY(cArea, pt.y), curRow: rowFromY(cArea, pt.y), moved: false };
      canvas.classList.add('mark-ready');
      e.preventDefault();
      return;
    }
  }
  if (e.button === 1 || (e.button === 0 && spacePressed)) {
    isPanning = true;
    panStart = { x: e.clientX, y: e.clientY };
    panOrigin = { x: panX, y: panY };
    canvas.classList.add('panning-active');
    e.preventDefault();
  }
});

window.addEventListener('mousemove', (e) => {
  // ---- pen: extend the stroke; eraser: erase as the swipe moves ----
  if (activeInkStroke) {
    const pt = canvasPointFromEvent(e);
    const last = activeInkStroke.points[activeInkStroke.points.length - 1];
    if ((pt.x - last[0]) * (pt.x - last[0]) + (pt.y - last[1]) * (pt.y - last[1]) > 2.25) { // > 1.5px
      activeInkStroke.points.push([pt.x, pt.y]);
      render();
    }
    return;
  }
  if (eraserSwipe) {
    const pt = canvasPointFromEvent(e);
    eraserSwipe.points.push([pt.x, pt.y]);
    if (eraseInkStrokes(eraserSwipe)) render();
    return;
  }
  if (timeLineDrag) {
    const pt = canvasPointFromEvent(e);
    const page = timeLineDrag.page;
    // the line renders at offset 0 in single view, or at the page's grid
    // slot in the all-pages view
    const pos = (viewMode === 'multi' && totalPagesNeeded() > 1) ? multiPagePos(page) : { x: 0, y: 0 };
    const pageStart = page * ROWS * 2;
    const shift = state.showHeaderTable ? 0 : (HDR_BOT - HDR_TOP);
    const GRID_TOP = GRID_TOP_BASE - shift + pos.y;
    const x1b0 = getBlockX(0) + getBlockWidth(0) + pos.x;
    const blockId = pt.x < x1b0 ? 0 : 1;
    const band = getHeaderBand(GRID_TOP, blockId);
    const LETTER_BOT = band.bottom;
    let row = Math.floor((pt.y - LETTER_BOT) / getRowH()) + 1;
    row = Math.max(1, Math.min(ROWS, row));
    const cutoffG = Math.max(pageStart + 1, Math.min(pageStart + ROWS * 2, pageStart + (blockId === 0 ? row : ROWS + row)));
    const newSeconds = cutoffG / 24;
    if (newSeconds !== state.timeSeconds) {
      state.timeSeconds = newSeconds;
      timeLineDrag.moved = true;
      render();
    }
    return;
  }
  if (marqueeDrag) {
    const pt = canvasPointFromEvent(e);
    if (!marqueeDrag.moved && (Math.abs(pt.x - marqueeDrag.startX) > MOVE_THRESHOLD || Math.abs(pt.y - marqueeDrag.startY) > MOVE_THRESHOLD)) {
      marqueeDrag.moved = true;
      canvas.classList.remove('marquee-ready');
      canvas.classList.add('marquee-dragging');
    }
    if (marqueeDrag.moved) {
      // clamp to the anchor block's grid so the range never leaves it
      // (dragging past an edge pins the selection to that edge, like Excel)
      const region = actionHitRegions.find(r => r.blockId === marqueeDrag.blockId && r.page === marqueeDrag.page);
      if (region) {
        marqueeDrag.curCol = Math.max(0, Math.min(region.n - 1, Math.floor((pt.x - region.x0) / region.colW)));
        marqueeDrag.curRow = Math.max(1, Math.min(ROWS, Math.floor((pt.y - region.letterBot) / region.rowH) + 1));
      }
      applyMarqueeSelection();
      render();
    }
    return;
  }
  if (fillDrag) {
    const pt = canvasPointFromEvent(e);
    if (!fillDrag.moved && (Math.abs(pt.x - fillDrag.startX) > MOVE_THRESHOLD || Math.abs(pt.y - fillDrag.startY) > MOVE_THRESHOLD)) {
      fillDrag.moved = true;
      canvas.classList.remove('fill-ready');
      canvas.classList.add('fill-dragging');
    }
    if (fillDrag.moved) {
      // clamp to the source block's grid so the fill never leaves it
      const region = actionHitRegions.find(r => r.blockId === fillDrag.blockId && r.page === fillDrag.page);
      if (region) {
        fillDrag.curCol = Math.max(0, Math.min(region.n - 1, Math.floor((pt.x - region.x0) / region.colW)));
        fillDrag.curRow = Math.max(1, Math.min(ROWS, Math.floor((pt.y - region.letterBot) / region.rowH) + 1));
      }
      buildFillPreview();
      render();
    }
    return;
  }
  if (markDrag) {
    const pt = canvasPointFromEvent(e);
    markDrag.x = pt.x;
    markDrag.y = pt.y;
    if (!markDrag.moved && (Math.abs(pt.x - markDrag.startX) > MOVE_THRESHOLD || Math.abs(pt.y - markDrag.startY) > MOVE_THRESHOLD)) {
      markDrag.moved = true;
      canvas.classList.remove('mark-ready');
      canvas.classList.add('mark-dragging');
    }
    if (markDrag.moved) {
      markDrag.targetCell = findActionCell(pt.x, pt.y) || null;
      if (markDrag.group) {
        // the whole group follows the pointer: delta = pointer cell − grab
        const region = actionHitRegions.find(r => r.blockId === markDrag.blockId && r.page === markDrag.page);
        let dRow = 0, dCol = 0;
        if (region) {
          dRow = (Math.floor((pt.y - region.letterBot) / region.rowH) + 1) - markDrag.grabRow;
          dCol = Math.floor((pt.x - region.x0) / region.colW) - markDrag.grabCol;
        }
        // keep every member inside the block
        for (const m of markDrag.group) {
          dRow = Math.min(dRow, ROWS - m.cell.row);
          dRow = Math.max(dRow, 1 - m.cell.row);
          dCol = Math.min(dCol, region ? region.n - 1 - m.cell.col : 0);
          dCol = Math.max(dCol, region ? -m.cell.col : 0);
        }
        markDrag.dRow = dRow;
        markDrag.dCol = dCol;
        markDrag.targetCell = { page: markDrag.page, blockId: markDrag.blockId, col: markDrag.grabCol + dCol, row: markDrag.grabRow + dRow };
      }
      render();
    }
    return;
  }
  if (trackRangeDrag) {
    const pt = canvasPointFromEvent(e);
    const row = rowFromY(trackRangeDrag.region, pt.y);
    if (row !== trackRangeDrag.curRow) {
      trackRangeDrag.curRow = row;
      if (!trackRangeDrag.moved && (Math.abs(pt.x - trackRangeDrag.startX) > MOVE_THRESHOLD || Math.abs(pt.y - trackRangeDrag.startY) > MOVE_THRESHOLD)) {
        trackRangeDrag.moved = true;
      }
      render();
    }
    return;
  }
  if (trackSegDrag) {
    const pt = canvasPointFromEvent(e);
    const region = trackSegDrag.region;
    const row = region ? rowFromY(region, pt.y) : 1;
    if (!trackSegDrag.moved && (Math.abs(pt.x - trackSegDrag.startX) > MOVE_THRESHOLD || Math.abs(pt.y - trackSegDrag.startY) > MOVE_THRESHOLD)) {
      trackSegDrag.moved = true;
      canvas.classList.remove('mark-ready');
      canvas.classList.add('mark-dragging');
    }
    if (trackSegDrag.moved) {
      const entry = trackSegDrag.entry;
      const kind = trackSegDrag.kind;
      const blockId = trackSegDrag.blockId;
      // camera notes carry a keyframe chain; dialogue entries span plain
      // gFrom/gTo (no keyframes) — keep this shared block safe for both
      const kfs = entry.keyframes;
      const lastKi = kfs ? kfs.length - 1 : -1;
      if (kind === 'dialogue' && trackSegDrag.mode === 'from') {
        // resize a dialogue entry's start edge: raw row lets it cross the
        // block boundary (drag up past row 1 to extend into the previous
        // block); bounds: sheet start and the entry's own end edge
        const rawRow = region ? rawRowFromY(region, pt.y) : row;
        const g = globalFrameOf(trackSegDrag.page, blockId, rawRow);
        entry.gFrom = Math.max(1, Math.min(entry.gTo, g));
      } else if (kind === 'dialogue' && trackSegDrag.mode === 'to') {
        // resize a dialogue entry's end edge: raw row lets it cross the
        // block boundary (drag down past row ROWS to extend into the next
        // block); bounds: the entry's own start edge and the sheet end
        const rawRow = region ? rawRowFromY(region, pt.y) : row;
        const g = globalFrameOf(trackSegDrag.page, blockId, rawRow);
        const sheetEnd = totalPagesNeeded() * ROWS * 2;
        entry.gTo = Math.min(sheetEnd, Math.max(entry.gFrom, g));
      } else if (kind === 'camera' && trackSegDrag.mode === 'from') {
        // resize the keyframe at this segment's top edge (the note's
        // first keyframe on the first segment, a middle keyframe on a
        // middle one); raw row lets it cross the block boundary; bounds:
        // its own neighbors
        const rawRow = region ? rawRowFromY(region, pt.y) : row;
        const g = globalFrameOf(trackSegDrag.page, blockId, rawRow);
        const ki = trackSegDrag.kiFrom != null ? trackSegDrag.kiFrom : 0;
        const lo = ki > 0 ? kfs[ki - 1].frame + 1 : 1;
        const hi = kfs[ki + 1].frame - 1;
        kfs[ki].frame = Math.max(lo, Math.min(hi, g));
      } else if (kind === 'camera' && trackSegDrag.mode === 'to') {
        // resize the keyframe at this segment's bottom edge; bounds: its
        // own neighbors (sheet end for the note's last keyframe)
        const rawRow = region ? rawRowFromY(region, pt.y) : row;
        const g = globalFrameOf(trackSegDrag.page, blockId, rawRow);
        const ki = trackSegDrag.kiTo != null ? trackSegDrag.kiTo : lastKi;
        const lo = kfs[ki - 1].frame + 1;
        const hi = ki < lastKi ? kfs[ki + 1].frame - 1 : totalPagesNeeded() * ROWS * 2;
        kfs[ki].frame = Math.min(hi, Math.max(lo, g));
      } else if (kind === 'camera' && trackSegDrag.mode === 'kf') {
        // drag a middle keyframe marker: the keyframe follows the
        // pointer's row (raw, so it can cross blocks), clamped between
        // its two neighbors
        const rawRow = region ? rawRowFromY(region, pt.y) : row;
        const g = globalFrameOf(trackSegDrag.page, blockId, rawRow);
        const ki = trackSegDrag.kfIndex;
        const lo = kfs[ki - 1].frame + 1;
        const hi = kfs[ki + 1].frame - 1;
        kfs[ki].frame = Math.max(lo, Math.min(hi, g));
      } else if (kind === 'camera' && trackSegDrag.mode === 'aru') {
        // move the circled ア (animation start) up/down within its segment
        const ki = trackSegDrag.segIndex != null ? trackSegDrag.segIndex : 0;
        const segLo = kfs[ki].frame, segHi = kfs[ki + 1].frame;
        kfs[ki].aFrame = Math.max(segLo, Math.min(rowToGlobal(trackSegDrag.page, blockId, row), segHi));
      } else {
        // move: shift the entry's edges by the row delta, ALWAYS relative
        // to the original frames captured at grab time — never onto the
        // live values, or the note accelerates away (each event would
        // re-add the full delta). Camera shifts EVERY keyframe. Camera
        // also follows the horizontal drag across lanes.
        const dRow = row - trackSegDrag.startRow;
        // entries that already span blocks/pages clamp to the whole sheet
        // instead of the drag block's own range (which would squeeze the
        // span back down to one block); single-block entries keep the
        // block clamp so a drag never yanks them across tables
        const blockLo = rowToGlobal(trackSegDrag.page, blockId, 1), blockHi = rowToGlobal(trackSegDrag.page, blockId, ROWS);
        const spanning = trackSegDrag.origGFrom < blockLo || trackSegDrag.origGTo > blockHi;
        const lo = spanning ? 1 : blockLo;
        const hi = spanning ? Math.max(blockHi, totalPagesNeeded() * ROWS * 2) : blockHi;
        if (kind === 'camera') {
          kfs.forEach((kf, i) => { kf.frame = Math.max(lo, Math.min(hi, trackSegDrag.origKfs[i] + dRow)); });
        } else {
          entry.gFrom = Math.max(lo, Math.min(hi, trackSegDrag.origGFrom + dRow));
          entry.gTo = Math.max(lo, Math.min(hi, trackSegDrag.origGTo + dRow));
        }
        if (kind === 'camera' && region) {
          const n = region.n;
          const lane = laneFromX(region, pt.x);
          entry.lane = Math.max(0, Math.min(n - 1, lane));
        } else if (kind === 'dialogue') {
          // manual lane: map the pointer's x onto the entry's current
          // lane geometry (soundEntryRegions carry lane/lanes). A lane
          // only sticks when the pointer actually crosses into another
          // lane — a pure vertical move leaves auto-assignment alone.
          const rr = soundEntryRegions.find(rr => rr.entry.id === entry.id);
          if (rr && rr.lanes > 1) {
            const laneW = rr.x1 - rr.x0;
            const lane = Math.max(0, Math.min(rr.lanes - 1, rr.lane + Math.floor((pt.x - rr.x0) / laneW)));
            if (entry.lane !== lane) entry.lane = lane;
          }
        }
      }
      render();
    }
    return;
  }
  if (pendingMove) {
    const pt = canvasPointFromEvent(e);
    const dx = pt.x - pendingMove.pt.x, dy = pt.y - pendingMove.pt.y;
    if (Math.abs(dx) > MOVE_THRESHOLD || Math.abs(dy) > MOVE_THRESHOLD) {
      startLayoutDrag(pendingMove.pt, pendingMove.hit);
      pendingMove = null;
    } else {
      return;
    }
  }
  if (dragState) {
    applyLayoutDrag(canvasPointFromEvent(e), e.shiftKey);
    return;
  }
  if (!isPanning) {
    // Hover affordances: grab cursor over a stored mark, ns-resize over
    // the end-of-time line, and time-adjustment handles over dialogue /
    // camera entries (skipped while space-panning, in customize, or
    // while a pen/eraser tool is active).
    if (!customizeMode && !spacePressed && state.activeTool === 'select') {
      const pt = canvasPointFromEvent(e);
      const lineHit = findTimeLineAt(pt.x, pt.y);
      const cell = lineHit ? null : findActionCell(pt.x, pt.y);
      const onMark = cell && !!state.marks[markKey(cell.page, cell.blockId, cell.col, cell.row)];
      // the fill handle (bottom-right corner of the selection) wins the
      // cursor over any mark underneath it
      const fillHov = !lineHit ? findFillHandleAt(pt.x, pt.y) : null;
      canvas.classList.toggle('fill-ready', !!fillHov);
      canvas.classList.toggle('time-ready', !!lineHit);
      canvas.classList.toggle('mark-ready', !lineHit && onMark && !fillHov);

      // track entries: the top/bottom edge is a resize grip (from/to),
      // the middle is a move grip, a camera keyframe marker is a keyframe
      // grip — re-render only when the hovered entry or grip changes, so
      // drawing.js can show the handle
      const sHov = lineHit ? null : findSoundEntryAt(pt.x, pt.y);
      const cKeyHov = sHov ? null : findCameraKeyAt(pt.x, pt.y);
      const cHov = cKeyHov ? null : findCameraSegAt(pt.x, pt.y);
      const hov = sHov || cKeyHov || cHov;
      let mode = null, kfIndex = null;
      if (hov) {
        if (cKeyHov) { mode = 'kf'; kfIndex = cKeyHov.kfIndex; }
        else {
          mode = Math.abs(pt.y - hov.y0) < TRACK_EDGE_TOL ? 'from'
            : Math.abs(pt.y - hov.y1) < TRACK_EDGE_TOL ? 'to' : 'move';
        }
      }
      const prevKey = trackHover ? `${trackHover.kind}:${trackHover.entryId}:${trackHover.mode}:${trackHover.kfIndex}:${trackHover.page}` : '';
      const nextKey = hov ? `${sHov ? 'dialogue' : 'camera'}:${hov.entry.id}:${mode}:${kfIndex}:${hov.page}` : '';
      if (prevKey !== nextKey) {
        if (hov) {
          trackHover = { kind: sHov ? 'dialogue' : 'camera', blockId: hov.blockId, page: hov.page, entryId: hov.entry.id, mode, kfIndex, x0: hov.x0, x1: hov.x1, y0: hov.y0, y1: hov.y1 };
        } else {
          trackHover = null;
        }
        canvas.classList.toggle('track-edge-ready', !!trackHover && trackHover.mode !== 'move' && trackHover.mode !== 'kf');
        canvas.classList.toggle('track-move-ready', !!trackHover && trackHover.mode === 'move');
        render();
      }
    }
    return;
  }
  panX = panOrigin.x + (e.clientX - panStart.x);
  panY = panOrigin.y + (e.clientY - panStart.y);
  applyTransform();
});

window.addEventListener('mouseup', (e) => {
  // ---- pen / eraser: finalize the stroke or swipe ----
  if (activeInkStroke) {
    activeInkStroke = null;
    render();
    return;
  }
  if (eraserSwipe) {
    eraseInkStrokes(eraserSwipe);
    eraserSwipe = null;
    render();
    return;
  }
  clearTrackHover();
  if (timeLineDrag) {
    canvas.classList.remove('time-dragging');
    if (timeLineDrag.moved) {
      justDragEnded = true;
      setTimeout(() => { justDragEnded = false; }, 0);
    }
    timeLineDrag = null;
    render();
    return;
  }
  if (markDrag) {
    canvas.classList.remove('mark-dragging', 'mark-ready');
    if (markDrag.moved) {
      justDragEnded = true;
      setTimeout(() => { justDragEnded = false; }, 0);
      const src = { page: markDrag.page, blockId: markDrag.blockId, col: markDrag.col, row: markDrag.row };
      const tgt = markDrag.targetCell;
      if (tgt && !(tgt.blockId === src.blockId && tgt.col === src.col && tgt.row === src.row)) {
        if (markDrag.group) {
          commitGroupMarkMove(markDrag);
        } else {
          const srcKey = markKey(src.page, src.blockId, src.col, src.row);
          const tgtKey = markKey(tgt.page, tgt.blockId, tgt.col, tgt.row);
          if (state.marks[tgtKey]) {
            state.marks[srcKey] = state.marks[tgtKey]; // target occupied: swap both cells
          } else {
            delete state.marks[srcKey];
          }
          state.marks[tgtKey] = markDrag.mark;
        }
        // keep the moved group selected at its new positions
        selectedCell = tgt;
        navActive = null;
        if (markDrag.group) {
          selectedExtra = markDrag.group
            .filter(m => !(m.cell.col === src.col && m.cell.row === src.row))
            .map(m => ({ page: markDrag.page, blockId: markDrag.blockId, col: m.cell.col + markDrag.dCol, row: m.cell.row + markDrag.dRow }));
        } else {
          selectedExtra = [];
        }
        editingBuffer = null;
      }
    }
    markDrag = null;
    render();
    return;
  }
  if (trackRangeDrag) {
    canvas.classList.remove('mark-dragging', 'mark-ready');
    const d = trackRangeDrag;
    const lo = Math.min(d.startRow, d.curRow);
    const hi = Math.max(d.startRow, d.curRow);
    const gFrom = rowToGlobal(d.page, d.blockId, lo);
    const gTo = rowToGlobal(d.page, d.blockId, hi);
    showTrackMenu(e.clientX, e.clientY, { kind: d.kind, entryId: null, page: d.page, blockId: d.blockId, gFrom, gTo, lane: d.lane });
    trackRangeDrag = null;
    justDragEnded = true;
    setTimeout(() => { justDragEnded = false; }, 0);
    render();
    return;
  }
  if (trackSegDrag) {
    canvas.classList.remove('mark-dragging', 'mark-ready');
    if (trackSegDrag.moved) {
      justDragEnded = true;
      setTimeout(() => { justDragEnded = false; }, 0);
      // a drag may have reordered keyframes — renumber the auto labels
      if (trackSegDrag.kind === 'camera' && trackSegDrag.entry && Array.isArray(trackSegDrag.entry.keyframes)) {
        renumberCameraLabelsPage();
      }
    }
    // not moved -> the click that follows opens the edit popup
    trackSegDrag = null;
    render();
    return;
  }
  if (marqueeDrag) {
    canvas.classList.remove('marquee-dragging', 'marquee-ready');
    if (marqueeDrag.moved) {
      // the trailing click must not collapse the rubber-band selection
      justDragEnded = true;
      setTimeout(() => { justDragEnded = false; }, 0);
      // the sidebar follows where the selection landed (like a click does)
      activatePage(marqueeDrag.page);
    }
    marqueeDrag = null;
    render();
    return;
  }
  if (fillDrag) {
    canvas.classList.remove('fill-dragging', 'fill-ready');
    if (fillDrag.moved) {
      // the trailing click must not re-select the source cell
      justDragEnded = true;
      setTimeout(() => { justDragEnded = false; }, 0);
      applyFill(fillDrag);
      // select the whole filled region (source + fill), anchored at its
      // top-left — like Excel, where the fill result becomes the selection
      const geo = fillGeometry(fillDrag);
      selectedCell = { page: fillDrag.page, blockId: fillDrag.blockId, col: geo.loC, row: geo.loR };
      selectedExtra = [];
      navActive = null;
      editingBuffer = null;
      for (let c = geo.loC; c <= geo.hiC; c++) {
        for (let r = geo.loR; r <= geo.hiR; r++) {
          if (c === geo.loC && r === geo.loR) continue;
          selectedExtra.push({ page: fillDrag.page, blockId: fillDrag.blockId, col: c, row: r });
        }
      }
    }
    fillDrag = null;
    render();
    return;
  }
  if (pendingMove) { pendingMove = null; return; } // never crossed the threshold — let the click event drill instead
  if (dragState) {
    dragState = null;
    justResized = true;
    setTimeout(() => { justResized = false; }, 0);
    return;
  }
  if (!isPanning) return;
  isPanning = false;
  justPanned = true;
  canvas.classList.remove('panning-active');
  setTimeout(() => { justPanned = false; }, 0);
});

// Leaving the canvas drops the hover handle (and its cursor).
canvas.addEventListener('mouseleave', () => {
  if (trackHover) {
    clearTrackHover();
    render();
  }
  canvas.classList.remove('fill-ready');
});

document.getElementById('zoomInBtn').addEventListener('click', () => {
  const r = previewWrap.getBoundingClientRect();
  zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.2);
});
document.getElementById('zoomOutBtn').addEventListener('click', () => {
  const r = previewWrap.getBoundingClientRect();
  zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1 / 1.2);
});
document.getElementById('zoomResetBtn').addEventListener('click', () => {
  zoom = 1; panX = 0; panY = 0;
  canvas.style.width = ''; // restore the CSS base width (min(56vw, 620px))
  applyTransform();
});

// ---------------------------------------------------------------
// View mode: 'single' = one page at a time (classic); 'multi' = every
// page stacked vertically, Word-style. A view preference only — never
// part of the saved sheet data.
// ---------------------------------------------------------------
const viewModeBtn = document.getElementById('viewModeBtn');
function syncViewModeBtn() {
  const multi = viewMode === 'multi' && totalPagesNeeded() > 1;
  viewModeBtn.textContent = multi ? 'All pages' : '1 page';
  viewModeBtn.title = multi
    ? 'Showing every page stacked in a grid (Word-style), two per row. Wheel zooms exactly like single-page view; each page\'s \"Page N\" badge floats above the sheet. Click a page to edit it.'
    : 'Single-page view — one page at a time. Switch to the stacked all-pages view to see the whole shot at once.';
}
viewModeBtn.addEventListener('click', () => {
  viewMode = viewMode === 'multi' ? 'single' : 'multi';
  syncViewModeBtn();
  render();
});
syncViewModeBtn();

previewWrap.addEventListener('wheel', (e) => {
  e.preventDefault();
  // the wheel always zooms at the cursor — exactly like the single-page
  // view, including in the all-pages view, so the zoom gesture never
  // changes between modes (scroll the page with the scrollbar or
  // Space+drag / middle-drag, as in single-page view)
  zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12);
}, { passive: false });

// Switches the active page when the user clicks another page in the
// stacked all-pages view — same follow-through as the page arrows (the
// label dropdown syncs, and that page's keyframe labels renumber in its
// own reading order). Returns true if the page changed.
function activatePage(page) {
  if (page === state.currentPage) return false;
  state.currentPage = page;
  syncCameraLabelModeSelect();
  renumberCameraLabelsPage();
  return true;
}

// ---------------------------------------------------------------
// Click / right-click routing (customize mode first, then TIME box,
// then ACTION cells)
// ---------------------------------------------------------------
canvas.addEventListener('click', (e) => {
  if (state.activeTool !== 'select') { e.stopPropagation(); return; } // a drawing tap must not select cells / open menus
  if (justDragEnded) {
    // a completed drag (mark move, TIME line, track range/segment) — the
    // click that follows must not reach document-level close handlers,
    // which would instantly close a popup the mouseup just opened
    justDragEnded = false;
    e.stopPropagation();
    return;
  }
  if (justResized) { justResized = false; return; }
  const pt = canvasPointFromEvent(e);
  if (customizeMode) { handleCustomizeClick(pt.x, pt.y); return; }
  if (spacePressed || justPanned) { justPanned = false; return; }
  const headerLabel = findHeaderLabelAt(pt.x, pt.y);
  if (headerLabel) { startHeaderLabelEditing(headerLabel.index); return; }
  const headerCell = findHeaderCellAt(pt.x, pt.y);
  if (headerCell) { startHeaderEditing(headerCell.index); return; }
  const secName = findSectionNameAt(pt.x, pt.y);
  if (secName) { startSectionNameEditing(secName.sec); return; }
  const colLabel = findColLabelAt(pt.x, pt.y);
  if (colLabel) { startColLabelEditing(colLabel.sec, colLabel.index); return; }
  const memoHit = memoHitRegions.find(r => pt.x >= r.x0 && pt.x < r.x1 && pt.y >= r.y0 && pt.y < r.y1);
  if (memoHit) {
    // already editing: keep the textarea focused (don't restart it)
    if (!editingMemo) startMemoEditing(memoHit.page);
    else memoEditor.focus();
    return;
  }
  const sEntry = findSoundEntryAt(pt.x, pt.y);
  if (sEntry) {
    // stopPropagation: the document-level click-outside handler would
    // otherwise close the popup the very same click just opened
    e.stopPropagation();
    const switched = activatePage(sEntry.page);
    if (switched) render();
    showTrackMenu(e.clientX, e.clientY, { kind: 'dialogue', entryId: sEntry.entry.id, page: sEntry.page, blockId: sEntry.blockId, gFrom: sEntry.entry.gFrom, gTo: sEntry.entry.gTo, lane: 0 });
    return;
  }
  const cKey = findCameraKeyAt(pt.x, pt.y);
  if (cKey) {
    e.stopPropagation();
    const switched = activatePage(cKey.page);
    if (switched) render();
    showTrackMenu(e.clientX, e.clientY, { kind: 'camera', entryId: cKey.entry.id, page: cKey.page, blockId: cKey.blockId, gFrom: camFrom(cKey.entry), gTo: camTo(cKey.entry), lane: cKey.entry.lane, kfIndex: cKey.kfIndex });
    return;
  }
  const cSeg = findCameraSegAt(pt.x, pt.y);
  if (cSeg) {
    e.stopPropagation();
    const switched = activatePage(cSeg.page);
    if (switched) render();
    showTrackMenu(e.clientX, e.clientY, { kind: 'camera', entryId: cSeg.entry.id, page: cSeg.page, blockId: cSeg.blockId, gFrom: camFrom(cSeg.entry), gTo: camTo(cSeg.entry), lane: cSeg.entry.lane, segIndex: cSeg.segIndex });
    return;
  }
  const cell = findActionCell(pt.x, pt.y);
  if (cell) {
    activatePage(cell.page);
    // Shift = extend the selection from the anchor; Ctrl/Cmd = toggle the
    // cell in/out; plain click collapses to that one cell
    if (e.shiftKey) selectCellRange(cell);
    else if (e.ctrlKey || e.metaKey) toggleCell(cell);
    else selectCell(cell);
  } else {
    deselectCell();
  }
});

// Double-clicking a camera segment inserts a new keyframe at that frame
// (label auto = next letter), splitting the segment in two.
canvas.addEventListener('dblclick', (e) => {
  if (customizeMode || state.activeTool !== 'select' || spacePressed) return;
  const pt = canvasPointFromEvent(e);
  if (findCameraKeyAt(pt.x, pt.y)) return; // a keyframe marker is not a split target
  const cSeg = findCameraSegAt(pt.x, pt.y);
  if (!cSeg) return;
  const entry = cSeg.entry;
  const kfs = entry.keyframes;
  const si = cSeg.segIndex;
  const area = regionFor(cameraAreaRegions, cSeg.blockId, cSeg.page);
  if (!area) return;
  const g = rowToGlobal(cSeg.page, cSeg.blockId, rowFromY(area, pt.y));
  const gFrom = kfs[si].frame, gTo = kfs[si + 1].frame;
  const f = Math.max(gFrom + 1, Math.min(gTo - 1, g));
  if (f <= gFrom || f >= gTo) return; // segment must have room to split
  const inherited = kfs[si].type;
  kfs.splice(si + 1, 0, { frame: f, label: '', auto: true });
  if (inherited) kfs[si + 1].type = inherited;
  renumberCameraLabelsPage();
  hideTrackMenu();
  render();
});

canvas.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (customizeMode || state.activeTool !== 'select') return;
  const pt = canvasPointFromEvent(e);
  if (findHeaderCellAt(pt.x, pt.y) || findHeaderLabelAt(pt.x, pt.y)) return;
  const bookHit = findBookDividerAt(pt.x, pt.y);
  if (bookHit) { showBookMenu(e.clientX, e.clientY, bookHit.divider); return; }
  const sEntry = findSoundEntryAt(pt.x, pt.y);
  if (sEntry) {
    activatePage(sEntry.page);
    showTrackMenu(e.clientX, e.clientY, { kind: 'dialogue', entryId: sEntry.entry.id, page: sEntry.page, blockId: sEntry.blockId, gFrom: sEntry.entry.gFrom, gTo: sEntry.entry.gTo, lane: 0 });
    return;
  }
  const cKey = findCameraKeyAt(pt.x, pt.y);
  if (cKey) {
    activatePage(cKey.page);
    showTrackMenu(e.clientX, e.clientY, { kind: 'camera', entryId: cKey.entry.id, page: cKey.page, blockId: cKey.blockId, gFrom: camFrom(cKey.entry), gTo: camTo(cKey.entry), lane: cKey.entry.lane, kfIndex: cKey.kfIndex });
    return;
  }
  const cSeg = findCameraSegAt(pt.x, pt.y);
  if (cSeg) {
    activatePage(cSeg.page);
    showTrackMenu(e.clientX, e.clientY, { kind: 'camera', entryId: cSeg.entry.id, page: cSeg.page, blockId: cSeg.blockId, gFrom: camFrom(cSeg.entry), gTo: camTo(cSeg.entry), lane: cSeg.entry.lane, segIndex: cSeg.segIndex });
    return;
  }
  const cell = findActionCell(pt.x, pt.y);
  if (!cell) { hideShapeMenu(); return; }
  // right-clicking inside an existing multi-selection keeps it intact (so
  // the symbol menu applies to all selected cells); right-clicking a
  // fresh cell collapses the selection to it
  if (!isCellSelected(cell.page, cell.blockId, cell.col, cell.row)) {
    selectCell(cell);
  } else {
    commitEditingIfAny();
  }
  showShapeMenu(e.clientX, e.clientY, cell);
});

// Clicking anywhere outside a floating menu (including the sheet itself)
// closes it; clicks inside the menu are left alone.
document.addEventListener('click', (e) => {
  if (shapeMenu.style.display === 'flex' && !shapeMenu.contains(e.target)) {
    hideShapeMenu();
  }
  // clicking inside the memo overlay editor keeps editing it — every other
  // non-canvas click (the sheet, the sidebar, an empty gap) commits both
  if (e.target !== canvas && e.target !== memoEditor && (editingHeaderIndex !== null || editingHeaderLabel !== null || editingMemo)) {
    commitHeaderEditingIfAny();
    commitHeaderLabelEditingIfAny();
    commitMemoEditingIfAny();
    render();
  }
});

document.getElementById('clearMarksBtn').addEventListener('click', () => {
  state.marks = {};
  selectedCell = null;
  selectedExtra = [];
  navActive = null;
  editingBuffer = null;
  render();
});

