// ==== import.js ====
// ==== XDTS (exchangeDigitalTimeSheet) file import.
// ==== =============================================================
// XDTS files are text: the first line is the marker "exchangeDigitalTimeSheet
// Save Data" and the rest is JSON (version 5). Fields:
//   fieldId 0 (Cell)       -> ACTION column marks (track n -> column n)
//   fieldId 3 (Dialog)     -> SOUND dialogue entries (speaker + text)
//   fieldId 5 (Camerawork) -> CAMERA lane notes (instruction string)
// Frames are 0-indexed; SYMBOL_HYPHEN continues the previous instruction;
// SYMBOL_NULL_CELL is an empty cell; SYMBOL_TICK_1 is the in-between dot.
// The app keeps its own column/lane counts (ACTION 8, CAMERA 3) and fills
// the first N tracks. Import REPLACES all current sheet data.
// ---------------------------------------------------------------

// Splits the raw file text at the marker line and parses the JSON payload.
function parseXdtsText(text) {
  const idx = String(text).indexOf('{');
  if (idx < 0) throw new Error('no JSON payload found');
  const data = JSON.parse(String(text).slice(idx));
  if (!data || typeof data !== 'object' || !Array.isArray(data.timeTables) || !data.timeTables.length) {
    throw new Error('not an XDTS file (missing timeTables)');
  }
  return data;
}

// Pushes a dialogue entry as ONE entry spanning its whole frame range —
// the sheet renders a segment in every block/page it crosses. lane is
// the XDTS dialog track it came from (kept as a manual lane).
function pushDialogueSpan(speaker, type, text, gFrom, gTo, lane) {
  const seg = frameToSegment(gFrom);
  state.dialogue.push({ id: nextTrackId(), page: seg.page, blockId: seg.blockId, gFrom, gTo, speaker, type, text, lane });
}

// Pushes a camera note as a keyframe chain (A@start → B@end, or more
// keyframes when the run carried several data frames). cam is the
// coordinate values captured from each data frame (e.g. [x, y, scale,
// rot, centerX, centerY] as strings) — stored as-is so Export XDTS can
// write them back, never shown on the sheet. Zero-length chains (a data
// frame with no room for a B) are dropped.
function pushCameraNote(lane, kfs) {
  if (!kfs || kfs.length < 2) return;
  const seg = frameToSegment(kfs[0].frame);
  state.camera.push({ id: nextTrackId(), page: seg.page, blockId: seg.blockId, lane, keyframes: kfs });
}

// fieldId 0: cell numbers -> ACTION column marks (track n -> column n).
// SYMBOL_NULL_CELL is the XDTS empty-cell symbol, which is the app's ✕
// (no image) mark; the trailing NULL past the sheet's own duration (the
// end sentinel) is skipped.
function importCellField(field, duration) {
  const n = state.sections.ACTION.columns;
  field.tracks.forEach((track, col) => {
    if (col >= n) return; // keep the app's column count; fill the first N
    for (const fr of track.frames || []) {
      const values = (fr.data && fr.data[0] && fr.data[0].values) || [];
      const v = values[0];
      if (v === undefined || v === 'SYMBOL_HYPHEN') continue;
      if (v === 'SYMBOL_TICK_1') {
        const seg = frameToSegment(fr.frame + 1);
        state.marks[markKey(seg.page, seg.blockId, col, seg.row)] = { type: '.', number: '' };
        continue;
      }
      if (v === 'SYMBOL_TICK_2') continue; // reverse-sheet symbol — no app equivalent
      if (v === 'SYMBOL_NULL_CELL') {
        if (fr.frame >= duration) continue; // end sentinel past the sheet
        const seg = frameToSegment(fr.frame + 1);
        state.marks[markKey(seg.page, seg.blockId, col, seg.row)] = { type: 'x', number: '' };
        continue;
      }
      const seg = frameToSegment(fr.frame + 1);
      state.marks[markKey(seg.page, seg.blockId, col, seg.row)] = { type: 'plain', number: String(v) };
    }
  });
}

