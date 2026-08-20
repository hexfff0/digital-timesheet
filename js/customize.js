// ==== customize.js ====
// ==== Customize (resize) mode, export-to-PNG, and section/column wiring.
// ==== =============================================================
// ---------------------------------------------------------------
// Customize (layout resize) mode: selection drilling, edge-drag resize,
// and the visual overlay (highlight box + drag handles).
// ---------------------------------------------------------------
function pointInRect(x, y, r) { return x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1; }

function findLayoutRegion(sel) {
  if (!sel) return null;
  if (sel.level === 'titleWhole') return layoutHitRegions.find(r => r.level === 'titleWhole');
  if (sel.level === 'titleCell') return layoutHitRegions.find(r => r.level === 'titleCell' && r.cell === sel.cell);
  if (sel.level === 'memoWhole') return layoutHitRegions.find(r => r.level === 'memoWhole');
  return layoutHitRegions.find(r => r.level === sel.level && r.blockId === sel.blockId && r.name === sel.name);
}

// Click-to-drill: click anywhere on the table selects the whole table;
// clicking again (while the click still lands inside the current
// selection) drills one level deeper; clicking outside the current
// selection resets back to the whole table.
function handleCustomizeClick(x, y) {
  // The title-info table has its own small, separate hierarchy.
  const titleWhole = layoutHitRegions.find(r => r.level === 'titleWhole');
  if (titleWhole && pointInRect(x, y, titleWhole)) {
    if (layoutSelection && layoutSelection.level === 'titleWhole') {
      const cell = layoutHitRegions.find(r => r.level === 'titleCell' && pointInRect(x, y, r));
      if (cell) layoutSelection = { level: 'titleCell', cell: cell.cell };
    } else {
      layoutSelection = { level: 'titleWhole' };
    }
    render();
    return;
  }

  // The memo box is also its own standalone selectable object.
  const memoWhole = layoutHitRegions.find(r => r.level === 'memoWhole');
  if (memoWhole && pointInRect(x, y, memoWhole)) {
    layoutSelection = { level: 'memoWhole' };
    render();
    return;
  }

  const level0 = layoutHitRegions.find(r => r.level === 0);
  if (!level0 || !pointInRect(x, y, level0)) {
    // not on the table — the paper image is the fallback target, so a
    // click on the paper's exposed margin (table shrunk/moved) selects it
    const paperR = layoutHitRegions.find(r => r.level === 'paperWhole');
    if (paperR && pointInRect(x, y, paperR)) layoutSelection = { level: 'paperWhole' };
    else layoutSelection = null;
    render();
    return;
  }

  if (!layoutSelection || typeof layoutSelection.level !== 'number') {
    layoutSelection = { level: 0 };
    render();
    return;
  }

  const curRegion = findLayoutRegion(layoutSelection);
  if (!curRegion || !pointInRect(x, y, curRegion)) {
    layoutSelection = { level: 0 };
    render();
    return;
  }

  const nextLevel = Math.min(layoutSelection.level + 1, 4);
  const candidates = layoutHitRegions.filter(r => r.level === nextLevel && pointInRect(x, y, r));
  if (candidates.length > 0) {
    candidates.sort((a, b) => (a.x1 - a.x0) * (a.y1 - a.y0) - (b.x1 - b.x0) * (b.y1 - b.y0));
    const best = candidates[0];
    layoutSelection = { level: nextLevel, blockId: best.blockId, name: best.name };
  }
  render();
}

// Returns which drag handle (if any) the point is near, for the CURRENT
// selection's region.
function edgeHitTest(x, y) {
  const region = findLayoutRegion(layoutSelection);
  if (!region) return null;
  const level = layoutSelection.level;
  const TOL = 16;

  if (level === 4) {
    if (region.dividerY != null && Math.abs(y - region.dividerY) < TOL && x >= region.x0 && x <= region.x1) return { kind: 'split' };
    return null;
  }
  if (level === 'titleCell') {
    if (Math.abs(x - region.x1) < TOL && y >= region.y0 && y <= region.y1) return { kind: 'cellRight' };
    if (Math.abs(x - region.x0) < TOL && y >= region.y0 && y <= region.y1) return { kind: 'cellLeft' };
    return null;
  }

  const widthLevels = [0, 1, 2, 'titleWhole', 'memoWhole', 'paperWhole'];
  const heightLevels = [0, 1, 2, 3, 'titleWhole', 'memoWhole', 'paperWhole'];
  const moveLevels = [0, 1, 2, 'titleWhole', 'memoWhole', 'paperWhole'];

  // For a whole block/section (levels 1 & 2), the region's own y1 is the
  // bottom of the entire 72-row frame grid — but there's no independent
  // "block/section height" (rows must stay aligned across every column).
  // The only real height lever in scope is the shared header-band height,
  // so the height handle for these two levels lives at that inner
  // boundary (letterBot) instead of the region's outer edge.
  const heightBottom = (level === 1 || level === 2) && region.letterBot != null ? region.letterBot : region.y1;

  const nearLeft = Math.abs(x - region.x0) < TOL && y >= region.y0 && y <= region.y1;
  const nearRight = Math.abs(x - region.x1) < TOL && y >= region.y0 && y <= region.y1;
  const nearTop = Math.abs(y - region.y0) < TOL && x >= region.x0 && x <= region.x1;
  const nearBottom = Math.abs(y - heightBottom) < TOL && x >= region.x0 && x <= region.x1;

  if (widthLevels.includes(level) && nearRight) return { kind: 'right' };
  if (widthLevels.includes(level) && nearLeft) return { kind: 'left' };
  if (heightLevels.includes(level) && nearBottom) return { kind: 'bottom' };
  if (heightLevels.includes(level) && nearTop) return { kind: 'top' };
  if (moveLevels.includes(level) && pointInRect(x, y, region)) return { kind: 'move' };
  return null;
}

