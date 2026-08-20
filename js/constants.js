// ==== constants.js ====
// ==== Canvas element, 2D context, and base sheet measurements.
// ==== =============================================================
const canvas = document.getElementById('sheet');
const ctx = canvas.getContext('2d');

// ---------------------------------------------------------------
// Base measurements: same source-derived layout as the original
// A3 @150dpi (1754x2480) exposure-sheet generator. All the numbers
// below are the untouched reference constants; render() derives
// everything else from the live `state` object.
// ---------------------------------------------------------------

const PAGE_W = 1754;
const PAGE_H = 2480;

const HDR_TOP = 47;
const HDR_MID = 71.5;
const HDR_BOT = 140;
const HDR_COLS = [51.5, 181, 638, 767.5, 969, 1099.5, 1230, 1360.5];
const HEADER_LABELS = ['EPISODE', 'TITLE', 'CUT / SCENE', 'TIME', 'ANIMATOR', 'PAGE', 'COMPOSITOR'];

const GRID_TOP_BASE = 440;
const TITLE_BOT_BASE = 467;
const LETTER_BOT_BASE = 494;
const ROW_BOTTOM_BASE = 2389;
const ROWS = 72;
const ROW_H_BASE = (ROW_BOTTOM_BASE - LETTER_BOT_BASE) / ROWS; // unaffected by any vertical shift
function getRowH() { return ROW_H_BASE * getScaleY(); } // level-0 whole-table height scale also stretches every frame row

const NUMCOL_W = 76;
const BLOCK_W = 769;
const BLOCK1_X = 88.5;
const BLOCK2_X = BLOCK1_X + BLOCK_W + NUMCOL_W;

const LW_NORMAL = 1;
const LW_INTERVAL = 2.5;
const LW_SECOND = 4.5;

// base widths, used as proportional weights when a whole section is hidden
const BASE_WIDTHS = { ACTION: 210.5, SOUND: 47.5, INBETWEEN: 357, CAMERA: 154 };
const SECTION_ORDER = ['ACTION', 'SOUND', 'INBETWEEN', 'CAMERA'];

