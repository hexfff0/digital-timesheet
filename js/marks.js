// ==== marks.js ====
// ==== Make In-Between generator + global-frame <-> (page/block/row) mapping.
// ==== =============================================================

// "Make In-Between": reads every ACTION column across the WHOLE shot
// (all pages) and writes a freshly renumbered sequence into the
// same-lettered INBETWEEN column.
//
// If the column has at least one repeating cycle (the SAME smallest
// number appears at least twice), that repeat interval becomes a
// template — both which frames have marks (spacing) and what number
// each one gets, wrapping back to the smallest number every cycle. That
// same template is used to renumber EVERY mark in the column (before,
// between, and after the detected cycle), and — if a リピート mark is
// present — to keep auto-generating new marks forward from there,
// following the same repeating pattern, until a 止め mark is hit or the
// shot ends. 止め freezes generation (no more inbetweens after it).
//
// Without a detected repeat, it falls back to simple sequential
// numbering (continuing from whatever number the first mark had).
// "x" is preserved as-is and never consumes a number either way.
// Keyframe/breakdown keep their shape (with the NEW number) only if
// "carry symbols" is on; otherwise everything becomes a plain number.
function makeInBetween() {
  const cols = state.sections.ACTION.columns;
  const pages = totalPagesNeeded();
  const lastFrame = pages * ROWS * 2; // one past the last reachable global frame

  const mod = (n, m) => ((n % m) + m) % m;

  for (let c = 0; c < cols; c++) {
    // clear this column's existing INBETWEEN content before regenerating
    for (let p = 0; p < pages; p++) {
      for (let b = 0; b < 2; b++) {
        for (let r = 1; r <= ROWS; r++) {
          delete state.inbetweenMarks[ibMarkKey(p, b, c, r)];
        }
      }
    }

    // gather ACTION's marks across the whole shot, tagged with their
    // global frame number, in chronological order
    const entries = [];
    for (let p = 0; p < pages; p++) {
      for (let b = 0; b < 2; b++) {
        for (let r = 1; r <= ROWS; r++) {
          const m = getEffectiveMark(p, b, c, r);
          if (m) entries.push({ g: globalFrameOf(p, b, r), mark: m });
        }
      }
    }
    if (entries.length === 0) continue;

    const writeAt = (g, markObj) => {
      const seg = frameToSegment(g);
      state.inbetweenMarks[ibMarkKey(seg.page, seg.blockId, c, seg.row)] = markObj;
    };
    const carryType = (origType) => {
      const carryShape = state.inbetweenCarrySymbols && (origType === 'keyframe' || origType === 'breakdown');
      return carryShape ? origType : 'plain';
    };

    const numericEntries = entries.filter(e => {
      if (['x', '.', 'repeat', 'stop'].includes(e.mark.type)) return false;
      return !isNaN(parseInt(e.mark.number, 10));
    });
    let minVal = null, anchors = [];
    if (numericEntries.length > 0) {
      minVal = Math.min(...numericEntries.map(e => parseInt(e.mark.number, 10)));
      anchors = numericEntries.filter(e => parseInt(e.mark.number, 10) === minVal);
    }

    const repeatEntry = entries.find(e => e.mark.type === 'repeat');
    const stopEntry = entries.find(e => e.mark.type === 'stop' && (!repeatEntry || e.g > repeatEntry.g));

    if (anchors.length >= 2) {
      // ---- cycle/template mode ----
      const g1 = anchors[0].g, g2 = anchors[1].g;
      const cycleLen = g2 - g1;

      const spanEntries = entries.filter(e => e.g >= g1 && e.g < g2).sort((a, b) => a.g - b.g);
      const template = []; // { offset, slot, type }, in cycle order
      spanEntries.forEach(e => {
        if (['x', 'repeat', 'stop'].includes(e.mark.type)) return;
        template.push({ offset: e.g - g1, slot: template.length, type: e.mark.type });
      });
      const slotByOffset = {};
      template.forEach(t => { slotByOffset[t.offset] = t; });

      // renumber every existing mark (before g1, inside, and after g2)
      // using the template
      entries.forEach(e => {
        if (e.mark.type === 'x') { writeAt(e.g, { type: 'x', number: '' }); return; }
        if (e.mark.type === 'repeat' || e.mark.type === 'stop') return; // handled below
        const rel = mod(e.g - g1, cycleLen);
        const t = slotByOffset[rel];
        if (t) {
          writeAt(e.g, { type: carryType(e.mark.type), number: String(minVal + t.slot) });
        } else {
          // spacing that doesn't match the detected template — keep its
          // own number rather than silently dropping it
          const parsed = parseInt(e.mark.number, 10);
          writeAt(e.g, { type: carryType(e.mark.type), number: !isNaN(parsed) ? String(parsed) : '' });
        }
      });

      // リピート itself isn't written to INBETWEEN — it's purely a trigger
      // telling generation to keep following the template from its frame
      // position onward (that position gets whatever the template says,
      // same as any other frame).
      if (repeatEntry) {
        const stopG = stopEntry ? stopEntry.g : null;
        for (let g = repeatEntry.g; g < lastFrame; g++) {
          if (stopG !== null && g >= stopG) break;
          const rel = mod(g - g1, cycleLen);
          const t = slotByOffset[rel];
          if (t) writeAt(g, { type: carryType(t.type), number: String(minVal + t.slot) });
        }
        if (stopEntry) writeAt(stopEntry.g, { type: 'stop', number: '' });
      } else if (stopEntry) {
        writeAt(stopEntry.g, { type: 'stop', number: '' });
      }
    } else {
      // ---- fallback: no repeat detected, simple sequential numbering ----
      let nextNumber = null;
      entries.forEach(e => {
        if (e.mark.type === 'x') { writeAt(e.g, { type: 'x', number: '' }); return; }
        if (e.mark.type === 'repeat' || e.mark.type === 'stop') { writeAt(e.g, { type: e.mark.type, number: '' }); return; }
        if (nextNumber === null) {
          const parsed = parseInt(e.mark.number, 10);
          nextNumber = !isNaN(parsed) ? parsed : 1;
        } else {
          nextNumber += 1;
        }
        writeAt(e.g, { type: carryType(e.mark.type), number: String(nextNumber) });
      });
    }
  }

  render();
}