function startLayoutDrag(pt, hit) {
  const level = layoutSelection.level;
  const region = findLayoutRegion(layoutSelection);
  const kind = hit.kind;

  if (kind === 'right' || kind === 'left') {
    if (level === 0) {
      dragState = { kind, level: 0, axis: 'x', startX: pt.x, startSpan: region.x1 - region.x0, startScale: getScaleX() };
    } else if (level === 'titleWhole') {
      const base = state.titleTable.w != null ? state.titleTable.w : (HDR_COLS[HDR_COLS.length - 1] - HDR_COLS[0]);
      const baseX = state.titleTable.x != null ? state.titleTable.x : HDR_COLS[0];
      dragState = { kind, level: 'titleWhole', startX: pt.x, startValue: base, startPosX: baseX };
    } else if (level === 'memoWhole') {
      const base = state.memo.w != null ? state.memo.w : (HDR_COLS[HDR_COLS.length - 1] - HDR_COLS[0]);
      const baseX = state.memo.x != null ? state.memo.x : HDR_COLS[0];
      dragState = { kind, level: 'memoWhole', startX: pt.x, startValue: base, startPosX: baseX };
    } else if (level === 'paperWhole') {
      const base = state.paper.w != null ? state.paper.w : 0;
      const baseX = state.paper.x != null ? state.paper.x : 0;
      dragState = { kind, level: 'paperWhole', startX: pt.x, startValue: base, startPosX: baseX };
    } else if (level === 1) {
      dragState = { kind, level: 1, startX: pt.x, startValue: getCurrentValuePreScale(1), startOffsetX: state.layout.blockOffset[layoutSelection.blockId].x };
    } else if (level === 2) {
      const key = layoutSelection.blockId + ':' + layoutSelection.name;
      dragState = { kind, level: 2, startX: pt.x, startValue: getCurrentValuePreScale(2), startOffsetX: (state.layout.sectionOffset[key] || { x: 0 }).x };
    }
  } else if (kind === 'bottom' || kind === 'top') {
    if (level === 'titleWhole') {
      const base = state.titleTable.h != null ? state.titleTable.h : (HDR_BOT - HDR_TOP);
      const baseY = state.titleTable.y != null ? state.titleTable.y : HDR_TOP;
      dragState = { kind, level: 'titleWhole', startY: pt.y, startValue: base, startPosY: baseY };
    } else if (level === 'memoWhole') {
      const geo = getMemoGeometry();
      const base = geo.y1 - geo.y0;
      dragState = { kind, level: 'memoWhole', startY: pt.y, startValue: base, startPosY: geo.y0 };
    } else if (level === 'paperWhole') {
      const base = state.paper.h != null ? state.paper.h : 0;
      const baseY = state.paper.y != null ? state.paper.y : 0;
      dragState = { kind, level: 'paperWhole', startY: pt.y, startValue: base, startPosY: baseY };
    } else if (level === 0) {
      dragState = { kind, level: 0, axis: 'y', startY: pt.y, startSpan: region.y1 - region.y0, startScale: getScaleY() };
    } else if (level === 1 || level === 2 || level === 3) {
      // levels 1/2 have no independent height of their own — the only
      // real lever is their block's shared header-band height, same one
      // level 3 controls directly
      dragState = { kind, level: 3, blockId: layoutSelection.blockId, startY: pt.y, startValue: getCurrentValuePreScale(3), startOffsetY: state.layout.headerOffset[layoutSelection.blockId] };
    }
  } else if (kind === 'split') {
    dragState = { kind: 'split', level: 4, region };
  } else if (kind === 'move') {
    if (level === 0) {
      dragState = { kind: 'move', level: 0, startX: pt.x, startY: pt.y, startOffX: state.layout.wholeOffset.x, startOffY: state.layout.wholeOffset.y };
    } else if (level === 1) {
      const off = state.layout.blockOffset[layoutSelection.blockId];
      dragState = { kind: 'move', level: 1, startX: pt.x, startY: pt.y, startOffX: off.x, startOffY: off.y };
    } else if (level === 2) {
      const key = layoutSelection.blockId + ':' + layoutSelection.name;
      const cur = state.layout.sectionOffset[key] || { x: 0 };
      dragState = { kind: 'move', level: 2, startX: pt.x, startOffX: cur.x };
    } else if (level === 'titleWhole') {
      const baseX = state.titleTable.x != null ? state.titleTable.x : HDR_COLS[0];
      const baseY = state.titleTable.y != null ? state.titleTable.y : HDR_TOP;
      dragState = { kind: 'move', level: 'titleWhole', startX: pt.x, startY: pt.y, startOffX: baseX, startOffY: baseY };
    } else if (level === 'memoWhole') {
      const geo = getMemoGeometry();
      dragState = { kind: 'move', level: 'memoWhole', startX: pt.x, startY: pt.y, startOffX: geo.x0, startOffY: geo.y0 };
    } else if (level === 'paperWhole') {
      dragState = { kind: 'move', level: 'paperWhole', startX: pt.x, startY: pt.y, startOffX: state.paper.x, startOffY: state.paper.y };
    }
  } else if (kind === 'cellRight' || kind === 'cellLeft') {
    const geo = getHeaderTableGeometry();
    const idx = kind === 'cellRight' ? layoutSelection.cell : layoutSelection.cell - 1;
    if (idx < 0) { dragState = null; return; }
    dragState = { kind: 'cellWidth', cell: idx, startX: pt.x, startValue: geo.colXs[idx + 1] - geo.colXs[idx] };
  }
}

function applyLayoutDrag(pt, shiftHeld) {
  if (!dragState) return;
  const level = dragState.level;

  if (dragState.kind === 'right' || dragState.kind === 'left') {
    const deltaScreen = pt.x - dragState.startX;
    if (level === 0) {
      const signedDelta = dragState.kind === 'right' ? deltaScreen : -deltaScreen;
      const newSpan = dragState.startSpan + signedDelta;
      state.layout.scaleX = Math.max(0.3, dragState.startScale * (newSpan / dragState.startSpan));
    } else if (level === 'titleWhole') {
      if (dragState.kind === 'right') {
        state.titleTable.w = Math.max(100, dragState.startValue + deltaScreen);
      } else {
        const newW = Math.max(100, dragState.startValue - deltaScreen);
        state.titleTable.w = newW;
        state.titleTable.x = dragState.startPosX + (dragState.startValue - newW);
      }
    } else if (level === 'memoWhole') {
      if (dragState.kind === 'right') {
        state.memo.w = Math.max(60, dragState.startValue + deltaScreen);
      } else {
        const newW = Math.max(60, dragState.startValue - deltaScreen);
        state.memo.w = newW;
        state.memo.x = dragState.startPosX + (dragState.startValue - newW);
      }
    } else if (level === 'paperWhole') {
      if (dragState.kind === 'right') {
        state.paper.w = Math.max(40, dragState.startValue + deltaScreen);
      } else {
        const newW = Math.max(40, dragState.startValue - deltaScreen);
        state.paper.w = newW;
        state.paper.x = dragState.startPosX + (dragState.startValue - newW);
      }
    } else {
      const deltaBase = deltaScreen / getScaleX();
      const min = level === 1 ? 60 : 20;
      if (dragState.kind === 'right') {
        const newVal = Math.max(min, dragState.startValue + deltaBase);
        if (level === 1) state.layout.blockW[layoutSelection.blockId] = newVal;
        else state.layout.sectionW[layoutSelection.blockId + ':' + layoutSelection.name] = newVal;
      } else {
        const newVal = Math.max(min, dragState.startValue - deltaBase);
        if (level === 1) {
          state.layout.blockW[layoutSelection.blockId] = newVal;
          state.layout.blockOffset[layoutSelection.blockId].x = dragState.startOffsetX + deltaScreen;
        } else {
          const key = layoutSelection.blockId + ':' + layoutSelection.name;
          state.layout.sectionW[key] = newVal;
          if (!state.layout.sectionOffset[key]) state.layout.sectionOffset[key] = { x: 0 };
          state.layout.sectionOffset[key].x = dragState.startOffsetX + deltaScreen;
        }
      }
    }
  } else if (dragState.kind === 'bottom' || dragState.kind === 'top') {
    const deltaScreen = pt.y - dragState.startY;
    if (level === 'titleWhole') {
      if (dragState.kind === 'bottom') {
        state.titleTable.h = Math.max(30, dragState.startValue + deltaScreen);
      } else {
        const newH = Math.max(30, dragState.startValue - deltaScreen);
        state.titleTable.h = newH;
        state.titleTable.y = dragState.startPosY + (dragState.startValue - newH);
      }
    } else if (level === 'memoWhole') {
      if (dragState.kind === 'bottom') {
        state.memo.h = Math.max(30, dragState.startValue + deltaScreen);
      } else {
        const newH = Math.max(30, dragState.startValue - deltaScreen);
        state.memo.h = newH;
        state.memo.y = dragState.startPosY + (dragState.startValue - newH);
      }
    } else if (level === 'paperWhole') {
      if (dragState.kind === 'bottom') {
        state.paper.h = Math.max(40, dragState.startValue + deltaScreen);
      } else {
        const newH = Math.max(40, dragState.startValue - deltaScreen);
        state.paper.h = newH;
        state.paper.y = dragState.startPosY + (dragState.startValue - newH);
      }
    } else if (level === 0) {
      const signedDelta = dragState.kind === 'bottom' ? deltaScreen : -deltaScreen;
      const newSpan = dragState.startSpan + signedDelta;
      state.layout.scaleY = Math.max(0.3, dragState.startScale * (newSpan / dragState.startSpan));
    } else if (level === 3) {
      const deltaBase = deltaScreen / getScaleY();
      if (dragState.kind === 'bottom') {
        state.layout.headerH[layoutSelection.blockId] = Math.max(15, dragState.startValue + deltaBase);
      } else {
        const newVal = Math.max(15, dragState.startValue - deltaBase);
        state.layout.headerH[layoutSelection.blockId] = newVal;
        state.layout.headerOffset[layoutSelection.blockId] = dragState.startOffsetY + deltaScreen;
      }
    }
  } else if (dragState.kind === 'split') {
    let frac = (pt.y - dragState.region.y0) / (dragState.region.y1 - dragState.region.y0);
    frac = Math.max(0.15, Math.min(0.85, frac));
    state.layout.titleSplit[layoutSelection.blockId + ':' + layoutSelection.name] = frac;
  } else if (dragState.kind === 'move') {
    // holding Shift during a move locks the drag to one axis: the axis with
    // the larger displacement so far wins, the other stays pinned. Re-applied
    // every move (standard "constrain while held"), so leading the cursor
    // diagonally flips which axis is free.
    const dx = pt.x - dragState.startX;
    const dy = pt.y - dragState.startY;
    const locked = shiftHeld && level !== 2 ? (Math.abs(dx) >= Math.abs(dy) ? 'y' : 'x') : null;
    const mx = locked === 'x' ? 0 : dx;
    const my = locked === 'y' ? 0 : dy;
    if (level === 0) {
      state.layout.wholeOffset.x = dragState.startOffX + mx;
      state.layout.wholeOffset.y = dragState.startOffY + my;
    } else if (level === 1) {
      state.layout.blockOffset[layoutSelection.blockId].x = dragState.startOffX + mx;
      state.layout.blockOffset[layoutSelection.blockId].y = dragState.startOffY + my;
    } else if (level === 2) {
      const key = layoutSelection.blockId + ':' + layoutSelection.name;
      if (!state.layout.sectionOffset[key]) state.layout.sectionOffset[key] = { x: 0 };
      state.layout.sectionOffset[key].x = dragState.startOffX + dx; // x-only move, no constraint
    } else if (level === 'titleWhole') {
      state.titleTable.x = dragState.startOffX + mx;
      state.titleTable.y = dragState.startOffY + my;
    } else if (level === 'memoWhole') {
      state.memo.x = dragState.startOffX + mx;
      state.memo.y = dragState.startOffY + my;
    } else if (level === 'paperWhole') {
      state.paper.x = dragState.startOffX + mx;
      state.paper.y = dragState.startOffY + my;
    }
  } else if (dragState.kind === 'cellWidth') {
    const geo = getHeaderTableGeometry();
    let colW = state.titleTable.colW ? state.titleTable.colW.slice() : null;
    if (!colW) { colW = []; for (let i = 0; i < geo.colXs.length - 1; i++) colW.push(geo.colXs[i + 1] - geo.colXs[i]); }
    colW[dragState.cell] = Math.max(30, dragState.startValue + (pt.x - dragState.startX));
    state.titleTable.colW = colW;
  }

  clampOverlaps();
  mirrorToOtherBlockIfSync();
  saveLayout();
  render();
}

