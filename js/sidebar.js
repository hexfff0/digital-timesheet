// ==== sidebar.js ====
// ==== Sidebar sync: header (title) table values, page switcher, and
// ==== per-column shorthand.
// ==== =============================================================
// ---------------------------------------------------------------
// Header (title) table values: EPISODE / TITLE / TIME / CUT-SCENE / ... /
// COMPOSITOR, typed here or edited by clicking the cells on the sheet.
// TIME is a normal row here (label renameable like the others) but its value
// stays numeric in state.timeSeconds, with the raw typed text kept in
// state.timeSecondsRaw. Built once, synced in place so typing is never
// disrupted.
// ---------------------------------------------------------------
function buildHeaderValueInputs() {
  const container = document.getElementById('headerValueInputs');
  if (!container) return;
  container.innerHTML = '';
  HEADER_LABELS.forEach(label => {
    const row = document.createElement('div');
    row.className = 'row';
    row.style.gap = '6px';

    // editable display name for the label cell ('' = built-in name);
    // PAGE gets a name field too (its value is auto/numeric, lives elsewhere)
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.dataset.headerLabelName = label;
    nameInput.value = headerDisplayName(label);
    nameInput.title = 'Rename this label — leave empty for the default (' + label + ')';
    nameInput.style.cssText = 'font-size:11px;min-width:118px;width:118px;flex-shrink:0;padding:3px 5px;border:1px solid var(--separator);border-radius:6px;background:#fff;color:var(--text);font-weight:600;';
    nameInput.addEventListener('change', () => {
      const v = nameInput.value.trim();
      if (v) state.headerLabels[label] = v;
      else delete state.headerLabels[label];
      nameInput.value = headerDisplayName(label);
      render();
      saveLayout(); // custom renames survive a reload
    });

    row.appendChild(nameInput);
    if (label === 'PAGE') { // no value field — auto/numeric
      container.appendChild(row);
      return;
    }

    const input = document.createElement('input');
    input.type = 'text';
    input.dataset.headerLabel = label;
    input.value = label === 'TIME' ? timeSidebarText() : (state.headerValues[label] || '');
    input.placeholder = label === 'TIME' ? 'e.g. 1+12 or 3' : (label === 'CUT / SCENE' ? 'e.g. 3' : 'e.g. My Ep 1');
    input.style.cssText = 'flex:1;min-width:0;padding:4px 6px;border:1px solid var(--separator);border-radius:8px;font-size:12px;background:#fff;color:var(--text);';
    input.addEventListener('input', () => {
      if (label === 'TIME') {
        state.timeSecondsRaw = input.value;
        state.timeSeconds = parseTimeInput(input.value);
      } else {
        state.headerValues[label] = input.value;
      }
      render();
    });

    row.appendChild(input);
    container.appendChild(row);
  });
}

function syncHeaderLabelInputs() {
  const container = document.getElementById('headerValueInputs');
  if (!container) return;
  container.querySelectorAll('input[data-header-label-name]').forEach(input => {
    if (document.activeElement === input) return; // don't disrupt active typing
    const v = headerDisplayName(input.dataset.headerLabelName);
    if (input.value !== v) input.value = v;
  });
}

function syncHeaderValueInputs() {
  const container = document.getElementById('headerValueInputs');
  if (!container) return;
  container.querySelectorAll('input[data-header-label]').forEach(input => {
    if (document.activeElement === input) return; // don't disrupt active typing
    const label = input.dataset.headerLabel;
    const v = label === 'TIME' ? timeSidebarText() : (state.headerValues[label] || '');
    if (input.value !== v) input.value = v;
  });
}

buildHeaderValueInputs();