// Converts a (page, blockId, local row 1..ROWS) cell into a single global,
// 1-indexed frame number that increases continuously across blocks and
// pages (block0 row1..72, then block1 row1..72, then next page...).
function globalFrameOf(page, blockId, row) {
  return page * ROWS * 2 + (blockId === 0 ? 0 : ROWS) + row;
}

// Inverse of globalFrameOf: turns a global frame number back into
// {page, blockId, row}.
function frameToSegment(g) {
  const flat = g - 1;
  const page = Math.floor(flat / (ROWS * 2));
  const rem = flat - page * ROWS * 2; // 0..(ROWS*2-1)
  const blockId = rem < ROWS ? 0 : 1;
  const row = (rem < ROWS ? rem : rem - ROWS) + 1;
  return { page, blockId, row };
}

// All global frame numbers in a column that have a mark (real or the
// auto "x" at frame 1), across every page currently reachable, ascending.
function columnGlobalMarkFrames(col) {
  const pages = totalPagesNeeded();
  const list = [];
  for (let p = 0; p < pages; p++) {
    for (let b = 0; b < 2; b++) {
      for (let r = 1; r <= ROWS; r++) {
        if (getEffectiveMark(p, b, col, r)) list.push(globalFrameOf(p, b, r));
      }
    }
  }
  return list;
}

// ---- INBETWEEN section: its own, separate mark data, populated only by
// the "Make In-Between" button (not directly click-editable). Same key
// shape as ACTION's marks, just a separate table. ----
function ibMarkKey(page, blockId, col, row) { return page + '_' + blockId + '_' + col + '_' + row; }

function getInbetweenMark(page, blockId, col, row) {
  return state.inbetweenMarks[ibMarkKey(page, blockId, col, row)] || null;
}

function columnGlobalMarkFramesInbetween(col) {
  const pages = totalPagesNeeded();
  const list = [];
  for (let p = 0; p < pages; p++) {
    for (let b = 0; b < 2; b++) {
      for (let r = 1; r <= ROWS; r++) {
        if (getInbetweenMark(p, b, col, r)) list.push(globalFrameOf(p, b, r));
      }
    }
  }
  return list;
}

// Draws the portion of a continuous line (defined in global-frame units,