// While Sync is on, mirrors whatever block-scoped value just changed onto
// the OTHER block (sections/header/split all included at once, as asked).
function mirrorToOtherBlockIfSync() {
  if (!syncBlocks || !layoutSelection || layoutSelection.blockId === undefined) return;
  const src = layoutSelection.blockId;
  const dst = 1 - src;
  const level = layoutSelection.level;
  if (level === 1) {
    state.layout.blockW[dst] = state.layout.blockW[src];
    state.layout.blockOffset[dst] = { x: state.layout.blockOffset[src].x, y: state.layout.blockOffset[src].y };
    // level 1's height handle actually edits the block's shared header band
    state.layout.headerH[dst] = state.layout.headerH[src];
    state.layout.headerOffset[dst] = state.layout.headerOffset[src];
  } else if (level === 2) {
    const srcKey = src + ':' + layoutSelection.name, dstKey = dst + ':' + layoutSelection.name;
    state.layout.sectionW[dstKey] = state.layout.sectionW[srcKey];
    state.layout.sectionOffset[dstKey] = state.layout.sectionOffset[srcKey] ? { x: state.layout.sectionOffset[srcKey].x } : { x: 0 };
    // level 2's height handle also edits the block's shared header band
    state.layout.headerH[dst] = state.layout.headerH[src];
    state.layout.headerOffset[dst] = state.layout.headerOffset[src];
  } else if (level === 3) {
    state.layout.headerH[dst] = state.layout.headerH[src];
    state.layout.headerOffset[dst] = state.layout.headerOffset[src];
  } else if (level === 4) {
    const srcKey = src + ':' + layoutSelection.name, dstKey = dst + ':' + layoutSelection.name;
    state.layout.titleSplit[dstKey] = state.layout.titleSplit[srcKey];
  }
}

// Keeps block 0 / block 1 from ever overlapping each other, and keeps
// sibling sections within the same block from ever overlapping each
// other. Free movement/resizing can push things apart with no limit, but
// the moment two edges would touch and try to cross, the offending side
// gets snapped back to a 0-gap "touching" position instead.
function clampOverlaps() {
  const b0x0 = getBlockX(0), b0x1 = b0x0 + getBlockWidth(0);
  const b1x0 = getBlockX(1);
  if (b0x1 > b1x0) {
    const overlap = b0x1 - b1x0;
    if (dragState && (dragState.level === 1 || dragState.level === 0) && layoutSelection && layoutSelection.blockId === 0) {
      state.layout.blockOffset[0].x -= overlap;
    } else {
      state.layout.blockOffset[1].x += overlap;
    }
  }

  [0, 1].forEach(blockId => {
    const sections = buildSections(blockId); // flow widths, in order
    let acc = 0, prevX1 = null, prevKey = null;
    sections.forEach(sec => {
      const key = blockId + ':' + sec.name;
      const dx = (state.layout.sectionOffset[key] || { x: 0 }).x;
      const flowX0 = acc, flowX1 = acc + sec.width;
      acc = flowX1;
      const x0 = flowX0 + dx, x1 = flowX1 + dx;
      if (prevX1 !== null && x0 < prevX1) {
        const overlap = prevX1 - x0;
        const draggingThis = dragState && dragState.level === 2 && layoutSelection &&
          layoutSelection.blockId === blockId && layoutSelection.name === sec.name;
        if (draggingThis) {
          if (!state.layout.sectionOffset[key]) state.layout.sectionOffset[key] = { x: 0 };
          state.layout.sectionOffset[key].x += overlap;
        } else if (prevKey) {
          if (!state.layout.sectionOffset[prevKey]) state.layout.sectionOffset[prevKey] = { x: 0 };
          state.layout.sectionOffset[prevKey].x -= overlap;
        }
      }
      prevX1 = flowX1 + (state.layout.sectionOffset[key] || { x: 0 }).x;
      prevKey = key;
    });
  });
}

function drawLayoutSelectionOverlay() {
  const region = findLayoutRegion(layoutSelection);
  if (!region) return;
  ctx.save();
  ctx.strokeStyle = '#007aff';
  ctx.lineWidth = 3;
  ctx.setLineDash([8, 5]);
  ctx.strokeRect(region.x0, region.y0, region.x1 - region.x0, region.y1 - region.y0);
  ctx.setLineDash([]);
  ctx.fillStyle = '#007aff';
  const level = layoutSelection.level;

  if (level === 4) {
    const hy = region.dividerY;
    ctx.fillRect(region.x0, hy - 3, region.x1 - region.x0, 6);
    ctx.fillRect((region.x0 + region.x1) / 2 - 9, hy - 4.5, 18, 9);
  } else if (level === 'titleCell') {
    ctx.fillRect(region.x0 - 5, (region.y0 + region.y1) / 2 - 14, 10, 28);
    ctx.fillRect(region.x1 - 5, (region.y0 + region.y1) / 2 - 14, 10, 28);
  } else {
    const widthLevels = [0, 1, 2, 'titleWhole', 'memoWhole', 'paperWhole'];
    const heightLevels = [0, 1, 2, 3, 'titleWhole', 'memoWhole', 'paperWhole'];
    if (widthLevels.includes(level)) {
      ctx.fillRect(region.x0 - 5, (region.y0 + region.y1) / 2 - 14, 10, 28);
      ctx.fillRect(region.x1 - 5, (region.y0 + region.y1) / 2 - 14, 10, 28);
    }
    if (heightLevels.includes(level)) {
      const heightBottom = (level === 1 || level === 2) && region.letterBot != null ? region.letterBot : region.y1;
      ctx.fillRect((region.x0 + region.x1) / 2 - 14, region.y0 - 5, 28, 10);
      ctx.fillRect((region.x0 + region.x1) / 2 - 14, heightBottom - 5, 28, 10);
    }
  }
  ctx.restore();
}