// ---- Section header renames (ACTION/SOUND/INBETWEEN/CAMERA/MEMO) ----
function syncSectionNameInputs() {
  document.querySelectorAll('.sec-name-input').forEach(inp => {
    if (document.activeElement === inp) return;
    const v = sectionDisplayName(inp.dataset.sec);
    if (inp.value !== v) inp.value = v;
  });
}
function wireSectionNameInputs() {
  document.querySelectorAll('.sec-name-input').forEach(inp => {
    const sec = inp.dataset.sec;
    inp.addEventListener('change', () => {
      const v = inp.value.trim();
      if (v) state.sectionLabels[sec] = v;
      else delete state.sectionLabels[sec];
      inp.value = sectionDisplayName(sec);
      render();
      saveLayout(); // custom renames survive a reload
    });
  });
}
wireSectionNameInputs();
syncSectionNameInputs();

// ---- Per-column label renames (ACTION/INBETWEEN letters, CAMERA numbers) ----
// One small input per column, showing the current label (custom override
// or built-in). Rebuilt whenever a column count changes; rebuilt in place
// so a focused input is never disrupted.
function buildColumnLabelInputs() {
  ['ACTION', 'INBETWEEN', 'CAMERA'].forEach(sec => {
    const box = document.getElementById(sec.toLowerCase() + 'ColLabels');
    if (!box || box.contains(document.activeElement)) return;
    const n = state.sections[sec].columns;
    const defaults = sec === 'CAMERA' ? numericLabels(n) : alphaLabels(n);
    const newInputs = [];
    for (let c = 0; c < n; c++) {
      const old = box.children[c];
      let inp = old && old.tagName === 'INPUT' && old.dataset.colIndex === String(c) ? old : null;
      if (!inp) {
        inp = document.createElement('input');
        inp.type = 'text';
        inp.dataset.colIndex = c;
        inp.title = 'Rename ' + sec + ' column ' + (c + 1) + ' — leave empty for the default';
        inp.addEventListener('change', () => {
          const v = inp.value.trim();
          if (v) state.columnLabels[sec + ':' + c] = v;
          else delete state.columnLabels[sec + ':' + c];
          inp.value = columnDisplayLabel(sec, c) || defaults[c];
          render();
          saveLayout(); // custom renames survive a reload
        });
      }
      inp.value = columnDisplayLabel(sec, c) || defaults[c];
      newInputs.push(inp);
    }
    box.innerHTML = '';
    newInputs.forEach(el => box.appendChild(el));
  });
}
buildColumnLabelInputs();

// ---------------------------------------------------------------
// Page (Page) switcher
// ---------------------------------------------------------------
function refreshPageLabel() {
  const total = totalPagesNeeded();
  document.getElementById('pageLabel').textContent = `Page ${state.currentPage + 1} / ${total}`;
  document.getElementById('prevPageBtn').disabled = state.currentPage <= 0;
  document.getElementById('nextPageBtn').disabled = state.currentPage >= total - 1;
}

function goToPage(newPage) {
  commitEditingIfAny();
  commitHeaderEditingIfAny();
  commitSectionNameEditingIfAny();
  commitColLabelEditingIfAny();
  commitHeaderLabelEditingIfAny();
  commitMemoEditingIfAny();
  selectedCell = null;
  selectedExtra = [];
  navActive = null;
  editingBuffer = null;
  state.currentPage = newPage;
  // the label dropdown follows the page (per-page placement override),
  // and the page's keyframe labels renumber in that page's reading order
  syncCameraLabelModeSelect();
  renumberCameraLabelsPage();
  render();
}

document.getElementById('prevPageBtn').addEventListener('click', () => {
  if (state.currentPage > 0) goToPage(state.currentPage - 1);
});
document.getElementById('nextPageBtn').addEventListener('click', () => {
  if (state.currentPage < totalPagesNeeded() - 1) goToPage(state.currentPage + 1);
});

