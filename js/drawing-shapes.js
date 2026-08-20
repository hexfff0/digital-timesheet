// ==== drawing-shapes.js ====
// ==== Mark-shape primitives drawn on the ACTION/INBETWEEN grid
// ==== =============================================================
// Each shape takes center (cx, cy) and half-size `size`; `drawMark`
// dispatches to the right primitive and prints the mark's number on top.

// ○ Keyframe — hollow circle.
function drawKeyframeShape(cx, cy, size) {
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx, cy, size, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = LW_NORMAL + 0.5;
  ctx.strokeStyle = '#000000';
  ctx.stroke();
  ctx.restore();
}

// △ Breakdown — hollow triangle pointing up.
function drawBreakdownShape(cx, cy, size) {
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.moveTo(cx, cy - size);
  ctx.lineTo(cx + size * 0.95, cy + size * 0.8);
  ctx.lineTo(cx - size * 0.95, cy + size * 0.8);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = LW_NORMAL + 0.5;
  ctx.strokeStyle = '#000000';
  ctx.stroke();
  ctx.restore();
}

// "x" = this frame shows no image at all.
function drawXShape(cx, cy, size) {
  ctx.save();
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = LW_NORMAL + 1;
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.75, cy - size * 0.75);
  ctx.lineTo(cx + size * 0.75, cy + size * 0.75);
  ctx.moveTo(cx + size * 0.75, cy - size * 0.75);
  ctx.lineTo(cx - size * 0.75, cy + size * 0.75);
  ctx.stroke();
  ctx.restore();
}

// "." = plain in-between, drawn as a small solid dot.
function drawDotShape(cx, cy, size) {
  ctx.save();
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.28, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// リピート (repeat) = vertical text telling Make In-Between to keep
// auto-generating the established cycle forward from here. Each character
// occupies one full frame cell; the run continues downward across blocks
// and pages (each block draws the characters that land inside it, the same
// way dialogue lines flow across blocks).
const REPEAT_TEXT = ['リ', 'ピ', 'ー', 'ト'];

// Draws ONE repeat character, same size as the 止 stop mark (fontSize =
// max(11, size*1.35) from drawStopShape), centered at (cx, cy) exactly like
// 止. No background — it draws straight over whatever the cell already
// shows.
function drawRepeatGlyph(cx, cy, size, ch) {
  const fontSize = Math.max(11, size * 1.35);
  ctx.save();
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${Math.round(fontSize)}px Arial, Helvetica, sans-serif`;
  ctx.fillText(ch, cx, cy + 0.5);
  ctx.restore();
}

// Compact vertical stack for transient previews (drag ghost / fill ghost),
// where no exact cell/frame context is available. Each character uses the
// same size as the 止 stop mark (max(11, size*1.35)); the four characters
// pile up in one cell like a mini flag, just as a preview.
function drawRepeatStack(cx, cy, size) {
  const charH = Math.max(11, size * 1.35);
  ctx.save();
  ctx.fillStyle = '#000000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${Math.round(charH)}px Arial, Helvetica, sans-serif`;
  const top = cy - (REPEAT_TEXT.length - 1) * charH / 2;
  REPEAT_TEXT.forEach((ch, i) => ctx.fillText(ch, cx, top + i * charH));
  ctx.restore();
}

// Frame-aware vertical リピート run drawn inside ONE block. g0 is the
// mark's global frame; only the run characters whose cells land in this
// block's local 72-frame span [domainLo, domainHi] are drawn here, each
// centered in its own cell and sized like the 止 stop mark. Characters that
// fall in a later block/page are drawn by that block's own call to
// drawRepeatRun — so the full リピート reads as one continuous vertical run.
function drawRepeatRun(cx, letterBot, rowH, colW, size, page, blockId, g0) {
  const domainLo = globalFrameOf(page, blockId, 1) - 1;
  const domainHi = domainLo + ROWS;
  for (let i = 0; i < REPEAT_TEXT.length; i++) {
    const g = g0 + i; // cell for repeat character i is the g-th frame
    if (g <= domainLo || g > domainHi) continue; // belongs to another block/page
    const localR = g - domainLo; // 1..72 within this block
    const cy = letterBot + (localR - 0.5) * rowH;
    drawRepeatGlyph(cx, cy, size, REPEAT_TEXT[i]);
  }
}

// 止め (stop/hold) = the kanji 止, telling Make In-Between to stop
// auto-generating further inbetweens from here (drawing holds).
function drawStopShape(cx, cy, size) {
  const fontSize = Math.max(11, size * 1.35);
  text('止', cx, cy + 0.5, fontSize, { bold: true });
}

// Draws one mark: the enclosing shape (if any) plus its drawing number on
// top. 'plain' marks have no enclosing shape, just the number itself.
// 'x', '.', 'repeat', and 'stop' are pure symbols — no number is drawn.
function drawMark(cx, cy, size, mark) {
  if (mark.type === 'keyframe') { drawKeyframeShape(cx, cy, size); }
  else if (mark.type === 'breakdown') { drawBreakdownShape(cx, cy, size); }
  else if (mark.type === 'x') { drawXShape(cx, cy, size); return; }
  else if (mark.type === '.') { drawDotShape(cx, cy, size); return; }
  else if (mark.type === 'repeat') { drawRepeatStack(cx, cy, size); return; }
  else if (mark.type === 'stop') { drawStopShape(cx, cy, size); return; }
  const fontSize = Math.max(11, size * 1.35);
  text(String(mark.number), cx, cy + 0.5, fontSize, { bold: mark.type !== 'plain' });
}