function levelLabel(sel) {
  if (!sel) return '';
  const names = { 0: 'Whole table (left+right)', 1: 'Block', 2: 'Section', 3: 'Header (combined header bar + letter row)', 4: 'Header bar / letter row' };
  if (sel.level === 'titleWhole') return 'Header data table (whole)';
  if (sel.level === 'titleCell') return 'Header cell: ' + HEADER_LABELS[sel.cell];
  if (sel.level === 'memoWhole') return 'MEMO box';
  if (sel.level === 'paperWhole') return 'Paper image';
  let label = names[sel.level] || '';
  if (sel.blockId !== undefined) label += ' — ' + (sel.blockId === 0 ? 'Left' : 'Right');
  if (sel.name) label += ' — ' + sel.name;
  return label;
}

function setIfNotFocused(el, val) {
  if (document.activeElement !== el) el.value = val;
}

function updateLayoutSidebar() {
  const infoBox = document.getElementById('layoutSelectionInfo');
  const label = document.getElementById('layoutSelectionLabel');
  const wRow = document.getElementById('layoutWidthRow');
  const hRow = document.getElementById('layoutHeightRow');
  const splitRow = document.getElementById('layoutSplitRow');
  const scaleXRow = document.getElementById('layoutScaleXRow');
  const scaleYRow = document.getElementById('layoutScaleYRow');
  [wRow, hRow, splitRow, scaleXRow, scaleYRow].forEach(el => el.style.display = 'none');

  if (!customizeMode || !layoutSelection) { infoBox.style.display = 'none'; return; }
  infoBox.style.display = 'block';
  label.textContent = levelLabel(layoutSelection);

  const level = layoutSelection.level;
  if (level === 0) {
    scaleXRow.style.display = 'flex';
    scaleYRow.style.display = 'flex';
    setIfNotFocused(document.getElementById('layoutScaleXInput'), Math.round(getScaleX() * 100));
    setIfNotFocused(document.getElementById('layoutScaleYInput'), Math.round(getScaleY() * 100));
  } else if (level === 1 || level === 2) {
    wRow.style.display = 'flex';
    setIfNotFocused(document.getElementById('layoutWidthInput'), Math.round(getCurrentValuePreScale(level)));
  } else if (level === 3) {
    hRow.style.display = 'flex';
    setIfNotFocused(document.getElementById('layoutHeightInput'), Math.round(getCurrentValuePreScale(3)));
  } else if (level === 4) {
    splitRow.style.display = 'flex';
    const key = layoutSelection.blockId + ':' + layoutSelection.name;
    const ov = state.layout.titleSplit[key];
    const baseFrac = (TITLE_BOT_BASE - GRID_TOP_BASE) / (LETTER_BOT_BASE - GRID_TOP_BASE);
    setIfNotFocused(document.getElementById('layoutSplitInput'), Math.round((ov != null ? ov : baseFrac) * 100));
  } else if (level === 'titleWhole') {
    wRow.style.display = 'flex'; hRow.style.display = 'flex';
    setIfNotFocused(document.getElementById('layoutWidthInput'), Math.round(state.titleTable.w != null ? state.titleTable.w : (HDR_COLS[HDR_COLS.length - 1] - HDR_COLS[0])));
    setIfNotFocused(document.getElementById('layoutHeightInput'), Math.round(state.titleTable.h != null ? state.titleTable.h : (HDR_BOT - HDR_TOP)));
  } else if (level === 'memoWhole') {
    wRow.style.display = 'flex'; hRow.style.display = 'flex';
    const geo = getMemoGeometry();
    setIfNotFocused(document.getElementById('layoutWidthInput'), Math.round(geo.x1 - geo.x0));
    setIfNotFocused(document.getElementById('layoutHeightInput'), Math.round(geo.y1 - geo.y0));
  } else if (level === 'paperWhole') {
    wRow.style.display = 'flex'; hRow.style.display = 'flex';
    setIfNotFocused(document.getElementById('layoutWidthInput'), Math.round(state.paper.w));
    setIfNotFocused(document.getElementById('layoutHeightInput'), Math.round(state.paper.h));
  } else if (level === 'titleCell') {
    wRow.style.display = 'flex';
    const geo = getHeaderTableGeometry();
    setIfNotFocused(document.getElementById('layoutWidthInput'), Math.round(geo.colXs[layoutSelection.cell + 1] - geo.colXs[layoutSelection.cell]));
  }
}

document.getElementById('customizeToggleBtn').addEventListener('click', () => {
  customizeMode = !customizeMode;
  layoutSelection = null;
  dragState = null;
  selectedCell = null;
  selectedExtra = [];
  navActive = null;
  editingBuffer = null;
  const btn = document.getElementById('customizeToggleBtn');
  btn.textContent = customizeMode ? 'Exit resize mode' : 'Enter resize mode (Customize)';
  btn.style.background = customizeMode ? '#007aff' : 'var(--fill)';
  btn.style.color = customizeMode ? '#fff' : 'var(--text)';
  render();
});

document.getElementById('layoutResetBtn').addEventListener('click', () => {
  state.layout = {
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
  };
  state.titleTable = { x: null, y: null, w: null, h: null, colW: null };
  state.memo.x = null; state.memo.y = null; state.memo.w = null; state.memo.h = null;
  layoutSelection = null;
  saveLayout();
  render();
});

document.getElementById('layoutScaleXInput').addEventListener('input', e => {
  const v = parseFloat(e.target.value);
  if (!isNaN(v) && v > 0) { state.layout.scaleX = v / 100; saveLayout(); render(); }
});

document.getElementById('layoutScaleYInput').addEventListener('input', e => {
  const v = parseFloat(e.target.value);
  if (!isNaN(v) && v > 0) { state.layout.scaleY = v / 100; saveLayout(); render(); }
});

document.getElementById('layoutWidthInput').addEventListener('input', e => {
  const v = parseFloat(e.target.value);
  if (isNaN(v) || v <= 0 || !layoutSelection) return;
  const level = layoutSelection.level;
  if (level === 1) state.layout.blockW[layoutSelection.blockId] = v;
  else if (level === 2) state.layout.sectionW[layoutSelection.blockId + ':' + layoutSelection.name] = v;
  else if (level === 'titleWhole') state.titleTable.w = v;
  else if (level === 'memoWhole') state.memo.w = v;
  else if (level === 'paperWhole') state.paper.w = v;
  else if (level === 'titleCell') {
    const geo = getHeaderTableGeometry();
    let colW = state.titleTable.colW ? state.titleTable.colW.slice() : null;
    if (!colW) { colW = []; for (let i = 0; i < geo.colXs.length - 1; i++) colW.push(geo.colXs[i + 1] - geo.colXs[i]); }
    colW[layoutSelection.cell] = v;
    state.titleTable.colW = colW;
  }
  clampOverlaps();
  mirrorToOtherBlockIfSync();
  saveLayout();
  render();
});

document.getElementById('layoutHeightInput').addEventListener('input', e => {
  const v = parseFloat(e.target.value);
  if (isNaN(v) || v <= 0 || !layoutSelection) return;
  const level = layoutSelection.level;
  if (level === 3) state.layout.headerH[layoutSelection.blockId] = v;
  else if (level === 'titleWhole') state.titleTable.h = v;
  else if (level === 'memoWhole') state.memo.h = v;
  else if (level === 'paperWhole') state.paper.h = v;
  clampOverlaps();
  mirrorToOtherBlockIfSync();
  saveLayout();
  render();
});

