// ==== drawing-books.js ====
// ==== "Book" markers: overlap layout + drawing.
// ==== =============================================================

// The box a book label will actually be drawn as, centered at (x, y), in
// the current book style (horizontal or vertical). Used both for overlap
// detection and for the tic-line length.
function bookLabelBox(name, x, y) {
  const vertical = state.bookStyle.vertical;
  if (vertical) {
    const charH = 12;
    const textH = Math.max(charH, name.length * charH);
    return { x, y, rx: 9, ry: (textH + 10) / 2 };
  }
  ctx.font = 'bold 10px Arial, Helvetica, sans-serif';
  const textW = ctx.measureText(name).width;
  return { x, y, rx: Math.max(16, textW / 2 + 8), ry: 10 };
}

// Vertical gap between the stacked labels of one divider. Horizontal
// labels are short, so the base 26px gap is fine; vertical labels are
// tall, so their gap grows with the longest name so stacked labels never
// touch each other.
function bookStackSpacing(books, vertical) {
  const base = vertical ? 34 : 26;
  if (!vertical) return base;
  const maxLen = Math.max(...books.map(b => b.name.length));
  return Math.max(base, Math.max(12, maxLen * 12) + 14);
}

// The lowest Y (page coordinate) a book label may occupy. Keeps raised
// stacks from drawing over the memo box / header table, so vertical-first
// layout switches to branching once the space above the grid is used up.
function bookMinLabelY() {
  if (!state.showHeaderTable) return HDR_BOT + 10;
  return getMemoGeometry().y1 + 10;
}

// Shared geometry for the book-layout resolvers: each stack has a trunk
// (spine) at `x`; its labels are stacked upward from `botY` with
// `spacing` between them, at `s.x + s.dir * tic` horizontally and
// `botY - i*spacing + s.shiftY` vertically. `boxFn(name, x, y)` returns
// the label's drawn box {rx, ry} centered at (x, y). Resolvers mutate
// each stack's `dir` (-1 left / 0 on-trunk / +1 right) and `shiftY`
// (negative = raised) so that no two labels from different stacks
// overlap.
function bookLayoutHelpers(stacks, boxFn) {
  const PAD = 2; // keep a small visual gap between touching labels
  const labelBox = (s, i) => {
    const ly = s.botY - i * s.spacing + s.shiftY;
    const tic = boxFn(s.books[i].name, 0, 0).rx + 14;
    return boxFn(s.books[i].name, s.x + s.dir * tic, ly);
  };
  const overlaps = (a, b) => !(a.x + a.rx + PAD < b.x - b.rx - PAD ||
                               a.x - a.rx - PAD > b.x + b.rx + PAD ||
                               a.y + a.ry + PAD < b.y - b.ry - PAD ||
                               a.y - a.ry - PAD > b.y + b.ry + PAD);
  const pairOverlaps = (si, sj) => {
    for (let i = 0; i < si.books.length; i++) {
      for (let j = 0; j < sj.books.length; j++) {
        if (overlaps(labelBox(si, i), labelBox(sj, j))) return true;
      }
    }
    return false;
  };
  return { labelBox, overlaps, pairOverlaps };
}

// Branch-first strategy. Fix one overlapping pair at a time, left to
// right, restarting the scan after every change so a branch that newly
// collides with a farther trunk gets fixed too:
//   a. the LEFT trunk branches LEFT first;
//   b. if still overlapping, the RIGHT trunk branches RIGHT;
//   c. if neither branch clears it, the right trunk is RAISED up a
//      level, repeated until it sits above the left branch.
// Directions never flip once set, so the pass always terminates.
function resolveBookLayoutBranch(stacks, boxFn) {
  const { pairOverlaps } = bookLayoutHelpers(stacks, boxFn);
  const MAX_ITER = 500;
  for (let iter = 0; iter < MAX_ITER; iter++) {
    let changed = false;
    outer:
    for (let i = 0; i < stacks.length; i++) {
      for (let j = i + 1; j < stacks.length; j++) {
        if (!pairOverlaps(stacks[i], stacks[j])) continue;
        const L = stacks[i], R = stacks[j];
        if (L.dir === 0) L.dir = -1;        // a. left trunk branches left
        else if (R.dir === 0) R.dir = 1;    // b. right trunk branches right
        else R.shiftY -= R.spacing;         // c. raise the right trunk
        changed = true;
        break outer;
      }
    }
    if (!changed) break;
  }
}

// Vertical-first strategy: every label stays on its own trunk, and an
// overlapping right trunk is RAISED above the left trunk's labels first.
// Only when the raise would push the stack above the sheet's usable top
// (minY) does it fall back to branching (left first, then right).
function resolveBookLayoutVertical(stacks, boxFn, minY) {
  const { labelBox, pairOverlaps } = bookLayoutHelpers(stacks, boxFn);
  const MAX_ITER = 500;
  for (let iter = 0; iter < MAX_ITER; iter++) {
    let changed = false;
    outer:
    for (let i = 0; i < stacks.length; i++) {
      for (let j = i + 1; j < stacks.length; j++) {
        if (!pairOverlaps(stacks[i], stacks[j])) continue;
        const L = stacks[i], R = stacks[j];
        const top = labelBox(R, R.books.length - 1); // topmost label
        const canRaise = top.y - R.spacing - top.ry >= minY;
        if (canRaise) {
          R.shiftY -= R.spacing;            // raise the right trunk above
        } else if (L.dir === 0) {
          L.dir = -1;                        // vertical space used up → branch left
        } else if (R.dir === 0) {
          R.dir = 1;                         // then branch right
        } else {
          R.shiftY -= R.spacing;             // last resort: accept going high
        }
        changed = true;
        break outer;
      }
    }
    if (!changed) break;
  }
}