// ---------------------------------------------------------------
// Per-column shorthand entry (sidebar): "1 2 n n 3 n 4" style quick fill
// for the CURRENT page. Tokens map to frames 1..144 in order (left block
// 1-72 first, then right block 73-144). "n" clears that frame; "x" = no
// image, "." = in-between dot; anything else sets it as a plain number
// (shape can be changed later via right-click on the grid). Rows beyond
// the typed tokens are left as-is.
// ---------------------------------------------------------------
function columnToShorthandString(col) {
  const tokens = [];
  let lastIndex = -1;
  for (let i = 1; i <= ROWS * 2; i++) {
    const blockId = i <= ROWS ? 0 : 1;
    const row = i <= ROWS ? i : i - ROWS;
    const mark = state.marks[markKey(state.currentPage, blockId, col, row)];
    let tok = 'n';
    if (mark) {
      if (mark.type === 'x' || mark.type === '.') tok = mark.type;
      else if (mark.type === 'repeat') tok = 'rep';
      else if (mark.type === 'stop') tok = 'stop';
      else tok = mark.number;
      lastIndex = i;
    }
    tokens.push(tok);
  }
  if (lastIndex < 0) return '';
  return tokens.slice(0, lastIndex).join(' ');
}

function applyColumnShorthand(col, text) {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  for (let i = 0; i < tokens.length && i < ROWS * 2; i++) {
    const frameIdx = i + 1;
    const blockId = frameIdx <= ROWS ? 0 : 1;
    const row = frameIdx <= ROWS ? frameIdx : frameIdx - ROWS;
    const key = markKey(state.currentPage, blockId, col, row);
    const tok = tokens[i];
    const lower = tok.toLowerCase();
    if (lower === 'n') {
      delete state.marks[key];
    } else if (lower === 'x') {
      state.marks[key] = { type: 'x', number: '' };
    } else if (tok === '.') {
      state.marks[key] = { type: '.', number: '' };
    } else if (lower === 'rep') {
      state.marks[key] = { type: 'repeat', number: '' };
    } else if (lower === 'stop') {
      state.marks[key] = { type: 'stop', number: '' };
    } else {
      const existing = state.marks[key];
      state.marks[key] = { type: existing ? existing.type : 'plain', number: tok };
    }
  }
  render();
}

// ---------------------------------------------------------------
// Dialogue & Camera sidebar textareas (auto-sheet format), kept in sync
// two ways: typing here parses into state.dialogue/state.camera, and
// every render() rebuilds the text from state (so drags on the sheet
// show up here too). Timecodes are relative to the current page's first
// frame (0+00 = frame 1 of this page), matching the frame numbers on the
// sheet. Only the current page's entries are shown/edited here.
// ---------------------------------------------------------------

// STRICT local-frame parser for the sidebar textareas: FROM/TO must be
// "S+F" relative to the current page's first frame (0+00 = frame 1 of this
// page), so a bare number like "26" is REJECTED instead of being silently
// misread as 26 SECONDS (= frame 625, off the page). Returns { ok, value }
// — value is a 1-indexed local frame 1..(ROWS*2) when ok.
function parseLocalFrameStrict(str) {
  const s = String(str || '').trim();
  const m = s.match(/^(\d+)\s*\+\s*(\d+)$/);
  if (!m) return { ok: false };
  const total = (parseInt(m[1], 10) || 0) * 24 + (parseInt(m[2], 10) || 0);
  const local = total + 1;
  return { ok: local >= 1 && local <= ROWS * 2, value: local };
}

function formatLocalFrame(g) {
  const local = g - state.currentPage * ROWS * 2;
  const total = Math.max(0, local - 1);
  return `${Math.floor(total / 24)}+${total % 24}`;
}

// Splits a dialogue speaker into { speaker, type } — the type is a
// trailing (SE)/(M)/(OFF)/(ME)/(N)/(T)/(ON)/(背)/(ノンモン)/(独)
// suffix (auto-sheet convention).
const DIALOGUE_SPEAKER_TYPE_RE = /\s*\((SE|ME|OFF|ON|ノンモン|M|N|T|背|独)\)\s*$/i;
function splitSpeakerType(speakerRaw) {
  const raw = String(speakerRaw || '').trim();
  const match = raw.match(DIALOGUE_SPEAKER_TYPE_RE);
  if (!match) return { speaker: raw, type: '' };
  return { speaker: raw.slice(0, match.index).trim(), type: match[1].toUpperCase() };
}