// ---------------------------------------------------------------
// Layout persistence: auto-saved to localStorage on every change,
// restored on boot, and exportable/importable as a JSON file so a
// customized layout can be carried to another sheet/machine.
// ---------------------------------------------------------------
const LAYOUT_STORAGE_KEY = 'timesheet.layout.v1';

// The layout payload = everything Customize mode can change: the grid
// sizes/offsets (state.layout), the top data table's geometry
// (state.titleTable), and the MEMO box's position/size (its text stays
// content, not layout).
function buildLayoutPayload() {
  return {
    layout: state.layout,
    titleTable: state.titleTable,
    memo: { x: state.memo.x, y: state.memo.y, w: state.memo.w, h: state.memo.h, showLabel: state.memo.showLabel, showBorder: state.memo.showBorder },
    paper: state.paper,
    tableOpacity: state.tableOpacity,
    // checkbox/toggle state travels with the layout so an exported layout
    // restores the exact look it was saved with
    showHeaderTable: state.showHeaderTable,
    showEndSlash: state.showEndSlash,
    memoShowLabel: state.memo.showLabel,
    memoShowBorder: state.memo.showBorder,
    inbetweenCarrySymbols: state.inbetweenCarrySymbols,
    bookStyleVertical: state.bookStyle.vertical,
    bookStyleShape: state.bookStyle.shape,
    bookLayoutStrategy: state.bookLayoutStrategy,
    cameraLabelMode: state.cameraLabelMode,
    cameraLabelModeByPage: state.cameraLabelModeByPage,
    sections: Object.keys(state.sections).map(name => ({ name, visible: state.sections[name].visible, showHeader: state.sections[name].showHeader, showLetters: state.sections[name].showLetters, columns: state.sections[name].columns })),
    // custom renames (section / header-table / column names) survive reload
    sectionLabels: state.sectionLabels,
    headerLabels: state.headerLabels,
    columnLabels: state.columnLabels
  };
}

// Fills in every sub-object the drawing code reads directly, so a
// partial, hand-edited, or older file can never leave a missing key
// behind and crash the render.
function normalizeLayout(raw) {
  const dflt = {
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
  };
  const out = Object.assign({}, dflt, raw || {});
  out.wholeOffset = Object.assign({ x: 0, y: 0 }, out.wholeOffset || {});
  out.blockW = Object.assign({}, dflt.blockW, out.blockW || {});
  out.blockOffset = {
    0: Object.assign({ x: 0, y: 0 }, (out.blockOffset || {})[0] || {}),
    1: Object.assign({ x: 0, y: 0 }, (out.blockOffset || {})[1] || {})
  };
  out.sectionW = out.sectionW || {};
  out.sectionOffset = out.sectionOffset || {};
  out.headerH = Object.assign({}, dflt.headerH, out.headerH || {});
  out.headerOffset = Object.assign({}, dflt.headerOffset, out.headerOffset || {});
  out.titleSplit = out.titleSplit || {};
  return out;
}

function normalizeTitleTable(raw) {
  return Object.assign({ x: null, y: null, w: null, h: null, colW: null }, raw || {});
}

// Applies an exported/imported payload onto the live state (layout,
// title table, memo geometry). Returns true if anything was applied.
function applyLayoutPayload(data) {
  if (!data || typeof data !== 'object') return false;
  let applied = false;
  if (data.layout) { state.layout = normalizeLayout(data.layout); applied = true; }
  if (data.titleTable) { state.titleTable = normalizeTitleTable(data.titleTable); applied = true; }
  // `memo` geometry (position/size + label/border toggles). Memo TEXT never
  // travels with the layout — it is sheet data (like action/dialogue/camera)
  // and only moved via full sheet export/import, never layout export/import.
  const mem = data.memo || (data.memoGeo ? Object.assign({ x: null, y: null, w: null, h: null }, data.memoGeo) : null);
  if (mem) {
    const g = Object.assign({ x: null, y: null, w: null, h: null, showLabel: true, showBorder: true }, mem);
    state.memo.x = g.x; state.memo.y = g.y; state.memo.w = g.w; state.memo.h = g.h;
    if (data.memo) { state.memo.showLabel = g.showLabel; state.memo.showBorder = g.showBorder; }
    applied = true;
  }
  if (data.paper) {
    state.paper = Object.assign({ dataUrl: null, x: 0, y: 0, w: 0, h: 0, visible: false }, data.paper);
    applied = true;
  }
  if (typeof data.tableOpacity === 'number') {
    state.tableOpacity = Math.max(0, Math.min(1, data.tableOpacity));
    applied = true;
  }
  // checkbox/toggle state (memoShowLabel/memoShowBorder are for files
  // predating the `memo` object; newer exports carry them on `memo`)
  if (typeof data.showHeaderTable === 'boolean') { state.showHeaderTable = data.showHeaderTable; applied = true; }
  if (typeof data.showEndSlash === 'boolean') { state.showEndSlash = data.showEndSlash; applied = true; }
  if (typeof data.memoShowLabel === 'boolean') { state.memo.showLabel = data.memoShowLabel; applied = true; }
  if (typeof data.memoShowBorder === 'boolean') { state.memo.showBorder = data.memoShowBorder; applied = true; }
  if (typeof data.inbetweenCarrySymbols === 'boolean') { state.inbetweenCarrySymbols = data.inbetweenCarrySymbols; applied = true; }
  if (typeof data.bookStyleVertical === 'boolean') { state.bookStyle.vertical = data.bookStyleVertical; applied = true; }
  if (typeof data.bookStyleShape === 'string') { state.bookStyle.shape = data.bookStyleShape; applied = true; }
  if (typeof data.bookLayoutStrategy === 'string') { state.bookLayoutStrategy = data.bookLayoutStrategy; applied = true; }
  if (typeof data.cameraLabelMode === 'string') { state.cameraLabelMode = data.cameraLabelMode; applied = true; }
  if (data.cameraLabelModeByPage && typeof data.cameraLabelModeByPage === 'object' && !Array.isArray(data.cameraLabelModeByPage)) {
    state.cameraLabelModeByPage = Object.assign({}, data.cameraLabelModeByPage);
    applied = true;
  }
  if (Array.isArray(data.sections)) {
    data.sections.forEach(s => {
      const sec = state.sections[s.name];
      if (!sec) return;
      if (typeof s.visible === 'boolean') sec.visible = s.visible;
      if (typeof s.showHeader === 'boolean') sec.showHeader = s.showHeader;
      if (typeof s.showLetters === 'boolean') sec.showLetters = s.showLetters;
      if (typeof s.columns === 'number' && s.columns >= 1 && s.columns <= 12) sec.columns = s.columns;
    });
    applied = true;
  }
  // custom renames (section / header-table / column labels) — applied only
  // when present, so older layout files leave the current names untouched
  if (data.sectionLabels) { state.sectionLabels = Object.assign({}, data.sectionLabels); applied = true; }
  if (data.headerLabels) { state.headerLabels = Object.assign({}, data.headerLabels); applied = true; }
  if (data.columnLabels) { state.columnLabels = Object.assign({}, data.columnLabels); applied = true; }
  return applied;
}

// Writes the current layout to localStorage (auto-save). Silently
// ignores storage failures (private mode, quota, …).
function saveLayout() {
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(buildLayoutPayload()));
  } catch (e) { /* storage unavailable — nothing to do */ }
}

// Restores a previously auto-saved layout. Returns true if one existed.
function loadLayout() {
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return false;
    return applyLayoutPayload(JSON.parse(raw));
  } catch (e) {
    return false;
  }
}


// Downloads the current layout as a JSON file. Geometry + toggles + custom
// renames all travel together (buildLayoutPayload) so a layout import
// restores the exact look it was saved with.
function exportLayout() {
  const payload = buildLayoutPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'timesheet-layout.json';
  a.click();
  URL.revokeObjectURL(url);
}