// Dispatches to the strategy chosen in the sidebar.
function resolveBookLayout(stacks, boxFn, minY) {
  if (state.bookLayoutStrategy === 'vertical') resolveBookLayoutVertical(stacks, boxFn, minY);
  else resolveBookLayoutBranch(stacks, boxFn);
}

// Draws every "Book" (named layer-order marker) that falls within this
// ACTION section's column range: a line pointing up from the divider,
// with the name in an oval at the top. Also registers each divider's
// clickable zone for right-click hit-testing (add/edit/delete). Stacks
// that collide are untangled per state.bookLayoutStrategy.
function drawBooks(blockId, secX0, colW, n, gridTop, letterBot) {
  for (let d = 0; d <= n; d++) {
    const x = secX0 + d * colW;
    // Right-click zone for a divider: the band where the Book labels and
    // spines actually live (from just below the memo box up to the letter
    // row). It deliberately stops at letterBot so the frame-grid rows stay
    // free for the mark/symbol (shape) menu.
    const y0 = Math.min(bookMinLabelY(), gridTop - 24);
    bookHitRegions.push({ blockId, divider: d, x, y0, y1: letterBot });
  }

  // Group by divider.
  const byDivider = {};
  state.books.forEach(b => {
    if (b.divider < 0 || b.divider > n) return;
    (byDivider[b.divider] = byDivider[b.divider] || []).push(b);
  });
  const dividerKeys = Object.keys(byDivider).map(Number).sort((a, b) => a - b);
  if (!dividerKeys.length) return;
  const vertical = state.bookStyle.vertical;

  // 1. One stack per divider that has books. Labels start stacked upward
  //    from the bottom, right on the trunk; the overlap pass below then
  //    sets each stack's `dir` and `shiftY`.
  const stacks = dividerKeys.map((d) => {
    const books = byDivider[d];
    const x = secX0 + d * colW;
    const botY = gridTop - 24;
    return { d, x, books, botY, spacing: bookStackSpacing(books, vertical), dir: 0, shiftY: 0 };
  });

  // 2. Resolve overlap per the sidebar strategy ('branch' = left trunk
  //    branches left first, then right, then raise; 'vertical' = raise
  //    overlapping stacks above each other first, branching only when
  //    the space above the grid runs out).
  resolveBookLayout(stacks, bookLabelBox, bookMinLabelY());

  // 3. Draw.
  stacks.forEach((s) => {
    const { x, books, botY, spacing, dir, shiftY } = s;
    const topY = botY - (books.length - 1) * spacing + shiftY;

    // Spine.
    ctx.save();
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = LW_NORMAL;
    ctx.beginPath();
    ctx.moveTo(x, letterBot);
    ctx.lineTo(x, topY);
    ctx.stroke();
    ctx.restore();

    books.forEach((book, i) => {
      const ly = botY - i * spacing + shiftY;

      if (dir !== 0) {
        const ticLen = bookLabelBox(book.name, 0, 0).rx + 14;
        const labelX = x + dir * ticLen;

        ctx.save();
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = LW_NORMAL;
        ctx.beginPath();
        ctx.moveTo(x, ly);
        ctx.lineTo(labelX, ly);
        ctx.stroke();
        ctx.restore();

        drawBookLabel(labelX, ly, book.name);
      } else {
        drawBookLabel(x, ly, book.name);
      }
    });
  });
}

// Draws one Book's name badge (oval or rectangle, horizontal or vertical
// text) using the shared global style in state.bookStyle.
function drawBookLabel(x, y, name) {
  const vertical = state.bookStyle.vertical;
  const shape = state.bookStyle.shape; // 'oval' | 'rect' | 'none'
  const isRect = shape === 'rect';
  const noBox = shape === 'none';

  if (vertical) {
    const chars = name.split('');
    const charH = 12;
    const textH = Math.max(charH, chars.length * charH);
    const boxW = 18, boxH = textH + 10;

    if (!noBox) {
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      if (isRect) ctx.rect(x - boxW / 2, y - boxH / 2, boxW, boxH);
      else ctx.ellipse(x, y, boxW / 2 + 4, boxH / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    } else {
      // No-frame labels: knock the grid lines out from behind the text so
      // nothing shows through it (lines read as passing behind the label).
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.roundRect(x - boxW / 2, y - boxH / 2, boxW, boxH, 5);
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'center';
    ctx.font = 'bold 10px Arial, Helvetica, sans-serif';
    const startY = y - (chars.length - 1) * charH / 2;
    chars.forEach((ch, i) => ctx.fillText(ch, x, startY + i * charH + 1));
    ctx.restore();
  } else {
    ctx.font = 'bold 10px Arial, Helvetica, sans-serif';
    const textW = ctx.measureText(name).width;
    const rx = Math.max(16, textW / 2 + 8), ry = 10;

    if (!noBox) {
      ctx.save();
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      if (isRect) ctx.rect(x - rx, y - ry, rx * 2, ry * 2);
      else ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    } else {
      // No-frame labels: knock the grid lines out from behind the text so
      // nothing shows through it (lines read as passing behind the label).
      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.fillStyle = '#000000';
      ctx.beginPath();
      ctx.roundRect(x - rx, y - ry, rx * 2, ry * 2, 5);
      ctx.fill();
      ctx.restore();
    }

    text(name, x, y + 1, 10, { bold: true });
  }
}
