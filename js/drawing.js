// ==== drawing.js ====
// ==== Mark/section/block rendering, TIME helpers, and render().
// ==== =============================================================
// View mode: 'single' renders only state.currentPage (classic one-page
// canvas); 'multi' renders every page stacked vertically, one full sheet
// after another (Word-style). This is a VIEW preference — deliberately
// not part of `state`, so it never enters the export/import format.
let viewMode = 'single';

// Cached Image for the imported paper data URL. Rebuilt only when the
// data URL changes; a decode-in-progress render simply skips until onload
// fires (which triggers a re-render).
let paperImage = null, paperImageSrc = null;
function getPaperImage() {
  if (!state.paper.dataUrl) return null;
  if (state.paper.dataUrl !== paperImageSrc) {
    paperImageSrc = state.paper.dataUrl;
    paperImage = new Image();
    paperImage.onload = () => { render(); if (typeof updatePaperStatus === 'function') updatePaperStatus(); };
    paperImage.src = state.paper.dataUrl;
  }
  return paperImage;
}
// Fit-scale applied to the canvas during the last multi-page render
// (very long shots are scaled down so the canvas stays within browser
// size limits). canvasPointFromEvent divides by it so pointer
// coordinates always land in base 1754x2480-per-page units.
let renderScale = 1;
// Multi-page canvases larger than this along either axis (px) are scaled
// down instead (browsers cap canvas dimensions around 32k).
const MAX_MULTI_DIM = 29760;
// True while render() is drawing the multi-page stack (lets drawBlock/
// render decide where Customize-mode regions are allowed).
let isMultiRender = false;

// Mark-shape primitives (drawMark, drawKeyframeShape, …) live in
// drawing-shapes.js; TIME helpers (parseTimeInput, totalPagesNeeded, …)
// live in drawing-time.js; the Book markers (drawBooks, …) live in
// drawing-books.js. Both are loaded before this file.

// consecutive marks in each column. Lines are computed in continuous
// GLOBAL frame coordinates (see columnGlobalMarkFrames/clipAndDrawSegment)
// so a hold that spans across the block/page boundary still reads as one
// uninterrupted line, split only visually because the blocks sit apart.
// ACTION registers its clickable region + selection highlight; INBETWEEN
// is display-only (populated by the "Make In-Between" button).
function drawSectionMarks(sectionName, blockId, page, secX0, colW, n, letterBot) {
  const isAction = sectionName === 'ACTION';
  const size = Math.min(getRowH(), colW) * 0.42;
  const blockG0 = globalFrameOf(page, blockId, 1); // this block's frame-1 global number
  const domainLo = blockG0 - 1;
  const domainHi = blockG0 + ROWS - 1;
  const cutoffG = Math.round((state.timeSeconds || 0) * 24); // 0 = no cutoff set yet

  if (isAction) {
    actionHitRegions.push({ page, blockId, x0: secX0, colW, n, letterBot, rowH: getRowH() });
  }

  for (let c = 0; c < n; c++) {
    const cx = secX0 + c * colW + colW / 2;

    // highlight every selected cell in this column (drawn first,
    // underneath grid marks) — ACTION only, since INBETWEEN cells aren't
    // directly click-editable
    if (isAction) {
      for (const sel of selectedCellList()) {
        if (sel.page === page && sel.blockId === blockId && sel.col === c) {
          ctx.save();
          ctx.fillStyle = 'rgba(255, 193, 7, 0.35)';
          ctx.fillRect(secX0 + c * colW, letterBot + (sel.row - 1) * getRowH(), colW, getRowH());
          ctx.restore();
        }
      }
    }

    const marksG = isAction ? columnGlobalMarkFrames(c) : columnGlobalMarkFramesInbetween(c);

    // connect consecutive marks (any type — keyframe/breakdown/plain/x/.
    // all count as anchors), skipping over each mark's own cell
    for (let i = 0; i < marksG.length - 1; i++) {
      const a = marksG[i], b = marksG[i + 1];
      if (b - a >= 2) {
        clipAndDrawSegment(cx, a + 0.5, b - 1.5, domainLo, domainHi, letterBot);
      }
    }

    // the last mark extends past its own cell down to the BOTTOM EDGE of
    // the shot's final frame (TIME field), wherever that lands
    if (marksG.length > 0 && cutoffG > 0) {
      const last = marksG[marksG.length - 1];
      if (cutoffG > last + 0.5) {
        clipAndDrawSegment(cx, last + 0.5, cutoffG, domainLo, domainHi, letterBot);
      }
    }

    // Every repeat mark anchors a vertical リピート run across global frames
    // g..g+3. Its own cell triggers drawRepeatRun below, but the run's TAIL
    // usually lands in a later block/page where no mark is stored — so per
    // cell we also draw whatever character the nearest preceding repeat mark
    // implies, making the block/page seam invisible (same idea as dialogue
    // text that flows across blocks). Anchor cells draw the full run instead.
    const marks = isAction ? getEffectiveMark : getInbetweenMark;
    const repeatGs = [];
    for (let p = 0; p < totalPagesNeeded(); p++) {
      for (let b = 0; b < 2; b++) {
        for (let r = 1; r <= ROWS; r++) {
          const m = marks(p, b, c, r);
          if (m && m.type === 'repeat') repeatGs.push(globalFrameOf(p, b, r));
        }
      }
    }
    let j = -1; // last repeatGs index at or before this block's current row

    for (let r = 1; r <= ROWS; r++) {
      const cy = letterBot + (r - 0.5) * getRowH();
      const g = globalFrameOf(page, blockId, r);
      const mark = marks(page, blockId, c, r);
      if (mark && mark.type === 'repeat') {
        drawRepeatRun(cx, letterBot, getRowH(), colW, size, page, blockId, g);
        continue;
      }
      while (j + 1 < repeatGs.length && repeatGs[j + 1] <= g) j++;
      if (j >= 0 && g - repeatGs[j] < REPEAT_TEXT.length) {
        drawRepeatGlyph(cx, cy, size, REPEAT_TEXT[g - repeatGs[j]]);
      }
      if (mark) drawMark(cx, cy, size, mark);
    }
  }
}

// ---------------------------------------------------------------
// SOUND column (invisible frame grid) + CAMERA section (lane notes)
// ---------------------------------------------------------------

// Fills the y-range of a dialogue/camera entry with the "being edited or
// about to be created" highlight, clamped to this block's visible rows.
function fillTrackHighlight(x0, x1, gFrom, gTo, domainLo, letterBot) {
  const from = Math.max(gFrom, domainLo + 1);
  const to = Math.min(gTo, domainLo + ROWS);
  if (to < from) return;
  const y0 = letterBot + (from - domainLo - 1) * getRowH();
  const y1 = letterBot + (to - domainLo) * getRowH();
  ctx.save();
  ctx.fillStyle = 'rgba(255, 193, 7, 0.35)';
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
  ctx.restore();
}

// One character of a dialogue line, positioned along the entry's vertical
// span the way auto-sheet lays them out: chars flow top-to-bottom, spaced
// so the whole line fills the span (never more than 3 rows apart).
// minStart (optional) pushes the first char below a tall speaker box.
function dialogueCharPositions(charCount, spanH, rowH, minStart) {
  const startOffset = Math.max(minStart || rowH * 1.5, rowH * 0.9);
  const endOffset = Math.max(startOffset, spanH - rowH * 0.6);
  const rawStep = charCount > 1 ? (endOffset - startOffset) / (charCount - 1) : 0;
  const step = Math.min(rowH * 3, rawStep);
  const out = [];
  for (let i = 0; i < charCount; i++) out.push(startOffset + step * i);
  return out;
}