document.getElementById('layoutExportBtn').addEventListener('click', exportLayout);

document.getElementById('layoutImportBtn').addEventListener('click', () => {
  document.getElementById('layoutImportFile').click();
});

document.getElementById('layoutImportFile').addEventListener('change', e => {
  const file = e.target.files && e.target.files[0];
  e.target.value = ''; // allow re-importing the same file
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!applyLayoutPayload(data)) throw new Error('file contains no layout data');
      // the imported file may carry custom names — refresh the sidebar inputs
      syncSidebarState();
      syncSectionNameInputs();
      syncHeaderLabelInputs();
      buildColumnLabelInputs();
      layoutSelection = null;
      dragState = null;
      saveLayout();
      render();
    } catch (err) {
      alert('Could not import layout: ' + err.message);
    }
  };
  reader.readAsText(file);
});

document.getElementById('syncToggleBtn').addEventListener('click', () => {
  syncBlocks = !syncBlocks;
  const btn = document.getElementById('syncToggleBtn');
  btn.textContent = syncBlocks ? '🔗 Sync left-right: On' : '🔗 Sync left-right: Off';
  btn.style.background = syncBlocks ? '#007aff' : 'var(--fill)';
  btn.style.color = syncBlocks ? '#fff' : 'var(--text)';
});

// ---------------------------------------------------------------
// External company-paper image: import (downscaled to ≤ PAGE_W wide so it
// fits the localStorage quota), clear, and the structure-opacity slider
// (see drawing.js renderPage — opacity fades the grid + header table so
// the paper shows through; data marks stay solid).
// ---------------------------------------------------------------
function updatePaperStatus() {
  const el = document.getElementById('paperStatus');
  if (!el) return;
  if (!state.paper.dataUrl) { el.textContent = 'No paper image loaded.'; return; }
  const im = getPaperImage();
  const src = im && im.naturalWidth ? im.naturalWidth + ' × ' + im.naturalHeight + ' px' : '…';
  el.textContent = 'Source: ' + src;
}
function updateTableOpacityUI() {
  const input = document.getElementById('tableOpacityInput');
  const label = document.getElementById('tableOpacityLabel');
  if (input && input.value !== String(Math.round(state.tableOpacity * 100))) {
    input.value = Math.round(state.tableOpacity * 100);
  }
  if (label) label.textContent = Math.round(state.tableOpacity * 100) + '%';
}

document.getElementById('paperImportBtn').addEventListener('click', () => {
  document.getElementById('paperFileInput').click();
});

document.getElementById('paperFileInput').addEventListener('change', e => {
  const file = e.target.files && e.target.files[0];
  e.target.value = ''; // allow re-importing the same file
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      // downscale to ≤ PAGE_W wide (keep aspect) so the data URL stays
      // small enough for localStorage and cheap to draw every render
      const scale = Math.min(1, PAGE_W / img.width);
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      state.paper = { dataUrl: c.toDataURL('image/png'), x: 0, y: 0, w: PAGE_W, h: PAGE_H, visible: true };
      state.tableOpacity = 0; // the imported paper shows bare — the whole
      // table + slider are hidden until the user raises opacity
      updateTableOpacityUI();
      layoutSelection = null;
      updatePaperStatus();
      saveLayout();
      render();
    };
    img.onerror = () => alert('Could not load image: ' + file.name);
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
});

document.getElementById('paperClearBtn').addEventListener('click', () => {
  state.paper = { dataUrl: null, x: 0, y: 0, w: 0, h: 0, visible: false };
  layoutSelection = null;
  updatePaperStatus();
  saveLayout();
  render();
});

document.getElementById('tableOpacityInput').addEventListener('input', e => {
  state.tableOpacity = Number(e.target.value) / 100;
  document.getElementById('tableOpacityLabel').textContent = e.target.value + '%';
  saveLayout(); // persist — otherwise a reload restores the stale saved value
  render();
});
updateTableOpacityUI();
updatePaperStatus(); // reflect a paper image restored from localStorage on load

// ---------------------------------------------------------------
// Wire up the side panel
// ---------------------------------------------------------------
document.getElementById('chkHeaderTable').addEventListener('change', e => {
  state.showHeaderTable = e.target.checked;
  render();
  saveLayout(); // persist — so a reload keeps the toggle
});

document.getElementById('chkEndSlash').addEventListener('change', e => {
  state.showEndSlash = e.target.checked;
  render();
  saveLayout();
});

document.getElementById('chkMemoLabel').addEventListener('change', e => {
  state.memo.showLabel = e.target.checked;
  render();
  saveLayout();
});

document.getElementById('chkMemoBorder').addEventListener('change', e => {
  state.memo.showBorder = e.target.checked;
  render();
  saveLayout();
});

document.getElementById('makeInbetweenBtn').addEventListener('click', () => {
  makeInBetween();
});

document.getElementById('autoCameraMemoBtn').addEventListener('click', () => {
  autoCameraMemo();
});

// Auto-generate a camera summary into the MEMO box: one line per camera
// SEGMENT, in frame order (page → block → start frame → lane). Line-style
// segments (PAN/Follow/TU/TB/QTU/QTB/ハンディぶれ) get "Ⓐ→Ⓑ TYPE"; shape
// segments (wedges, OL hourglass) get "A ⋈ B TYPE" with the bowtie
// connector. A multi-keyframe note therefore emits Ⓐ→Ⓑ, Ⓑ→Ⓒ, … lines.
// Single-letter A–Z labels are circled (ⒶⒷ…), custom labels print as-is.
// Appends after existing memo text on a new line.
function autoCameraMemo() {
  const lineTypes = new Set(['PAN', 'Follow', 'TU', 'TB', 'QTU', 'QTB', 'ハンディぶれ']);
  const circled = s => (/^[A-Z]$/.test(s || '') ? String.fromCodePoint(0x24B6 + s.charCodeAt(0) - 65) : (s || ''));
  const notes = state.camera.slice().sort((a, b) =>
    (a.page - b.page) || (a.blockId - b.blockId) || (camFrom(a) - camFrom(b)) || (a.lane - b.lane));
  if (!notes.length) return;
  const lines = [];
  notes.forEach(n => {
    const kfs = n.keyframes;
    for (let i = 0; i < kfs.length - 1; i++) {
      const a = circled(kfs[i].label);
      const b = circled(kfs[i + 1].label);
      const label = kfs[i].name || kfs[i].type;
      const isLine = lineTypes.has(kfs[i].type);
      lines.push(isLine ? `${a}→${b} ${label}` : `${a} ⋈ ${b} ${label}`);
    }
  });
  state.memo.text = state.memo.text ? state.memo.text + '\n' + lines.join('\n') : lines.join('\n');
  render();
}

document.getElementById('chkInbetweenSymbols').addEventListener('change', e => {
  state.inbetweenCarrySymbols = e.target.checked;
  render();
  saveLayout();
});

document.getElementById('cameraLabelModeSelect').addEventListener('change', e => {
  // the dropdown sets THIS page's placement (per-page override); pages
  // without an override keep the global default (state.cameraLabelMode)
  state.cameraLabelModeByPage[state.currentPage] = e.target.value;
  render();
  saveLayout();
});
// Sets the dropdown to the CURRENT page's placement (its per-page
// override, falling back to the global default). Call after loading,
// importing, and on every page switch.
function syncCameraLabelModeSelect() {
  const el = document.getElementById('cameraLabelModeSelect');
  if (!el) return;
  const v = (state.cameraLabelModeByPage && state.cameraLabelModeByPage[state.currentPage])
    || state.cameraLabelMode || 'side';
  if (el.value !== v) el.value = v;
}
syncCameraLabelModeSelect();

document.getElementById('bookShapeSelect').addEventListener('change', e => {
  state.bookStyle.shape = e.target.value;
  render();
  saveLayout();
});
// Keep the dropdown in sync with the (default) shape on load.
document.getElementById('bookShapeSelect').value = state.bookStyle.shape;

