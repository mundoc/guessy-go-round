/**
 * Guessy-Go-Round word stats — Google Apps Script backend.
 *
 * Paste this into Extensions → Apps Script of a Google Sheet and deploy it as a
 * web app (see stats-backend/README.md). The game POSTs batches of word events;
 * each event becomes one row in the "Events" tab, and after every upload these
 * tabs are rebuilt:
 *   Summary — users, sessions, sessions per user, and the same by country
 *   Words   — per-word skip rates (what a future Hard mode will use)
 *   Players — one row per phone: country, sessions, words, first/last seen
 * A GET returns the per-word summary as JSON for the game to read.
 *
 * A "player" is a phone (a random id the game keeps in local storage), not a
 * person — one phone is passed around a whole group. A "session" is one sitting
 * with the app: it starts when the game is opened, or after 30+ min away.
 */

const EVENTS = 'Events';
const SUMMARY = 'Summary';
const WORDS = 'Words';
const PLAYERS = 'Players';
// New columns go at the end so rows written by older versions stay aligned.
const HEADERS = ['time', 'id', 'lang', 'word', 'mode', 'card', 'seconds', 'end', 'quickSkip', 'device',
                 'session', 'country', 'timezone'];
const C = Object.fromEntries(HEADERS.map((h, i) => [h, i]));
const QUICK_SKIP_SEC = 3;   // a "Change Word" faster than this counts as a quick skip
const MAX_BATCH = 500;
const DAY_MS = 24 * 3600 * 1000;

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (_) { return json_({ ok: false, error: 'bad json' }); }
  const events = Array.isArray(body.events) ? body.events.slice(0, MAX_BATCH) : [];
  const device = clean_(body.device, 40);
  const country = /^[A-Za-z]{2}$/.test(String(body.country || '')) ? String(body.country).toUpperCase() : '';
  const tz = clean_(body.tz, 40);

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
      clean_(ev.s, 60), country, tz,
    ]);
  });

  if (rows.length) {
    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      const sh = events_();
      sh.getRange(sh.getLastRow() + 1, 1, rows.length, HEADERS.length).setValues(rows);
      const all = readEvents_(sh);
      writeTable_(SUMMARY, 0, summaryTable_(all));
      writeTable_(WORDS, 1, wordTable_(all), { 5: '0%' });
      writeTable_(PLAYERS, 2, playersTable_(all), { 5: 'yyyy-mm-dd hh:mm', 6: 'yyyy-mm-dd hh:mm' });
    } finally {
      lock.releaseLock();
    }
    cache.putAll(fresh, 21600);  // 6 hours
  }
  return json_({ ok: true, added: rows.length });
}

function doGet() {
  const words = {};
  summarize_(readEvents_(events_())).forEach(r => {
    words[r.lang + '|' + r.word] = { shown: r.shown, quickSkips: r.quickSkips, avgSec: r.avgSec };
  });
  return json_({ ok: true, words });
}

// ── reading ──────────────────────────────────────────────────────────────────
function events_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(EVENTS);
  if (!sh) {
    sh = ss.insertSheet(EVENTS);
    sh.appendRow(HEADERS);
    sh.setFrozenRows(1);
  }
  // Sheets created by an older version have fewer header columns — extend them.
  const head = sh.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  if (head.join('|') !== HEADERS.join('|')) sh.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  return sh;
}

function readEvents_(sh) {
  const n = sh.getLastRow() - 1;
  return n < 1 ? [] : sh.getRange(2, 1, n, HEADERS.length).getValues();
}

// Rows from before sessions were tracked have no session id: treat each phone's
// activity on one calendar day as one session.
function sessionKey_(r) {
  if (r[C.session]) return r[C.session];
  const t = r[C.time] instanceof Date ? r[C.time] : new Date(r[C.time]);
  return 'old:' + r[C.device] + ':' + t.toISOString().slice(0, 10);
}

function ms_(v) { return v instanceof Date ? v.getTime() : new Date(v).getTime() || 0; }

// ── tabs ─────────────────────────────────────────────────────────────────────
function summarize_(all) {
  const agg = {};
  all.forEach(r => {
    const k = r[C.lang] + '|' + r[C.word];
    const a = agg[k] || (agg[k] = { lang: r[C.lang], word: r[C.word], shown: 0, quickSkips: 0, totalSec: 0 });
    a.shown++;
    a.quickSkips += Number(r[C.quickSkip]) || 0;
    a.totalSec += Number(r[C.seconds]) || 0;
  });
  return Object.values(agg).map(a => ({
    lang: a.lang, word: a.word, shown: a.shown, quickSkips: a.quickSkips,
    skipRate: Math.round(a.quickSkips / a.shown * 100) / 100,
    avgSec: Math.round(a.totalSec / a.shown * 10) / 10,
  })).sort((x, y) => y.skipRate - x.skipRate || y.shown - x.shown);
}