// Shows a compact "line(s) not added" warning under the given textarea —
// the app still applies every VALID line, but a bad line is never silently
// dropped: the user sees which line number and why.
function setTaStatus(id, errors) {
  const el = document.getElementById(id);
  if (!el) return;
  if (!errors.length) { el.textContent = ''; return; }
  const n = errors.length;
  el.textContent = `${n} line${n === 1 ? '' : 's'} not added — fix and keep typing:\n` +
    errors.slice(0, 4).join('\n');
}

// Parses the dialogue textarea (one line per entry, current page only)
// and replaces the current page's dialogue entries. Each line must be
// `FROM | TO | SPEAKER | TEXT` with FROM/TO as strict "S+F" (0+00 = first
// frame of this page); anything malformed is reported in the status box
// instead of vanishing.
function applyDialogueTextarea() {
  const ta = document.getElementById('dialogueTextarea');
  const page = state.currentPage;
  const pageStart = page * ROWS * 2;
  const next = [];
  const errors = [];
  String(ta.value || '').split(/\r?\n/).forEach((line, li) => {
    const clean = String(line || '').trim();
    if (!clean || clean.charAt(0) === '#') return;
    const parts = clean.split('|').map(p => p.trim());
    if (parts.length < 2) { errors.push(`line ${li + 1}: need at least FROM | TO`); return; }
    const fromR = parseLocalFrameStrict(parts[0]);
    const toR = parseLocalFrameStrict(parts[1]);
    if (!fromR.ok || !toR.ok) {
      errors.push(`line ${li + 1}: FROM/TO must be "S+F", e.g. 0+12 (a bare number is seconds ×24 — off the page)`);
      return;
    }
    const from = fromR.value, to = toR.value;
    const gFrom = pageStart + Math.min(from, to);
    const gTo = pageStart + Math.max(from, to);
    const { speaker, type } = splitSpeakerType(parts[2]);
    const text = parts.slice(3).join('|').trim();
    const blockId = (from <= ROWS ? 0 : 1);
    next.push({ id: nextTrackId(), page, blockId, gFrom, gTo, speaker, type, text });
  });
  state.dialogue = state.dialogue.filter(e => e.page !== page).concat(next);
  setTaStatus('dialogueStatus', errors);
}