// Draws a dialogue entry's speaker box at the first frame + its red
// (TYPE) tag above it, then the line's text as vertical chars.
// Long speaker names wrap onto extra lines inside the box (it grows
// taller, up to ~1.7 rows); the type tag always sits clear above the box.
function drawDialogueEntryBody(entry, sec, y0, y1, rowH, isStart, flow, domainLo, letterBot) {
  const cx = (sec.x0 + sec.x1) / 2;
  const chars = flow ? flow.chars : [];
  const positions = flow ? flow.positions : [];

  // speaker box + (TYPE) tag belong to the entry's START segment only —
  // a line crossing into the next block continues as just its text run.
  if (isStart && flow && flow.geom) {
    const g = flow.geom;
    const bx = g.cx - g.boxW / 2;
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#cc0000';
    ctx.lineWidth = 1.4;
    ctx.fillRect(bx, g.by, g.boxW, g.boxH2);
    ctx.strokeRect(bx, g.by, g.boxW, g.boxH2);
    ctx.fillStyle = '#cc0000';
    ctx.font = `bold ${g.font}px Arial, Helvetica, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const textTop = g.by + (g.boxH2 - g.lines.length * g.lineH) / 2 + g.lineH / 2;
    g.lines.forEach((ln, i) => ctx.fillText(ln, g.cx, textTop + i * g.lineH + 0.5));
    ctx.restore();

    // red (TYPE) tag floating ABOVE the speaker box
    if (entry.type) {
      const tag = '(' + entry.type + ')';
      ctx.save();
      ctx.fillStyle = '#cc0000';
      ctx.font = 'bold 10px Arial, Helvetica, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(tag, cx, y0 - 14);
      ctx.restore();
    }
  }

  // the line's text as vertical characters flowing down the FULL span.
  // Each block segment draws the characters that land inside it, so a
  // long line keeps one continuous run across the block tables.
  if (chars.length) {
    const charFont = Math.min(15, Math.max(9, rowH - 4));
    ctx.save();
    ctx.fillStyle = '#cc0000';
    ctx.font = `bold ${charFont}px Arial, Helvetica, sans-serif`;
    ctx.textAlign = 'center';
    chars.forEach((ch, i) => {
      // char i sits at a row offset from the entry's first frame; convert
      // that to a y inside THIS block's segment
      const frame = entry.gFrom + positions[i] / rowH;
      const local = frame - (domainLo + 1);
      if (local < 0 || local > ROWS) return;
      const y = letterBot + local * rowH;
      if (y >= y0 && y <= y1 + rowH * 0.5) ctx.fillText(ch === ' ' ? '\u00A0' : ch, cx, y);
    });
    ctx.restore();
  }
}

// Hover handle for a dialogue/camera entry's time adjustments: a small
// accent grip bar at the top/bottom edge (drag to resize the frame
// range) or three grip dots at the middle (drag to move the whole note).
// Drawing.js renders it for the entry tracked by view.js's `trackHover`.
function drawTrackHandle(x0, x1, y0, y1, mode, rowH) {
  const cx = (x0 + x1) / 2;
  const w = Math.max(18, Math.min(64, x1 - x0 - 8));
  ctx.save();
  ctx.fillStyle = 'rgba(0, 122, 255, 0.9)';
  if (mode === 'from' || mode === 'to') {
    const hy = mode === 'from' ? y0 : y1;
    const h = Math.max(3, Math.min(5, rowH * 0.16));
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(cx - w / 2, hy - h / 2, w, h, h / 2);
    else ctx.rect(cx - w / 2, hy - h / 2, w, h);
    ctx.fill();
  } else {
    const my = (y0 + y1) / 2;
    const r = Math.max(2, Math.min(3.5, rowH * 0.12));
    for (const dx of [-9, 0, 9]) {
      ctx.beginPath();
      ctx.arc(cx + dx, my, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

// Assigns dialogue lanes: entries that OVERLAP in frame range are split
// into side-by-side sub-columns (interval coloring) so they never cover
// each other, while entries that overlap nobody keep the whole column.
// Only overlapping entries ever get lanes — everything else renders
// exactly as before. An entry whose `lane` the user set by dragging it
// is honored at that index; entries without one are auto-placed.
function assignDialogueLanes(entries) {
  const sorted = [...entries].sort((a, b) => a.gFrom - b.gFrom || a.gTo - b.gTo);
  // connected components of overlapping intervals
  const groups = [];
  let cur = [], curEnd = -Infinity;
  for (const e of sorted) {
    if (!cur.length || e.gFrom <= curEnd) { cur.push(e); curEnd = Math.max(curEnd, e.gTo); }
    else { groups.push(cur); cur = [e]; curEnd = e.gTo; }
  }
  if (cur.length) groups.push(cur);
  const laneOf = new Map(); // id -> { lane, lanes }
  for (const g of groups) {
    // a lone entry always owns the full column — lanes only exist among
    // overlapping entries, so a leftover manual lane is ignored here
    if (g.length === 1) { laneOf.set(g[0].id, { lane: 0, lanes: 1 }); continue; }
    const laneEnds = []; // each lane's last end frame
    // manual lanes first so a user-placed entry claims its lane BEFORE
    // the auto entries fill around it (otherwise an auto entry grabs the
    // lane and the manual one is forced to overlap it)
    [...g].sort((a, b) => {
      const am = a.lane != null && a.lane >= 0 ? 0 : 1;
      const bm = b.lane != null && b.lane >= 0 ? 0 : 1;
      return am - bm || a.gFrom - b.gFrom || a.gTo - b.gTo;
    }).forEach(e => {
      let lane;
      if (e.lane != null && e.lane >= 0) {
        lane = e.lane; // user dragged it here — honor the choice
      } else {
        // first lane whose span ends before this entry starts; a hole
        // (undefined) counts as free — a manual lane above it must not
        // push the auto entry past an actually-free lower lane
        lane = -1;
        for (let i = 0; i < laneEnds.length; i++) {
          if (laneEnds[i] == null || laneEnds[i] < e.gFrom) { lane = i; break; }
        }
        if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
      }
      laneEnds[lane] = Math.max(laneEnds[lane] || 0, e.gTo);
      laneOf.set(e.id, { lane, lanes: -1 }); // lanes filled in below
    });
    // every member shares the group's FINAL lane count, so a lane-0
    // entry doesn't render full-width while its lane-1 sibling is half
    const lanes = laneEnds.length;
    for (const e of g) {
      const cur = laneOf.get(e.id);
      laneOf.set(e.id, { lane: cur.lane, lanes });
    }
  }
  return { laneOf, groups };
}

// Draws every dialogue entry of this block inside the SOUND column. The
// column's frame grid stays invisible (no lines) — each entry is a pair
// of red boundary lines, a speaker box on its first frame, and the text
// drawn as vertical characters down the span. Overlapping entries split
// into side-by-side lanes (see assignDialogueLanes).
// The vertical text flow of a dialogue line is computed ONCE per render
// over the line's FULL frame span (which may cross blocks/pages), then
// each block segment draws the characters that land inside it. Cached by
// entry id and cleared at the top of render().
const dialogueFlows = new Map();

// Precomputes a dialogue line's speaker-box geometry (for the start
// segment) without drawing.
function speakerBoxGeom(entry, sec, y0, rowH) {
  if (!entry.speaker) return null;
  const cx = (sec.x0 + sec.x1) / 2;
  const colW = sec.x1 - sec.x0;
  const boxH = Math.min(20, Math.max(14, rowH - 4));
  const font = Math.min(13, boxH - 5);
  ctx.font = `bold ${font}px Arial, Helvetica, sans-serif`;
  const maxW = Math.max(16, colW - 8);
  const lines = [];
  let cur = '';
  for (const ch of Array.from(String(entry.speaker))) {
    const t = cur + ch;
    if (t === ch || ctx.measureText(t).width <= maxW) cur = t;
    else { lines.push(cur); cur = ch; }
  }
  if (cur) lines.push(cur);
  const lineH = font + 2;
  const boxH2 = Math.max(boxH, lines.length * lineH + 4);
  let boxW = 18;
  lines.forEach(ln => boxW = Math.max(boxW, ctx.measureText(ln).width + 8));
  boxW = Math.min(colW - 6, boxW);
  const by = y0 + 1 + Math.max(0, (rowH - boxH2) / 2);
  return { cx, boxW, boxH2, by, lines, font, lineH, boxBottom: by + boxH2 };
}

// Computes the full-span character positions of a dialogue line. Called
// only from the start segment (where the speaker box lives); continuation
// segments reuse the cached result and draw the chars that land in them.
function computeDialogueFlow(entry, sec, y0, rowH) {
  const chars = Array.from(String(entry.text || ''));
  const geom = speakerBoxGeom(entry, sec, y0, rowH);
  const fullRows = Math.max(1, entry.gTo - entry.gFrom);
  const minStart = geom ? geom.boxBottom - y0 + rowH * 0.6 : rowH * 1.5;
  const positions = dialogueCharPositions(chars.length, fullRows * rowH, rowH, minStart);
  return { chars, positions, geom };
}

function drawSoundDialogue(blockId, page, sec, letterBot, gridBot) {
  const blockG0 = globalFrameOf(page, blockId, 1);
  const domainLo = blockG0 - 1;
  const domainHi = blockG0 + ROWS - 1;
  const rowH = getRowH();

  // the whole column below the letter row is the invisible grid for
  // click/drag to type a new dialogue line
  soundAreaRegions.push({ page, blockId, x0: sec.x0, x1: sec.x1, letterBot, rowH });

  // highlight the range being typed in the open popup (new entry)
  if (trackMenuTarget && trackMenuTarget.entryId == null && trackMenuTarget.kind === 'dialogue' &&
    trackMenuTarget.page === page && trackMenuTarget.blockId === blockId) {
    fillTrackHighlight(sec.x0, sec.x1, trackMenuTarget.gFrom, trackMenuTarget.gTo, domainLo, letterBot);
  }

  // A line renders a segment in EVERY block (and page) its frame range
  // touches — long lines now cross the block tables instead of being
  // clamped at the boundary. `blockId` on the entry only records where
  // it starts.
  const pageLo = page * ROWS * 2 + 1;
  const pageHi = page * ROWS * 2 + ROWS * 2;
  const entries = state.dialogue
    .filter(e => e.gFrom <= pageHi && e.gTo >= pageLo)
    .sort((a, b) => a.gFrom - b.gFrom);
  const { laneOf, groups } = assignDialogueLanes(entries);
  const colW = sec.x1 - sec.x0;

  // light dividers between the lanes of every multi-lane overlap group,
  // spanning that group's combined frame range
  groups.forEach(g => {
    const lc = laneOf.get(g[0].id);
    if (!lc || lc.lanes <= 1) return;
    const gFrom = Math.max(g.reduce((m, e) => Math.min(m, e.gFrom), Infinity), domainLo + 1);
    const gTo = Math.min(g.reduce((m, e) => Math.max(m, e.gTo), -Infinity), domainHi);
    if (gTo < gFrom) return;
    const dy0 = letterBot + (gFrom - domainLo - 1) * rowH;
    const dy1 = letterBot + (gTo - domainLo) * rowH;
    ctx.save();
    ctx.strokeStyle = '#c9c9c9';
    ctx.lineWidth = 1;
    for (let i = 1; i < lc.lanes; i++) {
      const dx = sec.x0 + i * (colW / lc.lanes);
      line(dx, dy0, dx, dy1, 1);
    }
    ctx.restore();
  });

  entries.forEach(entry => {
    const from = Math.max(entry.gFrom, domainLo + 1);
    const to = Math.min(entry.gTo, domainHi);
    if (to < from) return;
    const isStart = from === entry.gFrom;
    const y0 = letterBot + (from - domainLo - 1) * rowH;
    const y1 = letterBot + (to - domainLo) * rowH;

    const lc = laneOf.get(entry.id) || { lane: 0, lanes: 1 };
    const lane = Math.min(lc.lane, lc.lanes - 1); // defensive clamp
    const laneW = colW / lc.lanes;
    const lx0 = sec.x0 + lane * laneW;
    const lx1 = lx0 + laneW;
    const laneSec = { x0: lx0, x1: lx1 };

    if (trackMenuTarget && trackMenuTarget.entryId === entry.id) {
      fillTrackHighlight(laneSec.x0, laneSec.x1, entry.gFrom, entry.gTo, domainLo, letterBot);
    }

    // Red boundary lines mark the entry's TRUE start and end frame rows.
    // Only drawn in the block/page where that boundary actually lives —
    // a line crossing into the next block shows no clipped red line at
    // the table edge, just the single closing line at its real end.
    ctx.save();
    ctx.strokeStyle = '#cc0000';
    ctx.lineWidth = LW_NORMAL + 0.5;
    if (from === entry.gFrom) line(laneSec.x0, y0, laneSec.x1, y0, LW_NORMAL + 0.5);
    if (to === entry.gTo) line(laneSec.x0, y1, laneSec.x1, y1, LW_NORMAL + 0.5);
    ctx.restore();

    // the text flow is computed once (start segment) and cached, so a
    // line crossing blocks keeps one continuous character run
    let flow = dialogueFlows.get(entry.id);
    if (!flow) {
      flow = computeDialogueFlow(entry, laneSec, y0, rowH);
      dialogueFlows.set(entry.id, flow);
    }
    drawDialogueEntryBody(entry, laneSec, y0, y1, rowH, isStart, flow, domainLo, letterBot);

    if (trackHover && trackHover.kind === 'dialogue' && trackHover.page === page && trackHover.entryId === entry.id) {
      drawTrackHandle(laneSec.x0, laneSec.x1, y0, y1, trackHover.mode, rowH);
    }

    // lane/lanes recorded so a horizontal drag can map x back to a lane
    // (and persist it on the entry — see view.js)
    soundEntryRegions.push({ entry, page, blockId, x0: laneSec.x0, x1: laneSec.x1, y0, y1, lane, lanes: lc.lanes });
  });
}

// Staggers overlapping camera notes INSIDE one lane (they keep their lane
// — this only gives each a sideways offset so they never cover each
// other). Candidates are tried outward from the lane center; a candidate
// is accepted when no already-placed note with that same offset overlaps
// it in frame range.
function staggerLaneNotes(entries, colW) {
  const placed = []; // { gFrom, gTo, dx }
  const out = new Map();
  // offsets tried outward from the lane center; never wider than the lane
  // itself (leaving room for the guide line + rotated text), so a note
  // never bleeds into the neighboring lane
  const maxDx = Math.max(0, colW / 2 - 12);
  const candidates = [];
  [0, -8, 8, -16, 16, -24, 24, -32, 32].forEach(c => {
    if (Math.abs(c) <= maxDx) candidates.push(c);
  });
  if (!candidates.length) candidates.push(0);
  entries.forEach(entry => {
    const a = camFrom(entry), b = camTo(entry);
    let dx = 0;
    for (const cand of candidates) {
      if (!placed.some(p => p.dx === cand && a <= p.gTo && p.gFrom <= b)) {
        dx = cand;
        break;
      }
    }
    placed.push({ gFrom: a, gTo: b, dx });
    out.set(entry.id, dx);
  });
  return out;
}

// Draws one camera note's name as plain horizontal text at the note's
// vertical middle (no vertical characters) beside the guide line —
// side = +1 (default) prints right of the line, -1 left of it (the
// ハンディぶれ zigzag already swings to the right, so its name goes left).
// xOff overrides the side offset — shapes push the name clear of their
// polygon with a wider gap.
function drawCameraNoteLabel(name, cx, y0, y1, rowH, side, xOff) {
  const label = String(name || '');
  if (!label) return;
  const midY = (y0 + y1) / 2;
  const font = Math.min(12, Math.max(9, rowH - 7));
  const dx = xOff != null ? xOff : (side === -1 ? -8 : 8);
  ctx.save();
  ctx.fillStyle = '#cc0000';
  ctx.font = `bold ${font}px Arial, Helvetica, sans-serif`;
  ctx.textAlign = side === -1 ? 'right' : 'left';
  ctx.fillText(label, cx + dx, midY);
  ctx.restore();
}

// Decides where one circled KEYFRAME label (the note's head label A, its
// tail label B, or a middle keyframe's label) sits relative to its
// keyframe row: 'side' = beside the guide line at the keyframe's row (the
// classic look), 'above' = centered on the lane above the row edge, or
// 'below' = centered on the lane below it. `edge` is the y of the row
// edge the label is anchored to (the note's top/bottom border for A/B, or
// the grid line a middle keyframe sits on); `dir` is the preferred
// vertical direction ('above' for the head / middle keyframes, 'below'
// for the tail). The CURRENT PAGE's cameraLabelModeByPage override (or
// the global cameraLabelMode default) picks the policy:
//   'side'       → always 'side'
//   'vertical'   → always 'above'/'below', flipping to the other side of
//                  the keyframe only when the preferred spot would cover
//                  the section header — the header is never covered
//   'dynamic'    → 'above'/'below' unless the label would cover the
//                  section header band, another note's polygon, another
//                  note's own rows, or ANOTHER LABEL's vertical spot
//                  (notes touching or one row apart) — then 'side'. The
//                  header is NEVER overlapped; when a shape must be
//                  covered, the shape is the one that gets covered. A
//                  middle keyframe's label always shows at the side in
//                  dynamic, so it never sits on the note's own line.
function keyframeLabelPlacement(label, cx, edge, entry, polyRects, noteRects, labelSpots, letterBot, r, dir) {
  // per-page override wins; otherwise the global default
  const mode = (state.cameraLabelModeByPage && state.cameraLabelModeByPage[state.currentPage])
    || state.cameraLabelMode || 'side';
  if (!label || mode === 'side') return 'side';
  // a middle keyframe (dir 'mid') is drawn above its marker in vertical
  // mode, but ALWAYS beside the keyframe in dynamic — the vertical spot
  // would sit on the note's own guide line
  const d = dir === 'mid' ? 'above' : dir;
  if (mode === 'dynamic' && dir === 'mid') return 'side';
  const spot = dd => {
    const cy = dd === 'above' ? edge - r - 2 : edge + r + 2;
    return { d: dd, cy, box: { x0: cx - r - 2, x1: cx + r + 2, y0: cy - r - 2, y1: cy + r + 2 } };
  };
  const prefer = spot(d);
  const alt = spot(d === 'above' ? 'below' : 'above');
  const hitsHeader = s => s.box.y0 < letterBot;
  const hitsRect = s => rects => rects.some(pr => pr.entry !== entry &&
    s.box.x0 <= pr.x1 && pr.x0 <= s.box.x1 && s.box.y0 <= pr.y1 && pr.y0 <= s.box.y1);
  const hitsPoly = hitsRect(prefer)(polyRects);
  const hitsNote = hitsRect(prefer)(noteRects);
  const hitsLabel = labelSpots.some(ls => ls.entry !== entry &&
    ls.x - ls.r - 2 <= prefer.box.x1 && prefer.box.x0 <= ls.x + ls.r + 2 &&
    ls.y - ls.r - 2 <= prefer.box.y1 && prefer.box.y0 <= ls.y + ls.r + 2);
  if (mode === 'vertical') {
    // stays on the vertical axis: the preferred spot, or the other side
    // of the keyframe when the preferred one would cover the section
    // header (header is the most important thing — never covered)
    if (hitsHeader(prefer)) return hitsHeader(alt) ? 'side' : alt.d;
    return prefer.d;
  }
  if (mode !== 'dynamic') return 'side';
  // vertical unless the label would cover the header, another note's
  // rows (polygon or plain note), or another note's boundary label —
  // then side; the side spot never covers the header, so a shape that
  // must be covered is the one that gets covered
  if (hitsHeader(prefer) || hitsPoly || hitsNote || hitsLabel) return 'side';
  return prefer.d;
}

// Draws one circled keyframe label at its placement (see
// keyframeLabelPlacement): 'side' keeps the classic spot at (sideX, keyY)
// beside the guide line, 'above'/'below' center the circle on the lane
// above/below the anchored row edge instead. solid=true is the filled
// badge used when the label sits on top of a shape's polygon.
function drawKeyframeLabel(label, cx, sideX, keyY, edge, entry, polyRects, noteRects, labelSpots, letterBot, r, dir, solid) {
  const pos = keyframeLabelPlacement(label, cx, edge, entry, polyRects, noteRects, labelSpots, letterBot, r, dir);
  if (pos === 'side') drawCameraEndpointCircle(label, sideX, keyY, r, solid);
  else drawCameraEndpointCircle(label, cx, pos === 'above' ? edge - r - 2 : edge + r + 2, r, solid);
  return pos;
}

// Draws one circled endpoint name (the A/B convention from auto-sheet):
// a white ring with the letter centered inside, sitting beside the
// note's guide line at the start/end frame row.
function drawCameraEndpointCircle(label, cx, cy, r, solid) {
  const str = String(label || '').trim();
  if (!str) return;
  ctx.save();
  // solid=true is used when the badge sits ON TOP of a filled polygon
  // (shape camera notes) — a white disc at 70% keeps the letter crisp
  // while letting the shape's fill show through
  ctx.fillStyle = solid ? 'rgba(255, 255, 255, 0.7)' : 'rgba(255, 255, 255, 0.65)';
  ctx.strokeStyle = '#111111';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#111111';
  ctx.font = `bold ${Math.max(8, r * 1.05)}px Arial, Helvetica, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(str, cx, cy + 0.5);
  ctx.restore();
}

// Draws the polygon camera shapes spanning the note's frame range.
// Geometry and fill/outline come from the CAMERA_SHAPES config table in
// state.js — add a new shape type there (e.g. { shape: 'wedge-in',
// fill: true }) and it renders here. Shape notes are one continuous
// effect with no keyframe diamonds between segments, so the polygon
// fills the FULL segment height edge-to-edge; the triangle shape reads
// as the 100%→0% opacity ramp across the whole span (OL: two triangles
// tip-to-tip — one layer fades 100→0, the other 0→100). topInset/
// bottomInset (px) remain for callers that need a small pull-in.
function drawCameraShape(type, cx, y0, y1, rowH, colW, topInset, bottomInset) {
  const t = String(type || '').trim().toUpperCase();
  const cfg = CAMERA_SHAPES[t];
  if (!cfg) return;
  // The triangle's width IS the opacity level: the base spans the FULL
  // lane width (100% opacity) and tapers to the sharp tip (0%). A 2px
  // margin each side keeps the outline clear of the lane borders.
  const shapeW = Math.max(12, colW - 4);
  const x1 = cx - shapeW / 2, x2 = cx + shapeW / 2;
  const midY = (y0 + y1) / 2;
  // full-height fill: the polygon spans the segment exactly (meeting its
  // neighbors at the keyframe lines) — the triangle reads as the 100%→0%
  // opacity ramp across the whole span
  const yT = y0 + (topInset || 0);
  const yB = y1 - (bottomInset || 0);
  ctx.save();
  ctx.fillStyle = 'rgba(31, 111, 235, 0.42)';
  ctx.strokeStyle = '#111111';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  if (cfg.shape === 'wedge-in') {
    // fade/white/focus-in wedge: narrow at the top, wide at the bottom
    ctx.moveTo(cx, yT);
    ctx.lineTo(x2, yB);
    ctx.lineTo(x1, yB);
  } else if (cfg.shape === 'wedge-out') {
    // fade/white/focus-out wedge: wide at the top, narrow at the bottom
    ctx.moveTo(x1, yT);
    ctx.lineTo(x2, yT);
    ctx.lineTo(cx, yB);
  } else {
    // hourglass (OL): two triangles whose APEXES meet in the middle
    // (per the manual: 頭がぶつかる二つの三角形). The bases sit at the
    // entry's outer edges, the tips touch at midY.
    ctx.moveTo(x1, yT);
    ctx.lineTo(x2, yT);
    ctx.lineTo(cx, midY);
    ctx.closePath();
    ctx.moveTo(x1, yB);
    ctx.lineTo(x2, yB);
    ctx.lineTo(cx, midY);
    ctx.closePath();
  }
  ctx.closePath();
  if (cfg.fill) ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// Draws every camera note of this block inside the CAMERA section. The
// note's `type` chooses how it is drawn: FI/FO/OL are filled polygon
// shapes; PAN/Follow are guide lines with a triangle at each end
// pointing into the segment; TU/TB are big single truck arrows (QTU/QTB
// add a Q mark); ハンディぶれ is a handheld zigzag line; and any other
// directive is a plain guide line. Line-type notes get circled A/B
// endpoint names + the red name label. Notes in the same lane that
// overlap are staggered sideways (lane never changes).
function drawCameraSegments(blockId, page, sec, colW, n, letterBot, gridBot) {
  const blockG0 = globalFrameOf(page, blockId, 1);
  const domainLo = blockG0 - 1;
  const domainHi = blockG0 + ROWS - 1;
  const rowH = getRowH();

  cameraAreaRegions.push({ page, blockId, x0: sec.x0, x1: sec.x0 + colW * n, letterBot, rowH, colW, n });

  // highlight the lane/range being typed in the open popup (new entry)
  if (trackMenuTarget && trackMenuTarget.entryId == null && trackMenuTarget.kind === 'camera' &&
    trackMenuTarget.page === page && trackMenuTarget.blockId === blockId) {
    const lx0 = sec.x0 + trackMenuTarget.lane * colW;
    fillTrackHighlight(lx0, lx0 + colW, trackMenuTarget.gFrom, trackMenuTarget.gTo, domainLo, letterBot);
  }

  // A note renders a segment in EVERY block (and page) its frame range
  // touches — long notes now cross the block tables instead of being
  // clamped at the boundary. `blockId` on the note only records where it
  // starts.
  const pageLo = page * ROWS * 2 + 1;
  const pageHi = page * ROWS * 2 + ROWS * 2;
  const notes = state.camera
    .filter(e => camFrom(e) <= pageHi && camTo(e) >= pageLo)
    .sort((a, b) => a.lane - b.lane || camFrom(a) - camFrom(b));

  const byLane = {};
  notes.forEach(e => (byLane[e.lane] = byLane[e.lane] || []).push(e));
  const dxByLane = {};
  Object.keys(byLane).forEach(lane => { dxByLane[lane] = staggerLaneNotes(byLane[lane], colW); });

  // ---- label-placement collision data ----
  // The polygon bounding boxes of every shape segment drawn in THIS
  // block, for the dynamic label mode to move a label off a shape it
  // would otherwise cover. Built in a prepass so a label can also see
  // shapes drawn by notes that come later in the loop.
  const polyRects = [];
  notes.forEach(e => {
    const kfs = e.keyframes;
    const lane = Math.max(0, Math.min(n - 1, e.lane));
    const pcx = sec.x0 + (lane + 0.5) * colW + ((dxByLane[e.lane] || new Map()).get(e.id) || 0);
    const shapeW = Math.max(12, colW - 4);
    for (let si = 0; si < kfs.length - 1; si++) {
      const kfA = kfs[si], kfB = kfs[si + 1];
      if (!isCameraShapeType(kfA.type)) continue;
      const dHi = kfB.frame - (si < kfs.length - 2 ? 1 : 0);
      const from = Math.max(kfA.frame, domainLo + 1);
      const to = Math.min(dHi, domainHi);
      if (to < from) continue;
      polyRects.push({
        entry: e,
        x0: pcx - shapeW / 2, x1: pcx + shapeW / 2,
        y0: letterBot + (from - domainLo - 1) * rowH,
        y1: letterBot + (to - domainLo) * rowH
      });
    }
  });

  // The vertical extent (row span in THIS block) of every note, per its
  // lane. When two notes collide — one directly above the other in the
  // same lane — BOTH boundary labels give up the vertical spot and move
  // to the side, instead of only the one that would cover the other's
  // polygon (a label must not sit on another note's rows, polygon or
  // not). The header stays the highest priority; the polygon check above
  // stays second; this is the same "don't overlap other notes" rule for
  // plain line notes.
  const noteRects = [];
  notes.forEach(e => {
    const kfs = e.keyframes;
    const lane = Math.max(0, Math.min(n - 1, e.lane));
    const nx0 = sec.x0 + lane * colW, nx1 = sec.x0 + (lane + 1) * colW;
    let yMin = Infinity, yMax = -Infinity;
    for (let si = 0; si < kfs.length - 1; si++) {
      const kfA = kfs[si], kfB = kfs[si + 1];
      const dHi = kfB.frame - (si < kfs.length - 2 ? 1 : 0);
      const from = Math.max(kfA.frame, domainLo + 1);
      const to = Math.min(dHi, domainHi);
      if (to < from) continue;
      const y0 = letterBot + (from - domainLo - 1) * rowH;
      const y1 = letterBot + (to - domainLo) * rowH;
      if (y0 < yMin) yMin = y0;
      if (y1 > yMax) yMax = y1;
    }
    if (yMax >= yMin) noteRects.push({ entry: e, x0: nx0, x1: nx1, y0: yMin, y1: yMax });
  });

  // The default VERTICAL spots of every note's head/tail labels (the
  // positions they would take before any conflict resolution), for the
  // dynamic label mode: when two notes sit close enough (touching, or one
  // row apart) their boundary labels would overlap EACH OTHER even though
  // neither touches the other note's rows — so both give up the vertical
  // spot and move to the side.
  const labelSpots = [];
  const spotR = Math.min(9, Math.max(6, rowH / 3));
  notes.forEach(e => {
    const lane = Math.max(0, Math.min(n - 1, e.lane));
    const lx = sec.x0 + (lane + 0.5) * colW + ((dxByLane[e.lane] || new Map()).get(e.id) || 0);
    const gFrom = camFrom(e), gTo = camTo(e);
    // only the labels actually DRAWN in this block take part: a note that
    // starts in this block has its head label here, one that ends here
    // its tail label
    if (gFrom >= domainLo + 1 && gFrom <= domainHi) {
      labelSpots.push({ entry: e, x: lx, y: letterBot + (gFrom - domainLo - 1) * rowH - spotR - 2, r: spotR });
    }
    if (gTo >= domainLo + 1 && gTo <= domainHi) {
      labelSpots.push({ entry: e, x: lx, y: letterBot + (gTo - domainLo) * rowH + spotR + 2, r: spotR });
    }
  });

  notes.forEach(entry => {
    const kfs = entry.keyframes;
    const lastKi = kfs.length - 1;
    const lane = Math.max(0, Math.min(n - 1, entry.lane));
    const dx = (dxByLane[entry.lane] || new Map()).get(entry.id) || 0;
    const cx = sec.x0 + (lane + 0.5) * colW + dx;
    const circleR = Math.min(9, Math.max(6, rowH / 3));
    const markT = Math.min(6, rowH / 3);

    if (trackMenuTarget && trackMenuTarget.entryId === entry.id) {
      fillTrackHighlight(sec.x0 + lane * colW, sec.x0 + (lane + 1) * colW, camFrom(entry), camTo(entry), domainLo, letterBot);
    }

    // ---- one segment per consecutive keyframe pair (A→B, B→C, …) ----
    for (let si = 0; si < lastKi; si++) {
      const kfA = kfs[si], kfB = kfs[si + 1];
      const gFrom = kfA.frame, gTo = kfB.frame;
      // A segment runs up to (but NOT into) the next keyframe's own cell
      // — so consecutive segments meet exactly at the keyframe line, where
      // the keyframe diamond sits, and shapes never cover the diamond
      // above them. The LAST segment keeps its full run (its ▲ sits on
      // the bottom edge).
      const dHi = gTo - (si < lastKi - 1 ? 1 : 0);
      const from = Math.max(gFrom, domainLo + 1);
      const to = Math.min(dHi, domainHi);
      if (to < from) continue;
      const isStart = from === gFrom && si === 0;
      const isEnd = to === dHi && si === lastKi - 1;
      const y0 = letterBot + (from - domainLo - 1) * rowH;
      const y1 = letterBot + (to - domainLo) * rowH;
      // the segment's TRUE vertical center — the name label renders in
      // whichever block holds that frame
      const midG = (gFrom + dHi) / 2;
      const isMid = midG >= from && midG <= to;
      const nameY = letterBot + (midG - domainLo - 0.5) * rowH;
      const type = kfA.type;
      const name = kfA.name || type;

      // special polygon shapes draw instead of the plain guide line;
      // their top/bottom edges pull clear of the keyframe diamonds that
      // sit on the segment's boundary lines
      if (isCameraShapeType(type)) {
        // shape notes (OL / FI / FO / WI / WO / focus…) are one continuous
        // effect — no keyframe diamonds between segments, and the polygon
        // fills the FULL cell height edge-to-edge (the triangle tells the
        // opacity ramp 100%→0% over the whole span), so no insets here
        drawCameraShape(type, cx, y0, y1, rowH, colW, 0, 0);
        // shapes get the circled A/B endpoint names as solid badges pinned
        // to the note's top/bottom rows (the polygon fills the lane, so
        // there is no room beside it) — the FIRST keyframe's label rides
        // the start segment's top, the LAST keyframe's label the end
        // segment's bottom, so a crossing note shows its B in the block
        // it actually ends in
        // A/B ride the note's top/bottom rows on the shape's RIGHT side,
        // pulled just INSIDE the lane so the badge's white bg overlaps the
        // polygon (visible over the fill instead of floating on the white
        // paper outside the lane)
        const bx = cx + colW / 2 - circleR - 3;
        if (isStart && kfs[0].label) drawKeyframeLabel(kfs[0].label, cx, bx, y0 + rowH / 2, y0, entry, polyRects, noteRects, labelSpots, letterBot, circleR, 'above', true);
        if (isEnd && kfs[lastKi].label) drawKeyframeLabel(kfs[lastKi].label, cx, bx, y1 - rowH / 2, y1, entry, polyRects, noteRects, labelSpots, letterBot, circleR, 'below', true);
        // the name label sits at this segment's TRUE center, tucked just
        // right of the polygon's narrow waist (widest at its middle is a
        // wedge's half-width, which dx=14 clears)
        if (isMid) drawCameraNoteLabel(name, cx, nameY, nameY, rowH, 1, 14);
        cameraSegRegions.push({ entry, page, blockId, segIndex: si, x0: sec.x0 + lane * colW, x1: sec.x0 + (lane + 1) * colW, y0, y1 });
        continue;
      }

      // guide line + end markers per type — the manual's camera symbols:
      // every line-style note (PAN, Follow, TU, TB, QTU, QTB, legacy ▲)
      // carries the same small triangle at each end that is HALF of the
      // keyframe marker, sitting inside the note (▼ at the top edge, ▲ at
      // the bottom edge — the flat base sits on the edge, the point faces
      // into the note, never past its bounds); QTU/QTB additionally get a
      // circled ア mark (user-positionable) with a dash and a curve arcing
      // toward the bottom keyframe B; ハンディぶれ is a handheld zigzag
      // with its name on the right; and any other directive stays a plain
      // line. Legacy - keeps its old dash look.
      const cType = String(type || '').trim();
      const isShake = cType === 'ハンディぶれ';
      // every line-style camera note uses the same PAN half-keyframe markers
      // (TU/TB included, per the studio's convention)
      const isPanLike = cType === 'PAN' || cType === 'Follow' || cType === '▲' || cType === 'QTU' || cType === 'QTB' || cType === 'TU' || cType === 'TB';
      const isQuick = cType === 'QTU' || cType === 'QTB';

      ctx.save();
      ctx.fillStyle = '#111111';
      ctx.strokeStyle = '#111111';
      if (isShake) {
        // handheld shake: a zigzag line down the span (the standard symbol)
        const amp = Math.max(4, Math.min(8, colW / 4.5));
        const step = Math.max(5, rowH * 0.45);
        ctx.lineWidth = LW_NORMAL + 0.5;
        ctx.beginPath();
        ctx.moveTo(cx, y0);
        let zig = true;
        for (let zy = y0 + step; zy < y1; zy += step) {
          ctx.lineTo(cx + (zig ? amp : -amp), zy);
          zig = !zig;
        }
        ctx.lineTo(cx, y1);
        ctx.stroke();
      } else if (cType === '-') {
        // legacy dash markers
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx - 4, y0 + 2);
        ctx.lineTo(cx + 4, y0 + 2);
        ctx.moveTo(cx - 4, y1 - 2);
        ctx.lineTo(cx + 4, y1 - 2);
        ctx.stroke();
      } else {
        line(cx, y0, cx, y1, LW_NORMAL + 0.5);
        const t = markT;
        const triIn = (px, py, dir) => {
          // base ON the note edge, apex inside: +1 ▼ (apex below the edge),
          // -1 ▲ (apex above the edge) — the keyframe mark flipped so its
          // point faces into the note and never pokes past its bounds.
          // Height = t, exactly HALF of the diamond keyframe (base 2t,
          // height 2t) cut horizontally — ▼ is the diamond's top half,
          // ▲ its bottom half.
          ctx.beginPath();
          ctx.moveTo(px - t, py);
          ctx.lineTo(px + t, py);
          ctx.lineTo(px, py + dir * t);
          ctx.closePath();
          ctx.fill();
        };
        if (isPanLike) {
          // the half-keyframe markers belong to the note's real start/end:
          // ▼ only in the start segment, ▲ only in the final segment — a
          // crossing note shows plain continuation lines in between
          if (isStart) triIn(cx, y0, 1);   // ▼ at the top edge, point into the note
          if (isEnd) triIn(cx, y1, -1);   // ▲ at the bottom edge
        }
        // QTU/QTB: a circled ア on the RIGHT of the line at the
        // animation-start row (kfA.aFrame — draggable on the sheet /
        // typeable in the popup), a RED dash sitting exactly on that
        // row's grid line (not mid-cell), and a wide curve arcing from
        // the dash toward the bottom keyframe (B). Per the manual the
        // quick-truck mark is the PAN line plus this ア annotation.
        // Drawn only in the block that holds the ア's own frame (a
        // quick segment crossing blocks shows it once, where it is).
        const aG = (kfA.aFrame && kfA.aFrame >= gFrom && kfA.aFrame <= gTo) ? kfA.aFrame : gFrom + 1;
        if (isQuick && aG >= domainLo + 1 && aG <= domainHi) {
          const dashY = letterBot + (aG - domainLo - 1) * rowH; // the row's grid line
          const aY = dashY;                          // ア sits ON the dash
          const aruX = cx + circleR + 8;
          ctx.save();
          ctx.strokeStyle = '#111111';
          ctx.lineWidth = 1.1;
          // wide curve from the dash arcing toward B (bow on the right)
          ctx.beginPath();
          const bow = Math.min(20, Math.max(12, colW * 0.3));
          ctx.moveTo(cx, dashY);
          ctx.quadraticCurveTo(cx + bow, (dashY + y1) / 2, cx, y1);
          ctx.stroke();
          // red dash exactly on the grid line at the ア's row
          ctx.strokeStyle = '#cc0000';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(cx - 5, dashY);
          ctx.lineTo(cx + 5, dashY);
          ctx.stroke();
          // the circled ア, same look as the A/B endpoint labels
          drawCameraEndpointCircle('\u30A2', aruX, aY, circleR);
          ctx.restore();
          cameraAruRegions.push({ entry, page, blockId, segIndex: si, x: aruX, y: aY, r: circleR });
        }
      }
      ctx.restore();

      // circled endpoint names (A/B convention): the FIRST keyframe's
      // label rides the start segment's top, the LAST keyframe's label
      // the end segment's bottom — a crossing note shows its B in the
      // block it actually ends in
      if (isStart && kfs[0].label) {
        drawKeyframeLabel(kfs[0].label, cx, cx + markT + circleR + 3, y0 + rowH / 2, y0, entry, polyRects, noteRects, labelSpots, letterBot, circleR, 'above', false);
      }
      if (isEnd && kfs[lastKi].label) {
        drawKeyframeLabel(kfs[lastKi].label, cx, cx + markT + circleR + 3, y1 - rowH / 2, y1, entry, polyRects, noteRects, labelSpots, letterBot, circleR, 'below', false);
      }
      // the red name label sits at this segment's TRUE center — if that
      // lands in another block it is drawn there; the shake name is
      // pushed a touch further so the zigzag teeth (which reach cx + amp)
      // stay clear
      if (isMid) drawCameraNoteLabel(name, cx, nameY, nameY, rowH, 1, isShake ? 12 : null);

      // hover handle for this segment's time adjustments (top/bottom
      // edges resize the neighboring keyframes, middle moves the note)
      if (trackHover && trackHover.kind === 'camera' && trackHover.page === page && trackHover.entryId === entry.id && trackHover.mode !== 'kf') {
        drawTrackHandle(sec.x0 + lane * colW, sec.x0 + (lane + 1) * colW, y0, y1, trackHover.mode, rowH);
      }

      // hit region = this segment's lane box (clicks select the segment
      // for editing; a drag can move the note across lanes)
      cameraSegRegions.push({ entry, page, blockId, segIndex: si, x0: sec.x0 + lane * colW, x1: sec.x0 + (lane + 1) * colW, y0, y1 });
    }

    // ---- middle keyframes: diamond marker + circled label ----
    // The diamond sits ON the frame grid line at the TOP of its cell
    // (letterBot + (frame-1)*rowH) — the same line where the following
    // segment's guide line starts, so the note reads as one continuous
    // line with the keyframe markers pinned to the exact frame rows
    // (matching the ▼/ア "top of cell" convention).
    //
    // SHAPE notes (OL / FI / FO / WI / WO / focus…) are one continuous
    // effect — their segments meet edge-to-edge at this line, so the
    // diamond (and its circled label) is skipped when either neighboring
    // segment is a shape. The keyframe still exists (editable in the
    // popup) and its hover ring stays, so the boundary stays adjustable.
    for (let ki = 1; ki < lastKi; ki++) {
      const kf = kfs[ki];
      if (kf.frame < domainLo + 1 || kf.frame > domainHi) continue;
      const ky = letterBot + (kf.frame - domainLo - 1) * rowH;
      const isShapeBoundary = isCameraShapeType(kfs[ki - 1].type) || isCameraShapeType(kfs[ki].type);
      const s = markT;
      if (!isShapeBoundary) {
        // solid black (the full keyframe symbol; the ▼/▲ at the note's ends
        // are its halves).
        ctx.save();
        ctx.fillStyle = '#111111';
        ctx.beginPath();
        ctx.moveTo(cx, ky - s);
        ctx.lineTo(cx + s, ky);
        ctx.lineTo(cx, ky + s);
        ctx.lineTo(cx - s, ky);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        if (kf.label) drawKeyframeLabel(kf.label, cx, cx + markT + circleR + 3, ky, ky, entry, polyRects, noteRects, labelSpots, letterBot, circleR, 'mid', false);
      } else if (kf.label) {
        // Shape segment boundary: no black diamond over the polygon — just
        // the circled middle label at the lane's right edge (the keyframe
        // boundary stays visible/editable via its hover ring below).
        drawKeyframeLabel(kf.label, cx, cx + markT + circleR + 3, ky, ky, entry, polyRects, noteRects, labelSpots, letterBot, circleR, 'mid', false);
      }
      // hover affordance: a ring around this keyframe (drag to move it)
      if (trackHover && trackHover.kind === 'camera' && trackHover.page === page && trackHover.entryId === entry.id &&
        trackHover.mode === 'kf' && trackHover.kfIndex === ki) {
        ctx.save();
        ctx.strokeStyle = 'rgba(0, 122, 255, 0.9)';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(cx, ky, circleR + 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      cameraKeyRegions.push({ entry, page, blockId, kfIndex: ki, x: cx, y: ky, r: circleR + 4 });
    }
  });
}

function drawBlock(blockId, page, xOff, GRID_TOP) {
  const x0 = getBlockX(blockId) + (xOff || 0);
  // this block's page-local frame/second offsets (page = 0-indexed)
  const frameOffset = page * ROWS * 2 + (blockId === 0 ? 0 : ROWS);
  const secondStart = page * 6 + (blockId === 0 ? 1 : 4);
  const band = getHeaderBand(GRID_TOP, blockId);
  GRID_TOP = band.top; // pick up wholeOffset/blockOffset/headerOffset so the
  // top border line (and everything else that uses
  // GRID_TOP below) moves along with those overrides
  const LETTER_BOT = band.bottom;
  const GRID_BOT = LETTER_BOT + ROWS * getRowH();

  const SECTIONS = buildSections(blockId);
  const totalWidth = SECTIONS.reduce((s, sec) => s + sec.width, 0);
  const x1 = x0 + totalWidth;

  // lay out each visible section's own x-range. The accumulator (acc)
  // tracks the plain FLOW position — a section's own manual move offset
  // never shifts where the next section starts, so nudging one section
  // never displaces its neighbors.
  let acc = x0;
  const laidOut = SECTIONS.map(sec => {
    const flowX0 = acc;
    const flowX1 = acc + sec.width;
    acc = flowX1;
    const dx = (state.layout.sectionOffset[blockId + ':' + sec.name] || { x: 0 }).x;
    return Object.assign({}, sec, { x0: flowX0 + dx, x1: flowX1 + dx });
  });

  // NOTE: every horizontal grid line — the header/letter dividers AND the
  // 72 individual frame-row lines — is now drawn PER SECTION, using only
  // that section's own x0..x1 span. Nothing here is a single line shared
  // across sections any more; each column owns its own lines completely.
  // LETTER_BOT (where the frame grid starts) IS still shared across every
  // section in this block, so the 72 frame rows stay aligned no matter
  // how each section's own header/letter split is customized.

  // data draws run at FULL alpha — the grid/headers fade under tableOpacity
  // (renderPage's structureAlpha) but entered content stays solid
  const drawData = fn => { ctx.save(); ctx.globalAlpha = 1; fn(); ctx.restore(); };

  laidOut.forEach((sec, idx) => {
    const isSound = sec.name === 'SOUND';
    const isFirst = idx === 0;
    const isLast = idx === laidOut.length - 1;
    const TITLE_BOT = getTitleSplitY(blockId, sec.name, band);

    // ---- every visible section gets its own complete 4-side border,
    //      drawn independently of its neighbors and of any row toggle ----
    line(sec.x0, GRID_TOP, sec.x1, GRID_TOP, LW_NORMAL);                   // top
    line(sec.x0, GRID_TOP, sec.x0, GRID_BOT, isFirst ? LW_NORMAL : 1.5);   // left
    line(sec.x1, GRID_TOP, sec.x1, GRID_BOT, isLast ? LW_NORMAL : 1.5);    // right

    if (isSound) {
      // SOUND has no letter row and no internal frame grid at all (kept
      // gridless, matching the original sheet) — its own top/bottom lines
      // and label only appear when its header is shown; everything about
      // SOUND lives or dies with that single toggle. The column's frame
      // grid stays INVISIBLE (no lines), but it's still a real grid for
      // click/drag to type dialogue lines.
      if (sec.showHeader) {
        line(sec.x0, LETTER_BOT, sec.x1, LETTER_BOT, 1.5);
        line(sec.x0, GRID_BOT, sec.x1, GRID_BOT, LW_SECOND);
        text('SOUND', sec.x0 + sec.width / 2, (GRID_TOP + LETTER_BOT) / 2 + 1, 9, { bold: false });
      }
      drawData(() => drawSoundDialogue(blockId, page, sec, LETTER_BOT, GRID_BOT));
      // in multi-page view, Customize mode operates on the first page's
      // copy (the values it edits are shared by every page anyway)
      if (customizeMode && (!isMultiRender || page === 0)) {
        layoutHitRegions.push({ level: 2, blockId, name: sec.name, x0: sec.x0, y0: GRID_TOP, x1: sec.x1, y1: GRID_BOT, letterBot: LETTER_BOT });
      }
      return; // no letters/sub-columns/frame-grid lines for SOUND either way
    }

    // every other section always keeps its own bottom border, independent
    // of header/letter state (only SOUND's border is tied to its header)
    line(sec.x0, GRID_BOT, sec.x1, GRID_BOT, LW_SECOND);

    const hasHeader = sec.showHeader;
    const hasLetters = sec.showLetters;

    // internal divider between header band and letter band only exists
    // when BOTH rows are present — otherwise they've merged into one
    if (hasHeader && hasLetters) {
      line(sec.x0, TITLE_BOT, sec.x1, TITLE_BOT, 1.5);
    }

    // letter-row / frame-area divider belongs to THIS section — it only
    // exists if there's still a header or letter row above it; if both
    // are hidden, the blank area above merges straight into the frame
    // grid with no line at all
    if (hasHeader || hasLetters) {
      line(sec.x0, LETTER_BOT, sec.x1, LETTER_BOT, 1.5);
    }

    if (hasHeader) {
      const y = hasLetters ? (GRID_TOP + TITLE_BOT) / 2 + 1 : (GRID_TOP + LETTER_BOT) / 2 + 1;
      const displayName = sectionDisplayName(sec.name);
      // click-to-rename on the sheet: yellow highlight + typed buffer
      const isNameEdit = editingSectionName === sec.name;
      if (isNameEdit) {
        ctx.save();
        ctx.fillStyle = 'rgba(255, 193, 7, 0.35)';
        ctx.fillRect(sec.x0, GRID_TOP, sec.width, (hasLetters ? TITLE_BOT : LETTER_BOT) - GRID_TOP);
        ctx.restore();
      }
      text(isNameEdit && sectionNameBuffer !== null ? sectionNameBuffer : displayName,
        sec.x0 + sec.width / 2, y, displayName.length > 8 ? 10 : 12, { bold: false });
      sectionNameRegions.push({ sec: sec.name, x0: sec.x0, x1: sec.x1, y0: GRID_TOP, y1: hasLetters ? TITLE_BOT : LETTER_BOT });
    }

    if (hasLetters) {
      const y = hasHeader ? (TITLE_BOT + LETTER_BOT) / 2 + 1 : (GRID_TOP + LETTER_BOT) / 2 + 1;
      const n = sec.subLabels.length;
      const colW = sec.width / n;
      const y0 = hasHeader ? TITLE_BOT : GRID_TOP;
      for (let c = 0; c < n; c++) {
        // click-to-rename on the sheet: yellow highlight + typed buffer
        const isColEdit = editingColLabel && editingColLabel.sec === sec.name && editingColLabel.index === c;
        if (isColEdit) {
          ctx.save();
          ctx.fillStyle = 'rgba(255, 193, 7, 0.35)';
          ctx.fillRect(sec.x0 + c * colW, y0, colW, LETTER_BOT - y0);
          ctx.restore();
        }
        text(isColEdit && colLabelBuffer !== null ? colLabelBuffer : sec.subLabels[c],
          sec.x0 + c * colW + colW / 2, y, 11, { bold: true });
        colLabelRegions.push({ sec: sec.name, index: c, x0: sec.x0 + c * colW, x1: sec.x0 + (c + 1) * colW, y0, y1: LETTER_BOT });
      }
    }

    // physical sub-column verticals: this is the real table structure and
    // always exists at the fixed column count, never touched by hiding
    // labels. Only how far UP it extends changes: it reaches into the
    // header band only as far as there's still a per-column row (the
    // letter row) to divide; if letters are hidden it starts at LETTER_BOT,
    // since the band above is then just one shared cell.
    const vertTop = hasLetters ? (hasHeader ? TITLE_BOT : GRID_TOP) : LETTER_BOT;
    const n = sec.subLabels.length;
    const colW = sec.width / n;
    for (let c = 0; c < n; c++) {
      const lx = sec.x0 + c * colW;
      if (!(isFirst && c === 0)) {
        line(lx, vertTop, lx, GRID_BOT, LW_NORMAL);
      }
    }

    // this section's OWN 72-row frame grid, drawn only across its own
    // width — not shared with, or borrowed from, any neighboring section
    for (let r = 1; r <= ROWS; r++) {
      const y = LETTER_BOT + r * getRowH();
      let w = LW_NORMAL;
      if (r % 6 === 0) w = LW_INTERVAL;
      if (r % 24 === 0) w = LW_SECOND;
      line(sec.x0, y, sec.x1, y, w);
    }

    // Keyframe/Breakdown data lives on ACTION (interactive) and INBETWEEN
    // (display-only, filled in by the "Make In-Between" button).
    if (sec.name === 'ACTION' || sec.name === 'INBETWEEN') {
      drawData(() => drawSectionMarks(sec.name, blockId, page, sec.x0, colW, n, LETTER_BOT));
    }
    if (sec.name === 'ACTION') {
      drawData(() => drawBooks(blockId, sec.x0, colW, n, GRID_TOP, LETTER_BOT));
    }
    if (sec.name === 'CAMERA') {
      drawData(() => drawCameraSegments(blockId, page, sec, colW, n, LETTER_BOT, GRID_BOT));
    }

    if (customizeMode && (!isMultiRender || page === 0)) {
      // level 2: this section's whole width; level 4: just its header
      // band (title bar + letter row), where the title/letter split lives
      layoutHitRegions.push({ level: 2, blockId, name: sec.name, x0: sec.x0, y0: GRID_TOP, x1: sec.x1, y1: GRID_BOT, letterBot: LETTER_BOT });
      layoutHitRegions.push({ level: 4, blockId, name: sec.name, x0: sec.x0, y0: GRID_TOP, x1: sec.x1, y1: LETTER_BOT });
    }
  });

  // frame numbers + bold "second" markers — these live at the block level
  // (next to the number column on the left), not inside any one section
  for (let r = 1; r <= ROWS; r++) {
    const cy = LETTER_BOT + (r - 0.5) * getRowH();
    text(String(r + frameOffset), x0 - 8, cy + 1, 10, { align: 'right' });
  }
  [24, 48, 72].forEach((r, i) => {
    const cy = LETTER_BOT + (r - 0.5) * getRowH();
    text(String(secondStart + i), x0 - 40, cy + 1, 13, { bold: true, align: 'center' });
  });

  // Red end-of-shot marker: one line spanning this block's ENTIRE table
  // width (ACTION + SOUND + INBETWEEN + CAMERA), drawn at the exact row
  // where the shot's final frame ends (TIME field), if that boundary
  // falls inside this particular block.
  const cutoffG = Math.round((state.timeSeconds || 0) * 24);
  if (cutoffG > 0) {
    drawData(() => {
    // NOTE: `page` (the block's real page), not state.currentPage — in the
    // all-pages view every page is drawn and each must test its own domain.
    const blockG0 = globalFrameOf(page, blockId, 1);
    const domainLo = blockG0 - 1;
    const domainHi = blockG0 + ROWS - 1;
    // Red end-of-shot line — drawn only in the block that holds the cutoff
    if (cutoffG > domainLo && cutoffG <= domainHi) {
      const y = LETTER_BOT + (cutoffG - domainLo) * getRowH();
      ctx.save();
      ctx.strokeStyle = '#cc0000';
      ctx.lineWidth = LW_SECOND;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y);
      ctx.stroke();
      ctx.restore();
    }

    // Red "/" slash marks, 3 cells below the end-of-time line — a
    // warning-style hatch ("//////") with ONE uniform angle and spacing,
    // not aligned to the columns; each slash's top sits ON the line and
    // descends 3 cells, marking that everything from here on is finished.
    // Rendered in EVERY block its rows touch: when the band crosses into
    // the next block/page it continues there, clipped to that table (like
    // repeat marks and camera notes). Each block anchors the hatch to its
    // own width. Toggle: Header > "Red slash under end-of-time line"
    // (state.showEndSlash).
    if (state.showEndSlash) {
      const rowH = getRowH();
      const h = 3 * rowH;    // full slash height (3 cells)
      const dx = rowH * 1.5; // horizontal run — the same angle everywhere
      const S = dx / 1.5;    // spacing between slash tops — the corner
      // slashes are grid lines too, so every gap
      // (and angle) stays identical
      // the line sits at the bottom edge of row cutoffG, so the band's
      // rows are cutoffG+1 .. cutoffG+3; clip that range to this block
      const from = Math.max(cutoffG + 1, domainLo + 1);
      const to = Math.min(cutoffG + 4, domainHi + 1);
      if (to > from) {
        const yTop = LETTER_BOT + (from - domainLo - 1) * rowH;
        const yBot = LETTER_BOT + (to - domainLo - 1) * rowH;
        const fracFrom = from - cutoffG - 1; // 0 at the line
        const fracTo = to - cutoffG - 1;
        ctx.save();
        ctx.strokeStyle = '#cc0000';
        ctx.lineWidth = 2;
        // ONE uniform family of parallel "/" lines, tops spaced S apart;
        // each slash is the straight segment between this strip's top and
        // bottom, clipped to the table's horizontal span [x0, x1] — the
        // corner slashes come out naturally shorter.
        const n = Math.ceil((x1 + dx - x0) / S);
        for (let i = 0; i <= n; i++) {
          const t = x0 + i * S;
          const xA = t - (dx / 3) * fracFrom;
          const xB = t - (dx / 3) * fracTo;
          const segDx = xB - xA;
          let u0 = 0, u1 = 1;
          if (segDx > 0) {
            u0 = Math.max(u0, (x0 - xA) / segDx);
            u1 = Math.min(u1, (x1 - xA) / segDx);
          } else if (segDx < 0) {
            u0 = Math.max(u0, (x1 - xA) / segDx);
            u1 = Math.min(u1, (x0 - xA) / segDx);
          } else if (xA < x0 || xA > x1) {
            continue;
          }
          if (u1 <= u0) continue; // fully outside the table
          ctx.beginPath();
          ctx.moveTo(xA + u0 * segDx, yTop + u0 * (yBot - yTop));
          ctx.lineTo(xA + u1 * segDx, yTop + u1 * (yBot - yTop));
          ctx.stroke();
        }
        ctx.restore();
      }
    }
    }); // end drawData (TIME cutoff + slash)
  }

  if (customizeMode && (!isMultiRender || page === 0)) {
    // level 1: whole block; level 3: this block's shared header band
    layoutHitRegions.push({ level: 1, blockId, x0, y0: GRID_TOP, x1, y1: GRID_BOT, letterBot: LETTER_BOT });
    layoutHitRegions.push({ level: 3, blockId, x0, y0: GRID_TOP, x1, y1: LETTER_BOT });
  }
}

// render(skipResize) redraws the whole sheet. In 'multi' view mode the
// canvas holds every page stacked vertically (Word-style), so it is
// resized to PAGE_W x PAGE_H*pages (fit-scaled down when a very long
// shot would exceed browser canvas limits). skipResize is used by the
// PNG exporter, which sets its own canvas size + scale before rendering.
function render(skipResize) {
  clampCurrentPage();
  actionHitRegions = [];
  headerCellRegions = [];
  headerLabelRegions = [];
  sectionNameRegions = [];
  colLabelRegions = [];
  layoutHitRegions = [];
  bookHitRegions = [];
  soundAreaRegions = [];
  soundEntryRegions = [];
  cameraAreaRegions = [];
  cameraSegRegions = [];
  cameraKeyRegions = [];
  cameraAruRegions = [];
  memoHitRegions = [];
  dialogueFlows.clear();

  const pages = totalPagesNeeded();
  const multi = viewMode === 'multi' && pages > 1;
  isMultiRender = multi;
  // multi view: transparent canvas (no page-card frame around the stack);
  // single view keeps the CSS white page background/radius/shadow
  canvas.classList.toggle('multi-view', multi);
  // multi view lays pages out two per row (Word-style) with a gap; the
  // whole stack is fit-scaled down when it would exceed browser canvas
  // limits along either axis
  let fitScale = 1;
  let totalW = PAGE_W, totalH = PAGE_H;
  if (multi) {
    const size = multiTotalSize(pages);
    totalW = size.w;
    totalH = size.h;
    fitScale = Math.min(1, MAX_MULTI_DIM / totalW, MAX_MULTI_DIM / totalH);
  }
  renderScale = fitScale;
  if (!skipResize) {
    canvas.width = Math.max(1, Math.round(totalW * fitScale));
    canvas.height = Math.max(1, Math.round(totalH * fitScale));
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // NO desk background at all — the canvas stays transparent (in multi
  // view the .multi-view class also drops the CSS white bg / radius /
  // shadow), so the gaps between pages show the app's own background
  // and the sheets float directly on it. Each sheet is still a white
  // page, outlined in multi view so the pages read as separate sheets.
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#000000';
  ctx.strokeStyle = '#000000';
  if (fitScale !== 1) ctx.scale(fitScale, fitScale);

  // vertical shift applied when the top header table is hidden, so the
  // grid moves up to fill the freed space (same layout otherwise)
  const shift = state.showHeaderTable ? 0 : (HDR_BOT - HDR_TOP);
  const GRID_TOP_BASE_SHIFT = GRID_TOP_BASE - shift;

  // Draws ONE complete sheet page (header table + memo + both blocks) at
  // canvas offset (xOff, yOff), then tags it with a "Page N" badge — the
  // current page's badge is highlighted blue.
  const renderPage = (page, xOff, yOff) => {
    // ---- imported paper image: drawn FIRST, under the sheet ----
    if (state.paper.dataUrl && state.paper.visible !== false && state.paper.w > 0) {
      const im = getPaperImage();
      if (im && im.complete && im.naturalWidth) {
        ctx.drawImage(im, xOff + state.paper.x, yOff + state.paper.y, state.paper.w, state.paper.h);
      }
    }

    // the STRUCTURE (white sheet + grid lines + header table + memo border)
    // draws at tableOpacity so the paper below shows through when the slider
    // is below 100%. The DATA (marks, dialogue, camera, memo text) stays
    // solid — drawBlock and the memo text wrap themselves in globalAlpha = 1
    // (see drawData). In Customize mode the structure never drops below 25%,
    // so the table skeleton stays visible to drag even at opacity 0.
    const structureAlpha = customizeMode ? Math.max(state.tableOpacity, 0.25) : state.tableOpacity;
    ctx.save();
    ctx.globalAlpha = structureAlpha;
    // the white sheet itself, sitting on the white desk (gaps = desk)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(xOff, yOff, PAGE_W, PAGE_H);
    // CRITICAL: reset the fill back to black — the white fill above left
    // fillStyle white, which made every text() call draw white-on-white
    // (invisible headers/labels) until reset here
    ctx.fillStyle = '#000000';
    if (multi) {
      // thin outline per sheet so pages stay distinct across white gaps
      ctx.save();
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.16)';
      ctx.lineWidth = 1;
      ctx.strokeRect(xOff + 0.5, yOff + 0.5, PAGE_W - 1, PAGE_H - 1);
      ctx.restore();
    }

    if (state.showHeaderTable) {
      const geo = getHeaderTableGeometry(xOff, yOff);
      rect(geo.x0, geo.y0, geo.x1 - geo.x0, geo.y1 - geo.y0, 2);
      line(geo.x0, geo.yMid, geo.x1, geo.yMid, 1.5);
      for (let i = 0; i < HEADER_LABELS.length; i++) {
        const x0 = geo.colXs[i], x1 = geo.colXs[i + 1];
        const isTime = HEADER_LABELS[i] === 'TIME';
        const isPage = HEADER_LABELS[i] === 'PAGE';
        if (i > 0) line(x0, geo.y0, x0, geo.y1, 1.5);
        // click-to-rename on the sheet: the label's half highlights while
        // typing the new name (mirrors section-header rename)
        const isLabelEdit = editingHeaderLabel === i;
        const labelText = isLabelEdit && headerLabelBuffer !== null ? headerLabelBuffer : headerDisplayName(HEADER_LABELS[i]);
        if (isLabelEdit) {
          ctx.save();
          ctx.fillStyle = 'rgba(255, 193, 7, 0.35)';
          ctx.fillRect(x0, geo.y0, x1 - x0, geo.yMid - geo.y0);
          ctx.restore();
        }
        text(labelText, (x0 + x1) / 2, (geo.y0 + geo.yMid) / 2 + 1, 13, { bold: false });

        headerCellRegions.push({ index: i, label: HEADER_LABELS[i], x0, y0: geo.yMid, x1, y1: geo.y1 });
        headerLabelRegions.push({ index: i, label: HEADER_LABELS[i], x0, y0: geo.y0, x1, y1: geo.yMid });

        const isEditing = editingHeaderIndex === i;
        if (isEditing) {
          ctx.save();
          ctx.fillStyle = 'rgba(255, 193, 7, 0.35)';
          ctx.fillRect(x0, geo.yMid, x1 - x0, geo.y1 - geo.yMid);
          ctx.restore();
        }
        let displayVal;
        if (isTime) {
          displayVal = isEditing && headerEditBuffer !== null ? headerEditBuffer
            : (state.timeSeconds > 0 ? formatTimeDisplay(state.timeSeconds) : '');
        } else if (isPage) {
          // PAGE is auto-computed: current page / total pages (e.g. 1/3)
          displayVal = (state.currentPage + 1) + '/' + totalPagesNeeded();
        } else {
          displayVal = isEditing && headerEditBuffer !== null ? headerEditBuffer : (state.headerValues[HEADER_LABELS[i]] || '');
        }
        // title VALUES are data — stay solid at tableOpacity<1, matching the
        // marks/dialogue below (only the labels + grid lines fade)
        if (displayVal) {
          ctx.save(); ctx.globalAlpha = 1;
          text(displayVal, (x0 + x1) / 2, (geo.yMid + geo.y1) / 2 + 1, isTime ? 14 : 13, { bold: isTime });
          ctx.restore();
        }

        if (customizeMode && (!multi || page === 0)) {
          layoutHitRegions.push({ level: 'titleCell', cell: i, x0, y0: geo.y0, x1, y1: geo.y1 });
        }
      }
      if (customizeMode && (!multi || page === 0)) {
        layoutHitRegions.push({ level: 'titleWhole', x0: geo.x0, y0: geo.y0, x1: geo.x1, y1: geo.y1 });
      }
    }

    // --- Memo box (between the header table and the main grid) ---
    if (state.showHeaderTable) {
      const memoGeo = getMemoGeometry(xOff, yOff);
      const showLabel = state.memo.showLabel !== false;
      const showBorder = state.memo.showBorder !== false;
      if (showBorder) {
        rect(memoGeo.x0, memoGeo.y0, memoGeo.x1 - memoGeo.x0, memoGeo.y1 - memoGeo.y0, 1.5);
      }
      if (showLabel) {
        text(sectionDisplayName('MEMO'), memoGeo.x0 + 6, memoGeo.y0 + 12, 9, { align: 'left' });
      }
      memoHitRegions.push({ page, x0: memoGeo.x0, y0: memoGeo.y0, x1: memoGeo.x1, y1: memoGeo.y1 });

      const memoPad = 8;
      const memoFontSize = 13;
      ctx.font = `${memoFontSize}px Arial, Helvetica, sans-serif`;
      const memoDisplayText = editingMemo && memoEditBuffer !== null ? memoEditBuffer : state.memo.text;
      const memoLines = wrapMemoText(memoDisplayText, (memoGeo.x1 - memoGeo.x0) - memoPad * 2);
      const memoLineH = memoFontSize * 1.4;
      const memoTextTop = showLabel ? memoGeo.y0 + 24 : memoGeo.y0 + 16;
      // While editing, the overlay textarea covers this spot and shows the
      // live text + caret itself — skip drawing text here so it doesn't
      // show through the editor's edges. The blue outline below still marks
      // the active editing box.
      if (!editingMemo) {
        ctx.save(); ctx.globalAlpha = 1; // memo text stays solid
        memoLines.forEach((ln, i) => {
          const ly = memoTextTop + i * memoLineH;
          if (ly < memoGeo.y1 - 4) text(ln, memoGeo.x0 + memoPad, ly, memoFontSize, { align: 'left' });
        });
        ctx.restore();
      }
      if (editingMemo) {
        ctx.save();
        ctx.strokeStyle = '#007aff';
        ctx.lineWidth = 2;
        ctx.strokeRect(memoGeo.x0, memoGeo.y0, memoGeo.x1 - memoGeo.x0, memoGeo.y1 - memoGeo.y0);
        ctx.restore();
      }
      if (customizeMode && (!multi || page === 0)) {
        layoutHitRegions.push({ level: 'memoWhole', x0: memoGeo.x0, y0: memoGeo.y0, x1: memoGeo.x1, y1: memoGeo.y1 });
      }
    }

    // paper image hit region is page-independent — push even when the
    // header table is hidden (same region the drawing code above uses)
    if (customizeMode && (!multi || page === 0) && state.paper.dataUrl && state.paper.visible !== false && state.paper.w > 0) {
      layoutHitRegions.push({
        level: 'paperWhole',
        x0: xOff + state.paper.x, y0: yOff + state.paper.y,
        x1: xOff + state.paper.x + state.paper.w, y1: yOff + state.paper.y + state.paper.h
      });
    }

    const GRID_TOP = GRID_TOP_BASE_SHIFT + yOff;
    drawBlock(0, page, xOff, GRID_TOP);
    drawBlock(1, page, xOff, GRID_TOP);
    // end of the table-alpha group; the multi outline + Page badge above
    // stay solid
    ctx.restore();

    // "Page N" badge floats in the gap ABOVE the sheet — off the paper,
    // so it never covers the header/title — and only in the all-pages
    // view (single-page view already shows the page number in the top
    // bar). The current page's badge is highlighted so it stands out.
    if (multi) {
      const isCur = page === state.currentPage;
      const tagText = 'Page ' + (page + 1);
      const tagFont = 13;
      ctx.font = `bold ${tagFont}px Arial, Helvetica, sans-serif`;
      const tagW = ctx.measureText(tagText).width + 16;
      const tagH = 22;
      const tagX = xOff + PAGE_W - tagW - 24;
      const tagY = yOff - PAGE_GAP + 13;
      ctx.save();
      ctx.fillStyle = isCur ? 'rgba(0, 122, 255, 0.95)' : 'rgba(255, 255, 255, 0.92)';
      ctx.strokeStyle = isCur ? '#007aff' : 'rgba(0, 0, 0, 0.22)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(tagX, tagY, tagW, tagH, 6);
      else ctx.rect(tagX, tagY, tagW, tagH);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = isCur ? '#ffffff' : '#111111';
      ctx.textAlign = 'center';
      ctx.fillText(tagText, tagX + tagW / 2, tagY + tagH / 2 + 0.5);
      ctx.restore();
    }
  };

  if (multi) {
    for (let p = 0; p < pages; p++) {
      const pos = multiPagePos(p);
      renderPage(p, pos.x, pos.y);
    }
  } else {
    renderPage(state.currentPage, 0, 0);
  }

  if (customizeMode) {
    const b0 = layoutHitRegions.find(r => r.level === 1 && r.blockId === 0);
    const b1 = layoutHitRegions.find(r => r.level === 1 && r.blockId === 1);
    if (b0 && b1) {
      layoutHitRegions.push({
        level: 0,
        x0: Math.min(b0.x0, b1.x0), y0: Math.min(b0.y0, b1.y0),
        x1: Math.max(b0.x1, b1.x1), y1: Math.max(b0.y1, b1.y1)
      });
    }
    drawLayoutSelectionOverlay();
  }

  // Drag feedback (on top): highlight the drop target and ghost the mark
  // being dragged — the whole group for a multi-selection drag, each
  // member previewed at its origin + delta.
  if (markDrag && markDrag.moved) {
    if (markDrag.targetCell) {
      const t = markDrag.targetCell;
      const region = actionHitRegions.find(r => r.blockId === t.blockId && r.page === t.page);
      if (region) {
        ctx.save();
        ctx.fillStyle = 'rgba(255, 193, 7, 0.35)';
        ctx.fillRect(region.x0 + t.col * region.colW, region.letterBot + (t.row - 1) * region.rowH, region.colW, region.rowH);
        ctx.restore();
      }
    }
    ctx.save();
    ctx.fillStyle = '#000000';
    if (markDrag.group) {
      const region = actionHitRegions.find(r => r.blockId === markDrag.blockId && r.page === markDrag.page);
      const dCol = markDrag.dCol || 0, dRow = markDrag.dRow || 0;
      for (const m of markDrag.group) {
        const cc = m.cell.col + dCol, rr = m.cell.row + dRow;
        if (region) {
          ctx.fillStyle = 'rgba(255, 193, 7, 0.25)';
          ctx.fillRect(region.x0 + cc * region.colW, region.letterBot + (rr - 1) * region.rowH, region.colW, region.rowH);
          ctx.fillStyle = '#000000';
        }
        drawMark(region.x0 + cc * region.colW + region.colW / 2, region.letterBot + (rr - 0.5) * region.rowH, markDrag.size, m.mark);
      }
    } else {
      drawMark(markDrag.x, markDrag.y, markDrag.size, markDrag.mark);
    }
    ctx.restore();
  }

  // Excel-style drag-to-fill: while the fill handle is being dragged,
  // ghost the marks the fill will write (highlight + faded copy).
  if (fillDrag && fillDrag.moved && fillDrag.preview) {
    const region = actionHitRegions.find(r => r.blockId === fillDrag.blockId && r.page === fillDrag.page);
    if (region) {
      const size = Math.min(getRowH(), region.colW) * 0.42;
      for (const p of fillDrag.preview) {
        ctx.save();
        ctx.fillStyle = 'rgba(255, 193, 7, 0.18)';
        ctx.fillRect(region.x0 + p.col * region.colW, region.letterBot + (p.row - 1) * region.rowH, region.colW, region.rowH);
        ctx.restore();
        ctx.save();
        ctx.globalAlpha = 0.55;
        drawMark(region.x0 + p.col * region.colW + region.colW / 2, region.letterBot + (p.row - 0.5) * region.rowH, size, p.mark);
        ctx.restore();
      }
    }
  } else if (selectedCell && !customizeMode && state.activeTool === 'select') {
    // the fill handle itself: a small square at the bottom-right corner
    // of the selection's bounding box
    const rect = selectionRect();
    if (rect) {
      const region = actionHitRegions.find(r => r.blockId === rect.blockId && r.page === rect.page);
      if (region) {
        const x = region.x0 + (rect.hiC + 1) * region.colW;
        const y = region.letterBot + rect.hiR * region.rowH;
        const s = Math.max(7, Math.min(region.colW, region.rowH) * 0.3);
        ctx.save();
        ctx.fillStyle = '#007aff';
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.rect(x - s / 2, y - s / 2, s, s);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  // Freehand pen annotations — drawn last so they sit on top of the
  // sheet. Strokes are stored per page in canvas coordinates; in multi
  // view each page's strokes render on their own page's copy.
  for (const s of state.ink) {
    if (!s.points.length) continue;
    let pos = null;
    if (multi) pos = (s.page >= 0 && s.page < pages) ? multiPagePos(s.page) : null;
    else if (s.page === state.currentPage) pos = { x: 0, y: 0 };
    if (!pos) continue;
    const pts = (pos.x || pos.y) ? s.points.map(p => [p[0] + pos.x, p[1] + pos.y]) : s.points;
    ctx.strokeStyle = s.color;
    ctx.lineWidth = s.width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (pts.length === 1) {
      // a tap: draw a dot instead of a zero-length path
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(pts[0][0], pts[0][1], Math.max(1.5, s.width / 2), 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.stroke();
    }
  }

  refreshPageLabel();
  syncHeaderValueInputs();
  buildColumnShorthandInputs();
  buildTrackTextareas();
  buildBookList();
  updateLayoutSidebar();
}