function wordTable_(all) {
  return [['lang', 'word', 'shown', 'quick skips', 'skip rate', 'avg seconds on screen']]
    .concat(summarize_(all).map(r => [r.lang, r.word, r.shown, r.quickSkips, r.skipRate, r.avgSec]));
}

function players_(all) {
  const p = {};
  all.forEach(r => {
    const d = r[C.device] || '(unknown)';
    const t = ms_(r[C.time]);
    const a = p[d] || (p[d] = { device: d, country: '', countryAt: 0, sessions: {}, words: 0, first: t, last: t });
    a.words++;
    a.sessions[sessionKey_(r)] = 1;
    if (t < a.first) a.first = t;
    if (t > a.last) a.last = t;
    if (r[C.country] && t >= a.countryAt) { a.country = r[C.country]; a.countryAt = t; }
  });
  return Object.values(p).map(a => Object.assign(a, { sessions: Object.keys(a.sessions).length }));
}

function playersTable_(all) {
  const rows = players_(all).sort((a, b) => b.last - a.last);
  return [['phone', 'country', 'sessions', 'words shown', 'first seen', 'last seen']]
    .concat(rows.map(a => [a.device, a.country || '?', a.sessions, a.words, new Date(a.first), new Date(a.last)]));
}

// The Summary tab. "Users" are phones (see the note at the top).
function summaryTable_(all) {
  const players = players_(all);
  const now = Date.now();
  const sessions = players.reduce((s, a) => s + a.sessions, 0);
  const perUser = (s, u) => u ? Math.round(s / u * 10) / 10 : 0;
  const active = days => players.filter(a => now - a.last <= days * DAY_MS).length;
  const withSessions = (lo, hi) => players.filter(a => a.sessions >= lo && a.sessions <= hi).length;
  const fmt = t => Utilities.formatDate(new Date(t), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');

  const byCountry = {};
  players.forEach(a => {
    const k = a.country || '? (unknown)';
    const c = byCountry[k] || (byCountry[k] = { users: 0, sessions: 0, words: 0, last: 0 });
    c.users++; c.sessions += a.sessions; c.words += a.words; c.last = Math.max(c.last, a.last);
  });

  const out = [
    ['Guessy-Go-Round — summary', 'updated ' + fmt(now)],
    ['', ''],
    ['Users (phones)', players.length],
    ['Sessions', sessions],
    ['Sessions per user', perUser(sessions, players.length)],
    ['Words shown', all.length],
    ['Users active in last 7 days', active(7)],
    ['Users active in last 30 days', active(30)],
    ['', ''],
    ['How often users come back', 'users'],
    ['1 session', withSessions(1, 1)],
    ['2 sessions', withSessions(2, 2)],
    ['3–5 sessions', withSessions(3, 5)],
    ['6+ sessions', withSessions(6, Infinity)],
    ['', ''],
    ['Country', 'users', 'sessions', 'sessions per user', 'words shown', 'last seen'],
  ];
  const unknownLast = k => k.startsWith('?') ? 1 : 0;
  Object.entries(byCountry)
    .sort((a, b) => unknownLast(a[0]) - unknownLast(b[0]) || b[1].users - a[1].users || b[1].sessions - a[1].sessions)
    .forEach(([k, c]) => out.push([k, c.users, c.sessions, perUser(c.sessions, c.users), c.words, fmt(c.last)]));
  return out;
}

// Replace a tab's contents with `table` (rows may differ in length).
// `formats` maps a 1-based column to a number format for the data rows.
function writeTable_(name, position, table, formats) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(name) || ss.insertSheet(name, position);
  sh.clear();  // contents and formats — a tab may have held a different table before
  const width = Math.max.apply(null, table.map(r => r.length));
  const rect = table.map(r => r.concat(Array(width - r.length).fill('')));
  sh.getRange(1, 1, rect.length, width).setValues(rect);
  sh.setFrozenRows(1);
  Object.entries(formats || {}).forEach(([col, fmt]) => {
    if (rect.length > 1) sh.getRange(2, Number(col), rect.length - 1, 1).setNumberFormat(fmt);
  });
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
