// ==== export.js ====
// ==== XDTS export + full-state JSON export.
// ==== =============================================================
// XDTS export mirrors import.js: cell marks -> fieldId 0 (numbers, •
// as SYMBOL_TICK_1, ✕ as SYMBOL_NULL_CELL), dialogue -> fieldId 3 (one
// track per lane, speaker keeps its (TYPE) suffix), camera -> fieldId 5
// (one track per lane), duration from TIME, cut/scene from the header
// cell. Everything the XDTS schema cannot express (books, ink, memo,
// full mark symbols, layout, section settings) rides along in the
// "timesheetApp" extension key, so an app-exported file is valid XDTS
// for other tools AND round-trips losslessly back into this app.
// ---------------------------------------------------------------

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function baseFilename() {
  const cs = String(state.headerValues['CUT / SCENE'] || '').trim().replace(/[\\/:*?"<>|]+/g, '-');
  return cs || 'timesheet';
}

// Builds the XDTS document (version 5) from the current sheet state.
function buildXdts() {
  const duration = Math.max(1, Math.round(state.timeSeconds * 24));
  const cutScene = String(state.headerValues['CUT / SCENE'] || '').trim();
  const m = cutScene.match(/^(\d+)\s*[-/]\s*(\d+)$/);
  const cut = m ? m[1] : cutScene;
  const scene = m ? m[2] : '';
  const fields = [];

  // ---- fieldId 0: cell marks -> one track per ACTION column ----
  const cellTracks = [];
  const nCols = state.sections.ACTION.columns;
  for (let col = 0; col < nCols; col++) {
    const frames = [];
    for (let page = 0; page < totalPagesNeeded(); page++) {
      for (let blockId = 0; blockId < 2; blockId++) {
        for (let row = 1; row <= ROWS; row++) {
          const mk = state.marks[markKey(page, blockId, col, row)];
          if (!mk) continue;
          let values;
          if (mk.type === '.') values = ['SYMBOL_TICK_1'];            // in-between dot
          else if (mk.type === 'x') values = ['SYMBOL_NULL_CELL'];    // no image = empty cell
          else if (mk.type === 'repeat' || mk.type === 'stop') continue; // no XDTS equivalent — extension only
          else values = [String(mk.number != null ? mk.number : '')]; // plain / keyframe / breakdown numbers
          frames.push({ data: [{ id: 0, values }], frame: globalFrameOf(page, blockId, row) - 1 });
        }
      }
    }
    if (frames.length) cellTracks.push({ frames: frames.sort((a, b) => a.frame - b.frame), trackNo: col });
  }
  if (cellTracks.length) fields.push({ fieldId: 0, tracks: cellTracks });

  // ---- fieldId 3: dialogue -> one track per lane ----
  const dialogTracks = [];
  const maxDLane = Math.max(0, ...state.dialogue.map(d => (d.lane != null ? d.lane : 0)));
  for (let lane = 0; lane <= maxDLane; lane++) {
    const entries = state.dialogue.filter(d => (d.lane != null ? d.lane : 0) === lane).sort((a, b) => a.gFrom - b.gFrom);
    if (!entries.length) continue;
    const frames = [];
    for (const e of entries) {
      const speaker = e.speaker + (e.type ? ' (' + e.type + ')' : '');
      const text = e.text != null ? String(e.text) : '';
      frames.push({ data: [{ id: 0, values: [speaker, text] }], frame: e.gFrom - 1 });
      for (let g = e.gFrom + 1; g <= e.gTo; g++) {
        frames.push({ data: [{ id: 0, values: ['SYMBOL_HYPHEN'] }], frame: g - 1 });
      }
    }
    dialogTracks.push({ frames: frames.sort((a, b) => a.frame - b.frame), trackNo: lane });
  }
  if (dialogTracks.length) fields.push({ fieldId: 3, tracks: dialogTracks });

  // ---- fieldId 5: camera -> one track per lane ----
  // Each keyframe with an outgoing segment writes a data frame at its
  // frame (type + stored coordinates), hyphens fill up to the next
  // keyframe; a Map keyed by frame keeps later writes (data) winning over
  // earlier hyphens, so consecutive segments chain cleanly.
  const camTracks = [];
  const maxCLane = Math.max(0, ...state.camera.map(c => (c.lane != null ? c.lane : 0)));
  for (let lane = 0; lane <= maxCLane; lane++) {
    const entries = state.camera.filter(c => (c.lane != null ? c.lane : 0) === lane).sort((a, b) => camFrom(a) - camFrom(b));
    if (!entries.length) continue;
    const byFrame = new Map();
    for (const e of entries) {
      const kfs = e.keyframes;
      for (let i = 0; i < kfs.length - 1; i++) {
        const a = kfs[i], b = kfs[i + 1];
        const type = a.type || a.name || '';
        // write the stored coordinate values back when the keyframe has them
        const values = a.cam && a.cam.length ? [type].concat(a.cam) : [type];
        byFrame.set(a.frame - 1, { data: [{ id: 0, values }], frame: a.frame - 1 });
        for (let g = a.frame; g < b.frame; g++) {
          byFrame.set(g, { data: [{ id: 0, values: ['SYMBOL_HYPHEN'] }], frame: g });
        }
      }
    }
    const frames = [...byFrame.entries()].sort((x, y) => x[0] - y[0]).map(entry => entry[1]);
    if (frames.length) camTracks.push({ frames, trackNo: lane });
  }
  if (camTracks.length) fields.push({ fieldId: 5, tracks: camTracks });

  // ---- timeTableHeaders: one layer name per track ----
  const headers = [];
  if (cellTracks.length) {
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    headers.push({ fieldId: 0, names: cellTracks.map(t => letters[t.trackNo] || 'L' + (t.trackNo + 1)) });
  }
  if (dialogTracks.length) headers.push({ fieldId: 3, names: dialogTracks.map(t => 'D' + (t.trackNo + 1)) });
  if (camTracks.length) headers.push({ fieldId: 5, names: camTracks.map(t => 'Camera ' + (t.trackNo + 1)) });

  return {
    header: { cut, scene },
    timeTables: [{
      fields,
      duration,
      name: baseFilename(),
      timeTableHeaders: headers
    }],
    version: 5,
    // Extension: the full app state, so importing this file back into
    // the app restores everything (marks, lanes, ink, memo, layout...).
    timesheetApp: JSON.parse(JSON.stringify(state))
  };
}

function exportXdts() {
  downloadBlob(
    new Blob(['exchangeDigitalTimeSheet Save Data\n' + JSON.stringify(buildXdts(), null, 1)], { type: 'application/json' }),
    baseFilename() + '.xdts'
  );
}

function exportJson() {
  downloadBlob(
    new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }),
    baseFilename() + '.json'
  );
}

document.getElementById('exportXdtsBtn').addEventListener('click', () => { exportXdts(); hideExportMenu(); });
document.getElementById('exportJsonBtn').addEventListener('click', () => { exportJson(); hideExportMenu(); });