// fieldId 3: dialog -> SOUND entries. First frame of a line carries the
// speaker (first value) + text (second value); SYMBOL_HYPHEN extends the
// line to its end frame. Each dialog track becomes a manual dialogue
// lane (kept as the entry's lane).
function importDialogField(field) {
  field.tracks.forEach((track, lane) => {
    const frames = (track.frames || []).slice().sort((a, b) => a.frame - b.frame);
    let current = null; // { gFrom, gTo, speaker, type, text }
    for (const fr of frames) {
      const values = (fr.data && fr.data[0] && fr.data[0].values) || [];
      const v = values[0];
      if (v === 'SYMBOL_HYPHEN') {
        if (current) current.gTo = fr.frame + 1;
        continue;
      }
      if (current) { pushDialogueSpan(current.speaker, current.type, current.text, current.gFrom, current.gTo, lane); current = null; }
      if (v === undefined || v === 'SYMBOL_NULL_CELL') continue;
      const { speaker, type } = splitSpeakerType(values[0]);
      const text = values[1] !== undefined ? String(values[1]) : '';
      current = { gFrom: fr.frame + 1, gTo: fr.frame + 1, speaker, type, text };
    }
    if (current) pushDialogueSpan(current.speaker, current.type, current.text, current.gFrom, current.gTo, lane);
  });
}

// fieldId 5: camerawork -> CAMERA notes (keyframe chains). Every data
// frame is a keyframe carrying the instruction string (type) + the
// coordinate values (cam); SYMBOL_HYPHEN extends the current segment
// until the next data frame (or the run's end). Each contiguous run of
// data+hyphen frames becomes ONE note, matching the old segment-per-note
// behavior: data@6 + data@18 in one track still make two notes A→B.
function importCameraField(field) {
  const n = state.sections.CAMERA.columns;
  field.tracks.forEach((track, lane) => {
    if (lane >= n) return; // keep the app's lane count; fill the first N
    const frames = (track.frames || []).slice().sort((a, b) => a.frame - b.frame);
    let note = null;       // { keyframes: [] } for the current contiguous run
    let lastHyphenG = null; // the run's extent so far (app frame, 1-indexed)
    const finalize = () => {
      if (note && note.keyframes.length === 1 && lastHyphenG > note.keyframes[0].frame) {
        note.keyframes.push({ frame: lastHyphenG, label: labelAt(note.keyframes.length), auto: true });
      }
      pushCameraNote(lane, note && note.keyframes);
      note = null;
      lastHyphenG = null;
    };
    for (const fr of frames) {
      const values = (fr.data && fr.data[0] && fr.data[0].values) || [];
      const v = values[0];
      if (v === 'SYMBOL_HYPHEN') {
        if (note) lastHyphenG = fr.frame + 1;
        continue;
      }
      if (v === undefined || v === 'SYMBOL_NULL_CELL') { finalize(); continue; }
      if (note) {
        // the previous note ends right before this data frame
        const endG = fr.frame; // 0-indexed frame = app frame just before it
        if (endG > note.keyframes[0].frame) note.keyframes.push({ frame: endG, label: labelAt(note.keyframes.length), auto: true });
        pushCameraNote(lane, note.keyframes);
      }
      note = { keyframes: [] };
      const type = String(v).trim();
      const kf = { frame: fr.frame + 1, label: labelAt(note.keyframes.length), auto: true };
      if (type) kf.type = type;
      if (values.length > 1) kf.cam = values.slice(1);
      note.keyframes.push(kf);
      lastHyphenG = fr.frame + 1;
    }
    finalize();
  });
}

