/**
 * Guessy-Go-Round word stats — Google Apps Script backend.
 *
 * Paste this into Extensions → Apps Script of a Google Sheet and deploy it as a
 * web app (see stats-backend/README.md). The game POSTs batches of word events;
 * each event becomes one row in the "Events" tab, and the "Summary" tab is
 * rebuilt with per-word skip rates. A GET returns the same summary as JSON,
 * which a future Hard mode can read to deal frequently-skipped words more often.
 */

const EVENTS = 'Events';
const SUMMARY = 'Summary';
const HEADERS = ['time', 'id', 'lang', 'word', 'mode', 'card', 'seconds', 'end', 'quickSkip', 'device'];
const QUICK_SKIP_SEC = 3;   // a "Change Word" faster than this counts as a quick skip
const MAX_BATCH = 500;

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (_) { return json_({ ok: false, error: 'bad json' }); }
  const events = Array.isArray(body.events) ? body.events.slice(0, MAX_BATCH) : [];
  const device = clean_(body.device, 40);

  // The game may resend a batch if it never saw our reply — skip ids seen recently.
  const cache = CacheService.getScriptCache();
  const ids = events.map(ev => 'e:' + clean_(ev.id, 60)).filter(id => id.length > 2);
  const seen = ids.length ? cache.getAll(ids) : {};
  const fresh = {};
  const rows = [];
  events.forEach(ev => {
    const key = 'e:' + clean_(ev.id, 60);
    if (key.length <= 2 || seen[key] || fresh[key]) return;
    fresh[key] = '1';
    const sec = Math.round(Math.max(0, Number(ev.ms) || 0) / 100) / 10;
    const end = clean_(ev.end, 10);
    rows.push([
      new Date(Number(ev.t) || Date.now()), key.slice(2), clean_(ev.l, 5), clean_(ev.w, 120),
      clean_(ev.mode, 10), clean_(ev.card, 20), sec, end,
      end === 'change' && sec < QUICK_SKIP_SEC ? 1 : 0, device,
    ]);
  });

  if (rows.length) {
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const sh = events_();
      sh.getRange(sh.getLastRow() + 1, 1, rows.length, HEADERS.length).setValues(rows);
      writeSummary_(summarize_(sh));
    } finally {
      lock.releaseLock();
    }
    cache.putAll(fresh, 21600);  // 6 hours
  }
  return json_({ ok: true, added: rows.length });
}

function doGet() {
  const words = {};
  summarize_(events_()).forEach(r => {
    words[r.lang + '|' + r.word] = { shown: r.shown, quickSkips: r.quickSkips, avgSec: r.avgSec };
  });
  return json_({ ok: true, words });
}

// ── helpers ──────────────────────────────────────────────────────────────────
function events_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(EVENTS);
  if (!sh) {
    sh = ss.insertSheet(EVENTS);
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
  }
  return sh;
}

function summarize_(sh) {
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  const agg = {};
  sh.getRange(2, 1, n, HEADERS.length).getValues().forEach(r => {
    const k = r[2] + '|' + r[3];
    const a = agg[k] || (agg[k] = { lang: r[2], word: r[3], shown: 0, quickSkips: 0, totalSec: 0 });
    a.shown++;
    a.quickSkips += Number(r[8]) || 0;
    a.totalSec += Number(r[6]) || 0;
  });
  return Object.values(agg).map(a => ({
    lang: a.lang, word: a.word, shown: a.shown, quickSkips: a.quickSkips,
    skipRate: Math.round(a.quickSkips / a.shown * 100) / 100,
    avgSec: Math.round(a.totalSec / a.shown * 10) / 10,
  })).sort((x, y) => y.skipRate - x.skipRate || y.shown - x.shown);
}

function writeSummary_(rows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SUMMARY) || ss.insertSheet(SUMMARY, 0);
  sh.clearContents();
  const out = [['lang', 'word', 'shown', 'quick skips', 'skip rate', 'avg seconds on screen']]
    .concat(rows.map(r => [r.lang, r.word, r.shown, r.quickSkips, r.skipRate, r.avgSec]));
  sh.getRange(1, 1, out.length, out[0].length).setValues(out);
  sh.setFrozenRows(1);
  sh.getRange(2, 5, Math.max(1, rows.length), 1).setNumberFormat('0%');
}

// Strings only, length-capped, and never starting with a character Sheets
// would treat as a formula (the endpoint is public).
function clean_(v, max) {
  const s = String(v == null ? '' : v).slice(0, max);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