document.getElementById('bookLayoutSelect').addEventListener('change', e => {
  state.bookLayoutStrategy = e.target.value;
  render();
  saveLayout();
});
document.getElementById('bookLayoutSelect').value = state.bookLayoutStrategy;

document.getElementById('chkBookVertical').addEventListener('change', e => {
  state.bookStyle.vertical = e.target.checked;
  render();
  saveLayout();
});

// ---------------------------------------------------------------
// PNG export (A3 = the canvas's native 150dpi resolution; A4 is the
// same content scaled down, since A4/A3 share the same 1:√2 aspect
// ratio). Customize-mode overlays and the yellow cell-selection
// highlight are hidden for the exported snapshot.
// ---------------------------------------------------------------
// PNG export targets, in device pixels (each page's native sheet size).
// Non-A3 sizes are RE-RENDERED at their own native resolution, not
// produced by scaling the A3 bitmap: canvas drawing is vector, so the
// scaled context re-rasterizes every glyph and line crisply at the
// target pixel size, whereas drawImage() resamples already-rasterized
// pixels and blurs them. Exact targets: A3 150dpi = 1754x2480, A3
// 300dpi = 3508x4961, A4 150dpi = 1240x1754, A4 300dpi = 2480x3508
// (all share the 1:√2 ratio).
const PNG_TARGETS = { A3: [PAGE_W, PAGE_H], A3H: [3508, 4961], A4: [1240, 1754], A4H: [2480, 3508] };

// Renders the CURRENT page (as shown) onto the exporter canvas at the
// requested paper/DPI target, for a download. Used by both the single-
// page export and the per-page loop in exportPNGAll. Returns nothing;
// leaves the canvas at the target size/scale so the caller can snapshot it.
function renderExportPage(size) {
  const t = PNG_TARGETS[size] || [PAGE_W, PAGE_H];
  const outW = t[0], outH = t[1];
  // cover the target fully (max of both axes; the sub-pixel overscan is
  // clipped inside the sheet's white margin)
  const scale = Math.max(outW / PAGE_W, outH / PAGE_H);
  if (scale !== 1) {
    canvas.width = outW;
    canvas.height = outH;
    ctx.scale(scale, scale); // resizing the canvas reset the context to identity
    render(true); // skipResize: keep the exporter's canvas size/scale
  }
}

// Puts the sheet in a clean, screen-interaction-free state for PNG export:
// drops the stacked view to single-page, clears transient selection/popups.
function withCleanExportView(fn) {
  const savedCustomize = customizeMode;
  const savedSelectedCell = selectedCell;
  const savedSelectedExtra = selectedExtra;
  const savedEditingHeaderIndex = editingHeaderIndex;
  const savedEditingHeaderLabel = editingHeaderLabel;
  const savedEditingMemo = editingMemo;
  const savedTrackMenuOpen = trackMenu.style.display === 'flex';
  const savedTrackTarget = trackMenuTarget;
  const savedViewMode = viewMode;
  viewMode = 'single';
  customizeMode = false;
  selectedCell = null;
  selectedExtra = [];
  navActive = null;
  editingHeaderIndex = null;
  if (editingHeaderLabel !== null) commitHeaderLabelEditingIfAny(); // commit so the export shows it
  if (editingMemo) { state.memo.text = memoEditor.value; } // commit first so the export shows it
  editingMemo = false;
  memoEditor.style.display = 'none';
  trackMenu.style.display = 'none';
  trackMenuTarget = null;
  render();
  try { fn(); }
  finally {
    // restore the canvas to its native A3 size (resizing resets the transform)
    if (canvas.width !== PAGE_W || canvas.height !== PAGE_H) {
      canvas.width = PAGE_W;
      canvas.height = PAGE_H;
    }
    customizeMode = savedCustomize;
    selectedCell = savedSelectedCell;
    selectedExtra = savedSelectedExtra;
    editingHeaderIndex = savedEditingHeaderIndex;
    editingHeaderLabel = savedEditingHeaderLabel;
    editingMemo = savedEditingMemo;
    if (savedTrackMenuOpen) trackMenu.style.display = 'flex';
    trackMenuTarget = savedTrackTarget;
    viewMode = savedViewMode;
    render();
  }
}

// Downloads one PNG of the CURRENT page at the requested paper/DPI size.
function exportPNG(size) {
  const dpi = size === 'A4H' || size === 'A3H' ? 300 : 150;
  const paper = size === 'A3' || size === 'A3H' ? 'A3' : 'A4';
  withCleanExportView(() => {
    renderExportPage(size);
    const link = document.createElement('a');
    link.download = `timesheet_page${state.currentPage + 1}_${paper}_${dpi}dpi.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
  });
}

// Downloads one PNG PER PAGE — every page the TIME value spans — each at
// the requested paper/DPI size, named timesheet_pageN_<paper>_<dpi>dpi.png.
// Each page is rendered at its own native full-page size (the "Page N"
// header cell shows that page's number, and per-page ink/labels land on
// their own page), so the set prints/reads exactly like the on-screen
// sheet.
function exportPNGAll(size) {
  const dpi = size === 'A4H' || size === 'A3H' ? 300 : 150;
  const paper = size === 'A3' || size === 'A3H' ? 'A3' : 'A4';
  const pages = totalPagesNeeded();
  // remember the page the user was on and restore it afterwards
  const wasPage = state.currentPage;
  withCleanExportView(() => {
    for (let p = 0; p < pages; p++) {
      state.currentPage = p;
      renderExportPage(size);
      const link = document.createElement('a');
      link.download = `timesheet_page${p + 1}_${paper}_${dpi}dpi.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    }
  });
  // withCleanExportView re-rendered while currentPage was the LAST page of
  // the loop — put the user's page back on screen
  state.currentPage = Math.min(wasPage, pages - 1);
  render();
}

// ---------------------------------------------------------------
// Export button -> floating menu to pick the PNG size
// ---------------------------------------------------------------
const exportMenu = document.getElementById('exportMenu');
let exportMenuOpen = false;

function showExportMenu() {
  const btn = document.getElementById('exportBtn');
  const r = btn.getBoundingClientRect();
  showFloatingMenu(exportMenu);
  const w = exportMenu.offsetWidth, h = exportMenu.offsetHeight;
  let left = r.right - w, top = r.bottom + 6;
  if (top + h > window.innerHeight - 8) top = r.top - h - 6; // flip above the button
  fitMenuInViewport(exportMenu, left, top);
  exportMenuOpen = true;
}

function hideExportMenu() {
  hideFloatingMenu(exportMenu);
  exportMenuOpen = false;
}

document.getElementById('exportBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  if (importMenuOpen) hideImportMenu();
  if (exportMenuOpen) hideExportMenu();
  else showExportMenu();
});

exportMenu.querySelectorAll('button[data-size]').forEach(btn => {
  btn.addEventListener('click', () => {
    const all = document.getElementById('exportAllPagesChk');
    if (all && all.checked && totalPagesNeeded() > 1) exportPNGAll(btn.dataset.size);
    else exportPNG(btn.dataset.size);
    hideExportMenu();
  });
});

document.addEventListener('click', (e) => {
  if (exportMenuOpen && !exportMenu.contains(e.target)) hideExportMenu();
});

// ---------------------------------------------------------------
// Import button -> floating menu (XDTS / full JSON), same pattern as
// the Export menu
// ---------------------------------------------------------------
const importMenu = document.getElementById('importMenu');
let importMenuOpen = false;

function showImportMenu() {
  const btn = document.getElementById('importBtn');
  const r = btn.getBoundingClientRect();
  showFloatingMenu(importMenu);
  const w = importMenu.offsetWidth, h = importMenu.offsetHeight;
  let left = r.right - w, top = r.bottom + 6;
  if (top + h > window.innerHeight - 8) top = r.top - h - 6; // flip above the button
  fitMenuInViewport(importMenu, left, top);
  importMenuOpen = true;
}