// Applies a parsed XDTS document. Files written by this app carry a
// "timesheetApp" extension with the full app state — when present it is
// authoritative (lossless round-trip). Foreign files fall back to the
// XDTS field mapping below.
function importXdtsData(data) {
  const ext = data && data.timesheetApp;
  if (ext && typeof ext === 'object' && !Array.isArray(ext)) {
    Object.assign(state, ext);
    migrateCameraEntries();
    migrateLabelPlacementValues();
    syncCameraLabelModeSelect();
    syncCameraColumnControls();
    syncHeaderLabelInputs();
    syncSectionNameInputs();
    buildColumnLabelInputs();
    selectedCell = null;
    selectedExtra = [];
    navActive = null;
    editingBuffer = null;
    editingHeaderIndex = null;
    editingMemo = false;
    memoEditBuffer = null;
    clampCurrentPage();
    return;
  }
  state.marks = {};
  state.inbetweenMarks = {};
  state.dialogue = [];
  state.camera = [];
  state.books = [];
  state.ink = [];
  state.memo.text = '';
  state.headerValues = { EPISODE: '', TITLE: '', 'CUT / SCENE': '', ANIMATOR: '', PAGE: '', COMPOSITOR: '' };
  state.timeSeconds = 0;
  state.timeSecondsRaw = '';
  state.currentPage = 0;
  selectedCell = null;
  selectedExtra = [];
  navActive = null;
  editingBuffer = null;
  editingHeaderIndex = null;
  editingHeaderLabel = null;
  headerLabelBuffer = null;
  editingMemo = false;
  memoEditBuffer = null;

  const h = data.header;
  if (h) {
    const cut = String(h.cut == null ? '' : h.cut).trim();
    const scene = String(h.scene == null ? '' : h.scene).trim();
    state.headerValues['CUT / SCENE'] = cut && scene ? `${cut}-${scene}` : (cut || scene);
  }

  let duration = 0;
  for (const tt of data.timeTables) {
    if (tt && typeof tt.duration === 'number') duration = Math.max(duration, tt.duration);
  }
  state.timeSeconds = Math.max(1, Math.ceil(duration / 24));

  for (const tt of data.timeTables) {
    if (!tt || !Array.isArray(tt.fields)) continue;
    for (const field of tt.fields) {
      if (!field || !Array.isArray(field.tracks)) continue;
      if (field.fieldId === 0) importCellField(field, duration);
      else if (field.fieldId === 3) importDialogField(field);
      else if (field.fieldId === 5) importCameraField(field);
    }
  }
  // fresh foreign import: give the page's notes one continuous label run
  renumberCameraLabelsPage();
}

// Applies a full app-state JSON (the "Export JSON (full)" format): the
// entire `state` object is restored in place.
function importJsonData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('not a full JSON sheet');
  }
  Object.assign(state, data);
  migrateCameraEntries();
  migrateLabelPlacementValues();
  syncCameraLabelModeSelect();
  syncCameraColumnControls();
  syncHeaderLabelInputs();
  syncSectionNameInputs();
  buildColumnLabelInputs();
  selectedCell = null;
  selectedExtra = [];
  navActive = null;
  editingBuffer = null;
  editingHeaderIndex = null;
  editingHeaderLabel = null;
  headerLabelBuffer = null;
  editingMemo = false;
  memoEditBuffer = null;
  clampCurrentPage();
}

// ---------------------------------------------------------------
// UI: "Import XDTS…" lives in the Export menu and opens a file picker.
// ---------------------------------------------------------------
const xdtsFileInput = document.getElementById('xdtsFileInput');
document.getElementById('importXdtsBtn').addEventListener('click', () => { xdtsFileInput.click(); });
document.getElementById('importJsonBtn').addEventListener('click', () => { xdtsFileInput.click(); });
// The same file picker serves both imports; the payload is detected:
// XDTS files carry the exchangeDigitalTimeSheet marker (or timeTables),
// anything else is treated as a full app-state JSON.
xdtsFileInput.addEventListener('change', () => {
  const file = xdtsFileInput.files && xdtsFileInput.files[0];
  xdtsFileInput.value = ''; // allow re-picking the same file
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const text = String(reader.result);
      if (text.indexOf('exchangeDigitalTimeSheet') >= 0 || /"timeTables"\s*:/.test(text)) {
        importXdtsData(parseXdtsText(text));
      } else {
        importJsonData(JSON.parse(text));
      }
      hideImportMenu();
      render();
    } catch (err) {
      alert(`Failed to import: ${err.message}`);
    }
  };
  reader.readAsText(file);
});