// Parses the camera textarea (one line per entry, a keyframe chain). The
// strict sidebar format has SIX fixed |columns|:
//   FROM | TO | TYPE | NAME | A | B   — plus OPTIONAL trailing extensions
//     · a bare `S+F` after B  = the QTU/QTB ア (animation-start) position
//     · `C:S+F` (any letter)  = a middle keyframe at that time
//     · `@TYPE`               = the NEXT segment's interpolation type
//   e.g. 0+00 | 2+00 | QTU | Zoom to CU | A | B | 0+12 | C:1+12 | @OL
// NAME defaults to the type; A/B are the circled first/last keyframe names.
// FROM/TO and every `S+F` in the trailing tokens must be strict "S+F" (a
// bare number is rejected — it reads as SECONDS ×24 and lands off-page).
// The lane is the first free lane that doesn't overlap.
function applyCameraTextarea() {
  const ta = document.getElementById('cameraTextarea');
  const page = state.currentPage;
  const pageStart = page * ROWS * 2;
  const n = state.sections.CAMERA.columns;
  const others = state.camera.filter(e => e.page !== page);
  const next = [];
  const errors = [];
  const occupied = []; // { lane, gFrom, gTo } for auto-lane picking
  const pickLane = (gFrom, gTo) => {
    for (let lane = 0; lane < n; lane++) {
      if (!occupied.some(o => o.lane === lane && gFrom <= o.gTo && o.gFrom <= gTo)) {
        occupied.push({ lane, gFrom, gTo });
        return lane;
      }
    }
    return 0;
  };
  String(ta.value || '').split(/\r?\n/).forEach((line, li) => {
    const clean = String(line || '').trim();
    if (!clean || clean.charAt(0) === '#') return;
    const parts = clean.split('|').map(p => p.trim());
    if (parts.length < 2) { errors.push(`line ${li + 1}: need at least FROM | TO`); return; }
    const fromR = parseLocalFrameStrict(parts[0]);
    const toR = parseLocalFrameStrict(parts[1]);
    if (!fromR.ok || !toR.ok) {
      errors.push(`line ${li + 1}: FROM/TO must be "S+F", e.g. 0+12 (a bare number is seconds ×24 — off the page)`);
      return;
    }
    const from = fromR.value, to = toR.value;
    const gFrom = pageStart + Math.min(from, to);
    const gTo = pageStart + Math.max(from, to);
    const type = parts[2] || '';
    const nameTok = (parts[3] || '').trim();
    const labelStart = parts[4] || 'A';
    const labelEnd = parts[5] || 'B';
    // trailing tokens (from column 7 on): ア (bare S+F), extra keyframes
    // `C:S+F`, extra segment types `@OL`
    const extraKfs = [];
    const extraSegs = [];
    let aFrame = null;
    let trailingErr = null;
    for (let i = 6; i < parts.length; i++) {
      const p = parts[i];
      if (!p) continue;
      if (p.charAt(0) === '@') { extraSegs.push(p.slice(1).trim()); continue; }
      const kfM = p.match(/^([^:]+):(.+)$/);
      if (kfM) {
        const lf = parseLocalFrameStrict(kfM[2]);
        if (lf.ok) { extraKfs.push({ label: kfM[1].trim(), frame: pageStart + lf.value }); continue; }
        trailingErr = trailingErr || `line ${li + 1}: keyframe time "${kfM[2]}" must be "S+F"`;
        continue;
      }
      const af = parseLocalFrameStrict(p);
      if (af.ok) { if (aFrame == null) aFrame = pageStart + af.value; continue; }
      trailingErr = trailingErr || `line ${li + 1}: "${p}" — unknown; use S+F (ア), LABEL:S+F (keyframe), or @TYPE`;
    }
    if (trailingErr) { errors.push(trailingErr); return; }
    const kfs = [{ frame: gFrom, label: labelStart || 'A' }]
      .concat(extraKfs)
      .concat([{ frame: gTo, label: labelEnd || 'B' }])
      .sort((x, y) => x.frame - y.frame);
    // a label matching the positional default is auto (renumbered with the
    // page's sequence); anything else is a custom name and is kept as-is
    kfs.forEach((kf, i) => { if (kf.auto == null) kf.auto = (kf.label === labelAt(i)); });
    // kfs[i].type = the segment i→i+1 (interpolation); the last keyframe
    // has no outgoing segment
    const segTypes = [type || ''].concat(extraSegs);
    kfs.forEach((kf, i) => {
      if (i < segTypes.length && segTypes[i]) kf.type = segTypes[i];
      if (i === 0) {
        if (aFrame != null) kf.aFrame = Math.max(gFrom, Math.min(aFrame, gTo));
        if (nameTok) kf.name = nameTok;
      }
    });
    const blockId = (from <= ROWS ? 0 : 1);
    next.push({ id: nextTrackId(), page, blockId, lane: pickLane(kfs[0].frame, kfs[kfs.length - 1].frame), keyframes: kfs });
  });
  state.camera = others.concat(next);
  renumberCameraLabelsPage();
  setTaStatus('cameraStatus', errors);
}

// Pads a row of cells so every pipe lines up into columns (monospace),
// e.g. `0+00 | 2+00 | PAN | PAN | A | B` — readable at a glance, and still
// split-parseable by `|`. Empty cells become one empty cell.
function alignColumns(cells) {
  const rows = cells.map(r => r.map(c => String(c == null ? '' : c)));
  const widths = [];
  rows.forEach(r => r.forEach((c, i) => { widths[i] = Math.max(widths[i] || 0, c.length); }));
  return rows.map(r => r.map((c, i) => c + (i < r.length - 1 ? ' '.repeat(widths[i] - c.length) : '')).join(' | '));
}