function hideImportMenu() {
  hideFloatingMenu(importMenu);
  importMenuOpen = false;
}

document.getElementById('importBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  if (exportMenuOpen) hideExportMenu();
  if (importMenuOpen) hideImportMenu();
  else showImportMenu();
});

document.addEventListener('click', (e) => {
  if (importMenuOpen && !importMenu.contains(e.target)) hideImportMenu();
});

document.querySelectorAll('.secVisible').forEach(el => {
  el.addEventListener('change', e => {
    state.sections[e.target.dataset.sec].visible = e.target.checked;
    render();
    saveLayout();
  });
});

document.querySelectorAll('.secHeader').forEach(el => {
  el.addEventListener('change', e => {
    state.sections[e.target.dataset.sec].showHeader = e.target.checked;
    render();
    saveLayout();
  });
});

document.querySelectorAll('.secLetters').forEach(el => {
  el.addEventListener('change', e => {
    state.sections[e.target.dataset.sec].showLetters = e.target.checked;
    render();
    saveLayout();
  });
});

function setActionColumns(n) {
  n = Math.max(1, Math.min(12, n));
  state.sections.ACTION.columns = n;
  state.sections.INBETWEEN.columns = n; // always mirrors ACTION
  document.getElementById('colCountAction').value = n;
  document.getElementById('inbetweenCountLabel').textContent = n;
  buildColumnLabelInputs(); // column-count changed -> rebuild letter inputs
  render();
  saveLayout();
}

function setCameraColumns(n) {
  n = Math.max(1, Math.min(12, n));
  state.sections.CAMERA.columns = n;
  syncCameraColumnControls();
  buildColumnLabelInputs(); // lane count changed -> rebuild lane-name inputs
  // lane count changed — renumber so the labels still run left-to-right
  renumberCameraLabelsPage();
  render();
  saveLayout();
}

// Keeps the CAMERA column controls (number input + lanes hint) in sync
// with state — call after loading/importing too.
function syncCameraColumnControls() {
  const n = state.sections.CAMERA.columns;
  document.getElementById('colCountCamera').value = n;
  const hint = document.getElementById('cameraLanesHint');
  if (hint) hint.textContent = Array.from({ length: n }, (_, i) => i + 1).join(' ');
}

// The column-count input is directly typeable (1–12, clamped); +/- below
// keeps working via the same setCameraColumns path.
document.getElementById('colCountCamera').addEventListener('change', e => {
  const v = parseInt(e.target.value, 10);
  setCameraColumns(Number.isNaN(v) ? state.sections.CAMERA.columns : v);
});
document.getElementById('colCountCamera').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
});

// Keep the controls in sync with the default count on load.
syncCameraColumnControls();

// Pushes the current state onto every sidebar control — run after loading
// a layout so the controls reflect the restored values (localStorage
// auto-save, layout-import, or reset). Idempotent; safe to call repeatedly.
function syncSidebarState() {
  const setCheck = (id, on) => { const el = document.getElementById(id); if (el) el.checked = on; };
  const setValue = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  setCheck('chkHeaderTable', state.showHeaderTable);
  setCheck('chkEndSlash', state.showEndSlash);
  setCheck('chkInbetweenSymbols', state.inbetweenCarrySymbols);
  setCheck('chkMemoLabel', state.memo.showLabel);
  setCheck('chkMemoBorder', state.memo.showBorder);
  setCheck('chkBookVertical', state.bookStyle.vertical);
  document.querySelectorAll('.secVisible').forEach(el => { el.checked = !!state.sections[el.dataset.sec].visible; });
  document.querySelectorAll('.secHeader').forEach(el => { el.checked = !!state.sections[el.dataset.sec].showHeader; });
  document.querySelectorAll('.secLetters').forEach(el => { el.checked = !!state.sections[el.dataset.sec].showLetters; });
  setValue('colCountAction', state.sections.ACTION.columns);
  setValue('colCountCamera', state.sections.CAMERA.columns);
  document.getElementById('inbetweenCountLabel').textContent = state.sections.INBETWEEN.columns;
  setValue('bookShapeSelect', state.bookStyle.shape);
  setValue('bookLayoutSelect', state.bookLayoutStrategy);
  syncCameraLabelModeSelect();
  syncCameraColumnControls();
  buildColumnLabelInputs(); // column counts may differ from the current inputs
  syncSectionNameInputs();
  syncHeaderLabelInputs();
}

document.querySelectorAll('.colMinus').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.sec === 'CAMERA') setCameraColumns(state.sections.CAMERA.columns - 1);
    else setActionColumns(state.sections.ACTION.columns - 1);
  });
});
document.querySelectorAll('.colPlus').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.sec === 'CAMERA') setCameraColumns(state.sections.CAMERA.columns + 1);
    else setActionColumns(state.sections.ACTION.columns + 1);
  });
});

document.getElementById('resetBtn').addEventListener('click', () => {
  // ---- section toggles + column counts back to defaults ----
  state.showHeaderTable = true;
  state.showEndSlash = true;
  state.sections.ACTION.visible = true;
  state.sections.ACTION.showHeader = true;
  state.sections.ACTION.showLetters = true;
  state.sections.ACTION.columns = 8;
  state.sections.SOUND.visible = true;
  state.sections.SOUND.showHeader = true;
  state.sections.INBETWEEN.visible = true;
  state.sections.INBETWEEN.showHeader = true;
  state.sections.INBETWEEN.showLetters = true;
  state.sections.INBETWEEN.columns = 8;
  state.sections.CAMERA.visible = true;
  state.sections.CAMERA.showHeader = true;
  state.sections.CAMERA.showLetters = true;
  state.sections.CAMERA.columns = 3;

  document.getElementById('chkHeaderTable').checked = true;
  document.getElementById('chkEndSlash').checked = true;
  document.querySelectorAll('.secVisible').forEach(el => el.checked = true);
  document.querySelectorAll('.secHeader').forEach(el => el.checked = true);
  document.querySelectorAll('.secLetters').forEach(el => el.checked = true);
  document.getElementById('colCountAction').value = 8;
  document.getElementById('inbetweenCountLabel').textContent = 8;
  syncCameraColumnControls();

  // ---- custom display names back to defaults ----
  state.headerLabels = {};
  state.sectionLabels = {};
  state.columnLabels = {};
  syncHeaderLabelInputs();
  syncSectionNameInputs();
  buildColumnLabelInputs();

  // ---- layout + memo geometry back to defaults (text stays — it's data) ----
  state.layout = {
    scaleX: 1, scaleY: 1, wholeOffset: { x: 0, y: 0 },
    blockW: { 0: null, 1: null },
    blockOffset: { 0: { x: 0, y: 0 }, 1: { x: 0, y: 0 } },
    sectionW: {}, sectionOffset: {},
    headerH: { 0: null, 1: null }, headerOffset: { 0: 0, 1: 0 }, titleSplit: {}
  };
  state.titleTable = { x: null, y: null, w: null, h: null, colW: null };
  state.memo.x = null; state.memo.y = null; state.memo.w = null; state.memo.h = null;
  state.memo.showLabel = true; state.memo.showBorder = true;
  layoutSelection = null;

  // ---- appearance back to defaults: no paper, full opacity ----
  state.paper = { dataUrl: null, x: 0, y: 0, w: 0, h: 0, visible: false };
  state.tableOpacity = 1;

  // ---- shared appearance settings back to defaults ----
  state.bookStyle = { shape: 'none', vertical: false };
  state.bookLayoutStrategy = 'vertical';
  state.inbetweenCarrySymbols = true;
  state.cameraLabelMode = 'side';
  state.cameraLabelModeByPage = {};

  updateTableOpacityUI();
  updatePaperStatus();

  // push the restored defaults back onto the sidebar controls, persist
  // them so a reload restores them, then redraw
  syncSidebarState();
  saveLayout();
  render();
});