// Rebuilds both textareas from state (current page only), unless the
// user is actively typing in one of them. Dialogue lines are always
// 4 columns (FROM | TO | SPEAKER | TEXT); camera lines are always
// 6 columns (FROM | TO | TYPE | NAME | A | B) with any middle keyframes,
// segment-type changes or ア positions appended as trailing tokens — the
// fixed column count keeps the sidebar parse position-stable.
function buildTrackTextareas() {
  const dTa = document.getElementById('dialogueTextarea');
  const cTa = document.getElementById('cameraTextarea');
  const page = state.currentPage;
  const pageStart = page * ROWS * 2;

  if (dTa && document.activeElement !== dTa) {
    const rows = state.dialogue
      .filter(e => e.page === page && e.gFrom >= pageStart + 1 && e.gFrom <= pageStart + ROWS * 2)
      .sort((a, b) => a.gFrom - b.gFrom)
      .map(e => {
        const speaker = e.type ? `${e.speaker} (${e.type})` : e.speaker;
        return [formatLocalFrame(e.gFrom), formatLocalFrame(e.gTo), speaker, e.text || ''];
      });
    dTa.value = rows.length ? alignColumns(rows).join('\n') : '';
  }

  if (cTa && document.activeElement !== cTa) {
    const rows = state.camera
      .filter(e => e.page === page && camFrom(e) >= pageStart + 1 && camFrom(e) <= pageStart + ROWS * 2)
      .sort((a, b) => camFrom(a) - camFrom(b))
      .map(e => {
        const kfs = e.keyframes;
        const a = kfs[0], b = kfs[kfs.length - 1];
        // the FIXED six columns: FROM | TO | TYPE | NAME | A | B
        const cols = [
          formatLocalFrame(a.frame),
          formatLocalFrame(b.frame),
          a.type || '',
          a.name && a.name !== a.type ? a.name : '',
          a.label || 'A',
          b.label || 'B',
        ];
        // trailing extensions after B: ア (QTU/QTB), middle keyframes
        // `LABEL:S+F`, and the next segment's type `@TYPE`
        const trail = [];
        if (a.aFrame != null && (a.type === 'QTU' || a.type === 'QTB')) trail.push(formatLocalFrame(a.aFrame));
        for (let i = 1; i < kfs.length - 1; i++) trail.push(`${kfs[i].label || labelAt(i)}:${formatLocalFrame(kfs[i].frame)}`);
        for (let i = 1; i < kfs.length - 1; i++) { if (kfs[i].type) trail.push('@' + kfs[i].type); }
        return cols.concat(trail);
      });
    cTa.value = rows.length ? alignColumns(rows).join('\n') : '';
  }
}

document.getElementById('dialogueTextarea').addEventListener('input', () => {
  applyDialogueTextarea();
  render();
});
document.getElementById('cameraTextarea').addEventListener('input', () => {
  applyCameraTextarea();
  render();
});

function buildColumnShorthandInputs() {
  const container = document.getElementById('columnShorthandContainer');
  if (!container || container.contains(document.activeElement)) return; // don't disrupt active typing
  container.innerHTML = '';
  const n = state.sections.ACTION.columns;
  const labels = alphaLabels(n).map((l, c) => columnDisplayLabel('ACTION', c) || l);
  for (let c = 0; c < n; c++) {
    const row = document.createElement('div');
    row.className = 'row';
    row.style.gap = '6px';
    row.style.marginTop = '4px';

    const span = document.createElement('span');
    span.textContent = labels[c] + ' :';
    span.style.width = '20px';
    span.style.flexShrink = '0';
    span.style.fontWeight = 'bold';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'e.g. 1 2 n x . 3 n 4';
    input.style.cssText = 'flex:1;min-width:0;padding:4px 6px;border:1px solid #ccc;border-radius:4px;font-size:12px;';
    input.value = columnToShorthandString(c);
    input.addEventListener('change', () => applyColumnShorthand(c, input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    });

    row.appendChild(span);
    row.appendChild(input);
    container.appendChild(row);
  }
}
