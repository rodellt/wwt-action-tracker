/* Cox HPT Daily Stand-Up Tracker
 * Runs two ways from the same code:
 *  - hosted (GitHub Pages), fetching data/data.enc.json live; or
 *  - as a distributable single file (dist/HPT-Tracker.html) with the encrypted
 *    snapshot embedded — openable from SharePoint/Teams/file:// with no server.
 * Data is AES-256-GCM, key derived from the team passphrase via PBKDF2-SHA256.
 * Saving: with the shared edit key reachable, changes commit to GitHub live;
 * otherwise they apply on-device and queue as "sync ops" that the user emails
 * to the tracker owner (Send sync), where the next morning's automated run
 * applies them for everyone.
 */
(() => {
'use strict';

const APP_VERSION = '2.0.0';

const CONFIG = {
  owner: 'rodellt',
  repo: 'wwt-action-tracker',
  branch: 'main',
  dataPath: 'data/data.enc.json',
  editKeyPath: 'data/edit-key.enc.json',
  syncEmail: 'Tyler.Rodell@wwt.com', // where Send sync mails go (the tracker owner)
};

const LS = {
  pass: 'hpt.pass',
  pat: 'hpt.pat',
  name: 'hpt.name',
  theme: 'hpt.theme',
  localDone: 'hpt.localDone',   // legacy (pre-2.0) — migrated into ops at unlock
  ops: 'hpt.pendingOps',
};

const EMBEDDED = typeof window !== 'undefined' ? (window.__HPT_EMBEDDED ?? null) : null;
// ?snapshot forces distributed-file behavior over http — used for testing.
const IS_FILE = location.protocol === 'file:' || new URLSearchParams(location.search).has('snapshot');

const state = {
  env: null,        // encrypted envelope as fetched
  data: null,       // decrypted tracker object
  passphrase: null,
  teamToken: null,  // shared write token, decrypted from data/edit-key.enc.json
  // Edit-key expiry: ISO string = known date · null = never expires · undefined = unknown
  teamKeyExpires: undefined,
  snapshot: false,  // true when showing the embedded snapshot rather than live data
  busy: false,
};

/* ---------------- crypto (must match scripts/crypto-utils.mjs) ---------------- */
const ITERATIONS = 310000;
const te = new TextEncoder();
const td = new TextDecoder();

function b64ToBytes(b64) {
  const bin = atob(b64.replace(/\s/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64(bytes) {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}
async function deriveKey(pass, salt, iterations) {
  const km = await crypto.subtle.importKey('raw', te.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}
async function decryptEnvelope(env, pass) {
  const key = await deriveKey(pass, b64ToBytes(env.salt), env.iter);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(env.iv) }, key, b64ToBytes(env.ct));
  return JSON.parse(td.decode(pt));
}
async function encryptEnvelope(obj, pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pass, salt, ITERATIONS);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(JSON.stringify(obj))));
  return {
    v: 1, kdf: 'PBKDF2-SHA256', iter: ITERATIONS,
    salt: bytesToB64(salt), iv: bytesToB64(iv), ct: bytesToB64(ct),
    lastUpdated: obj.lastUpdated ?? new Date().toISOString(),
  };
}

/* ---------------- small utils ---------------- */
const $ = (sel) => document.querySelector(sel);
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parseDay(s) { return new Date(`${s}T12:00:00`); }
function fmtDay(s, opts) {
  if (!s) return '';
  return parseDay(s).toLocaleDateString(undefined, opts ?? { weekday: 'short', month: 'short', day: 'numeric' });
}
function fmtStamp(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function ageDays(created) {
  const ms = parseDay(todayStr()) - parseDay(created);
  return Math.max(0, Math.round(ms / 86400000));
}
function initials(name) {
  return name.split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}
function hueFor(id) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}
function getLS(k, fallback = null) { try { return localStorage.getItem(k) ?? fallback; } catch { return fallback; } }
function setLS(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} }
function pendingOps() { try { return JSON.parse(getLS(LS.ops, '[]')); } catch { return []; } }
function setPendingOps(list) { setLS(LS.ops, JSON.stringify(list)); renderSyncButton(); }
function newUuid() {
  try { return crypto.randomUUID(); }
  catch { return `op-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`; }
}

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $('#toast-root').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; }, 4200);
  setTimeout(() => el.remove(), 4600);
}

/* ---------------- data fetching ---------------- */
function step(s) { if (window.__HPT) window.__HPT.step = s; const el = $('#loading-step'); if (el) el.textContent = s + '…'; }

async function fetchWithTimeout(url, opts = {}, ms = 12000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctl.signal });
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? `timed out after ${ms / 1000}s` : (e.message || 'network error'));
  } finally {
    clearTimeout(t);
  }
}

function ghHeaders(token) {
  const h = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}
const contentsUrl = (path = CONFIG.dataPath) =>
  `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${path}`;

async function fetchViaApi(token, path = CONFIG.dataPath) {
  const res = await fetchWithTimeout(`${contentsUrl(path)}?ref=${CONFIG.branch}&_=${Date.now()}`, { headers: ghHeaders(token) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const info = await res.json();
  const env = JSON.parse(td.decode(b64ToBytes(info.content)));
  env._sha = info.sha;
  return env;
}
async function fetchViaSite(path = CONFIG.dataPath) {
  const res = await fetchWithTimeout(`./${path}?_=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}
async function fetchViaRaw(path = CONFIG.dataPath) {
  const res = await fetchWithTimeout(
    `https://raw.githubusercontent.com/${CONFIG.owner}/${CONFIG.repo}/${CONFIG.branch}/${path}?_=${Date.now()}`,
    { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/* ---------------- shared team edit key ----------------
 * data/edit-key.enc.json is a committed envelope holding a fine-grained GitHub
 * token, encrypted with the same team passphrase as the tracker data. Anyone
 * who can unlock the page transparently gets edit access — no per-user token.
 * A personal token in Settings still takes precedence when present. */
function effectiveToken() {
  // Shared team key first — a stale personal token left over from the old
  // per-user setup must never shadow a healthy published key.
  return state.teamToken || getLS(LS.pat);
}
async function loadTeamKey() {
  // ?nokey simulates a network where GitHub is unreachable — testing/demo hook.
  if (new URLSearchParams(location.search).has('nokey')) { state.teamToken = null; return false; }
  const sources = [
    () => fetchViaSite(CONFIG.editKeyPath),
    () => fetchViaRaw(CONFIG.editKeyPath),
    () => fetchViaApi(getLS(LS.pat), CONFIG.editKeyPath),
  ];
  for (const fn of sources) {
    try {
      const env = await fn();
      const obj = await decryptEnvelope(env, state.passphrase);
      if (obj?.token) {
        state.teamToken = obj.token;
        if (obj.expires !== undefined) {
          state.teamKeyExpires = obj.expires; // recorded at publish time (null = never)
          renderKeyCountdown();
        } else {
          probeKeyExpiry(obj.token); // older envelope — ask GitHub directly
        }
        return true;
      }
    } catch { /* try the next source; a 404 just means no key is published */ }
  }
  state.teamToken = null;
  return false;
}
// GitHub reports a token's expiry in the github-authentication-token-expiration
// response header (format like "2027-07-14 17:03:09 UTC"). Absent in the browser
// can mean either "no expiry" or "header not exposed" — so treat it as unknown.
async function probeKeyExpiry(token) {
  try {
    const res = await fetchWithTimeout(`https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}`, { headers: ghHeaders(token) });
    const h = res.headers.get('github-authentication-token-expiration');
    if (h) {
      const iso = new Date(h.replace(' UTC', 'Z').replace(' ', 'T'));
      state.teamKeyExpires = Number.isNaN(iso.getTime()) ? new Date(h).toISOString() : iso.toISOString();
    }
  } catch { /* stays unknown */ }
  renderKeyCountdown();
}
function keyDaysLeft() {
  if (!state.teamKeyExpires) return null;
  return Math.ceil((new Date(state.teamKeyExpires).getTime() - Date.now()) / 86400000);
}
function renderKeyCountdown() {
  const el = $('#footer-key');
  if (!el) return;
  const days = keyDaysLeft();
  if (days === null) { el.innerHTML = ''; return; }
  const renewHint = 'Renew: new fine-grained GitHub token, then run node scripts/publish-edit-key.mjs (~2 minutes)';
  if (days < 0) {
    el.innerHTML = ` · <span class="key-red" title="${esc(renewHint)}">⚠ edit key expired</span>`;
  } else {
    const cls = days <= 7 ? 'key-red' : days <= 30 ? 'key-amber' : '';
    el.innerHTML = ` · <span class="${cls}" title="${esc(renewHint)}">edit key renews in ${days}d</span>`;
  }
}
// Publishing / removing the key is done from a terminal:
//   node scripts/publish-edit-key.mjs [--remove]
async function fetchEnvelopeLive() {
  const pat = getLS(LS.pat);
  const failures = [];
  const sources = [
    ...(pat ? [['GitHub API (token)', () => fetchViaApi(pat)]] : []),
    ...(IS_FILE ? [] : [['site data file', fetchViaSite]]),
    ['GitHub API', () => fetchViaApi(null)],
    ['raw.githubusercontent', fetchViaRaw],
  ];
  for (const [name, fn] of sources) {
    try { return await fn(); }
    catch (e) { failures.push(`${name}: ${e.message}`); }
  }
  throw new Error(failures.join(' · '));
}
async function fetchEnvelope() {
  // Distributed single file: paint instantly from the embedded snapshot; a
  // background freshness check runs after unlock (see showApp).
  if (IS_FILE && EMBEDDED) {
    state.snapshot = true;
    return EMBEDDED;
  }
  try {
    const env = await fetchEnvelopeLive();
    state.snapshot = false;
    return env;
  } catch (e) {
    if (EMBEDDED) { state.snapshot = true; return EMBEDDED; }
    throw e;
  }
}
// From a snapshot, quietly look for fresher live data and hot-swap it in.
async function refreshFromLive(announce = false) {
  try {
    const env = await fetchEnvelopeLive();
    if ((env.lastUpdated ?? '') > (state.env?.lastUpdated ?? '')) {
      state.env = env;
      await tryUnlock(state.passphrase);
      state.snapshot = false;
      render();
      toast('Live data loaded — newer than this file’s snapshot.', 'ok');
    } else if (announce) {
      state.snapshot = false;
      renderTopbar();
      toast('This file’s snapshot is already the latest data.', 'ok');
    }
  } catch (e) {
    if (announce) toast(`No live connection — showing the snapshot from ${fmtStamp(state.data.lastUpdated)}.`, 'warn');
  }
}

/* ---------------- remote mutation (complete / reopen) ---------------- */
async function remoteMutate(mutator, message) {
  let pat = effectiveToken();
  if (!pat) {
    // The shared key loads asynchronously after unlock — if a save races it, try once more.
    await loadTeamKey();
    pat = effectiveToken();
  }
  if (!pat) throw new Error('no-token');
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetchWithTimeout(`${contentsUrl()}?ref=${CONFIG.branch}&_=${Date.now()}`, { headers: ghHeaders(pat) }, 20000);
    if (res.status === 401 || res.status === 403) throw new Error('The tracker’s edit key was rejected — it may have expired. Tell Tyler.');
    if (!res.ok) throw new Error(`GitHub read failed (${res.status})`);
    const info = await res.json();
    const env = JSON.parse(td.decode(b64ToBytes(info.content)));
    const data = await decryptEnvelope(env, state.passphrase);
    mutator(data);
    data.lastUpdated = new Date().toISOString();
    const newEnv = await encryptEnvelope(data, state.passphrase);
    const put = await fetchWithTimeout(contentsUrl(), {
      method: 'PUT',
      headers: ghHeaders(pat),
      body: JSON.stringify({
        message,
        content: bytesToB64(te.encode(JSON.stringify(newEnv, null, 2) + '\n')),
        sha: info.sha,
        branch: CONFIG.branch,
      }),
    }, 20000);
    if (put.ok) { state.data = data; return; }
    if (put.status !== 409 && put.status !== 422) throw new Error(`GitHub write failed (${put.status})`);
    // sha conflict — someone else wrote in between; retry with fresh copy
  }
  throw new Error('Could not save after several tries — someone else may be editing. Refresh and try again.');
}

/* ---------------- offline sync ops (Send sync) ----------------
 * With no reachable edit key (e.g. the distributed file on a network that
 * blocks GitHub), changes apply on-device and queue as ops. "Send sync" opens
 * a pre-filled Outlook draft to CONFIG.syncEmail; the next automated run
 * applies the ops for everyone and records their ids in data.appliedOps,
 * which is how devices know to drop them from the queue. */
function baseOp(kind, extra) {
  return { id: newUuid(), ts: new Date().toISOString(), by: editorName(), kind, ...extra };
}
function enqueueOp(op) {
  applyOpLocal(state.data, op);
  setPendingOps([...pendingOps(), op]);
}
function pendingCompleteOp(itemId) {
  return pendingOps().find(o => o.kind === 'complete' && o.itemId === itemId);
}
function applyOpLocal(d, op) {
  const item = (id) => d.actionItems.find(i => i.id === id);
  switch (op.kind) {
    case 'complete': {
      const it = item(op.itemId); if (!it) return;
      it.status = 'completed';
      it.completed = { date: op.ts.slice(0, 10), method: 'manual', by: op.by, ...(op.note ? { note: op.note } : {}) };
      it._pending = true;
      break;
    }
    case 'reopen': {
      const it = item(op.itemId); if (!it) return;
      it.status = 'open'; it.completed = null; it._pending = true;
      break;
    }
    case 'item-edit': {
      const it = item(op.itemId); if (!it) return;
      it.text = op.text;
      if (op.detail) it.detail = op.detail; else delete it.detail;
      it.owner = op.owner; it._pending = true;
      break;
    }
    case 'item-add': {
      if (d.actionItems.some(i => i._op === op.id)) return;
      d.actionItems.unshift({
        id: nextWebAiId(d), _op: op.id, owner: op.owner, text: op.text,
        ...(op.detail ? { detail: op.detail } : {}),
        created: op.ts.slice(0, 10), source: `web — ${op.by}`, status: 'open', completed: null, _pending: true,
      });
      break;
    }
    case 'item-delete': {
      const idx = d.actionItems.findIndex(i => i.id === op.itemId);
      if (idx >= 0) d.actionItems.splice(idx, 1);
      break;
    }
    case 'risk-edit': {
      const r = d.risks.find(x => x.id === op.riskId); if (!r) return;
      r.title = op.title;
      if (op.detail) r.detail = op.detail; else delete r.detail;
      if (op.note) r.lastUpdateNote = op.note; else delete r.lastUpdateNote;
      r.lastUpdate = op.ts.slice(0, 10); r._pending = true;
      break;
    }
    case 'risk-add': {
      if (d.risks.some(x => x._op === op.id)) return;
      d.risks.push({
        id: newRiskId(d, op.title), _op: op.id, title: op.title,
        ...(op.detail ? { detail: op.detail } : {}),
        lastUpdate: op.ts.slice(0, 10),
        ...(op.note ? { lastUpdateNote: op.note } : {}),
        _pending: true,
      });
      break;
    }
    case 'risk-delete': {
      const idx = d.risks.findIndex(x => x.id === op.riskId);
      if (idx >= 0) d.risks.splice(idx, 1);
      break;
    }
    case 'aps-edit': {
      const taken = op.stages.map(s => s.id).filter(Boolean);
      d.advancedPurchase.stages = op.stages.map(s => {
        const id = s.id ?? nextStageId(d, taken);
        if (!s.id) taken.push(id);
        return { id, label: s.label, ...(s.note ? { note: s.note } : {}) };
      });
      d.advancedPurchase.lastVerified = op.ts.slice(0, 10);
      if (op.footnote) d.advancedPurchase.lastVerifiedNote = op.footnote;
      else delete d.advancedPurchase.lastVerifiedNote;
      d.advancedPurchase._pending = true;
      break;
    }
  }
}
function replayPendingOps() {
  // one-time migration of pre-2.0 device-local completions into ops
  try {
    const legacy = JSON.parse(getLS(LS.localDone, 'null'));
    if (legacy && typeof legacy === 'object') {
      const migrated = Object.entries(legacy).map(([itemId, c]) => ({
        id: newUuid(), ts: `${c.date ?? todayStr()}T12:00:00.000Z`, by: c.by ?? 'web',
        kind: 'complete', itemId, ...(c.note ? { note: c.note } : {}),
      }));
      if (migrated.length) setPendingOps([...pendingOps(), ...migrated]);
      setLS(LS.localDone, null);
    }
  } catch { /* ignore corrupt legacy state */ }
  const applied = new Set(state.data.appliedOps ?? []);
  const cutoff = Date.now() - 14 * 86400000;
  const keep = pendingOps().filter(op => {
    if (applied.has(op.id)) return false;              // landed in shared data
    if (new Date(op.ts).getTime() < cutoff) return false; // stale — let it go
    if (op.kind === 'complete') {
      const it = state.data.actionItems.find(i => i.id === op.itemId);
      if (!it || it.status === 'completed') return false; // already done upstream
    }
    return true;
  });
  for (const op of keep) applyOpLocal(state.data, op);
  setPendingOps(keep);
}
function sendSync() {
  const unsent = pendingOps().filter(o => !o.sentAt);
  if (!unsent.length) return;
  // mailto bodies have tight length limits — send in chunks if needed
  const batch = [];
  let payload = '';
  for (const op of unsent) {
    const trial = bytesToB64(te.encode(JSON.stringify([...batch, op])));
    if (batch.length && trial.length > 1400) break;
    batch.push(op);
    payload = trial;
  }
  const body =
    'Tracker edit sync — just hit Send; these changes are applied for everyone at the next tracker update.\n\n' +
    `HPT-OPS:${payload}:END`;
  const url = `mailto:${CONFIG.syncEmail}?subject=${encodeURIComponent(`HPT-SYNC ${todayStr()}`)}&body=${encodeURIComponent(body)}`;
  const ids = new Set(batch.map(o => o.id));
  setPendingOps(pendingOps().map(o => (ids.has(o.id) ? { ...o, sentAt: new Date().toISOString() } : o)));
  window.location.href = url;
  const rest = unsent.length - batch.length;
  toast(rest > 0
    ? `Outlook draft opened — hit Send there, then tap Send sync again for the remaining ${rest}.`
    : 'Outlook draft opened — hit Send there and you’re done.', 'ok');
}
function renderSyncButton() {
  const btn = $('#btn-sendsync');
  if (!btn) return;
  const unsent = pendingOps().filter(o => !o.sentAt).length;
  btn.hidden = unsent === 0;
  btn.textContent = `📤 Send sync (${unsent})`;
}

/* ---------------- domain helpers ---------------- */
const memberById = (id) => state.data.members.find(m => m.id === id);
const latestMeeting = () => state.data.meetings[0];

function sortMeetings() {
  state.data.meetings.sort((a, b) => b.date.localeCompare(a.date));
}
function notesFor(memberId) {
  for (const mtg of state.data.meetings) {
    const notes = mtg.notes?.[memberId];
    if (notes && notes.length) return { date: mtg.date, notes, isLatest: mtg === latestMeeting() };
  }
  return null;
}
function activePto(memberId) {
  const t = todayStr();
  return (state.data.pto ?? []).find(p => p.member === memberId && p.start <= t && t <= p.end);
}
function upcomingPto(memberId) {
  const t = todayStr();
  const horizon = new Date(parseDay(t).getTime() + 14 * 86400000).toISOString().slice(0, 10);
  return (state.data.pto ?? []).find(p => p.member === memberId && p.start > t && p.start <= horizon);
}
function openItems(memberId) {
  return state.data.actionItems.filter(i => i.owner === memberId && i.status === 'open');
}
function doneItems(memberId) {
  return state.data.actionItems
    .filter(i => i.owner === memberId && i.status === 'completed')
    .sort((a, b) => (b.completed?.date ?? '').localeCompare(a.completed?.date ?? ''));
}
// Completions on/after the latest processed meeting stay visible inline until the
// next day's call is processed; everything older lives in the collapsed fold.
function splitDone(memberId) {
  const cut = latestMeeting()?.date ?? '';
  const all = doneItems(memberId);
  return {
    fresh: all.filter(i => (i.completed?.date ?? '') >= cut),
    folded: all.filter(i => (i.completed?.date ?? '') < cut),
  };
}

/* ---------------- editing helpers ---------------- */
function requireWrite() {
  // Editing always works in 2.0: live via the edit key when reachable,
  // otherwise on-device with a queued sync op. Kept for call-site symmetry.
  return true;
}
function editorName() { return getLS(LS.name) || 'web'; }

// Id generators run INSIDE mutators so sha-conflict retries recompute on fresh data.
function nextWebAiId(d) {
  const ymd = todayStr().replace(/-/g, '');
  const re = new RegExp(`^ai-${ymd}-w(\\d+)$`);
  let max = 0;
  for (const i of d.actionItems) {
    const m = re.exec(i.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `ai-${ymd}-w${String(max + 1).padStart(2, '0')}`;
}
function newRiskId(d, title) {
  const base = 'risk-' + (title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'new');
  let id = base;
  for (let n = 2; d.risks.some(r => r.id === id); n++) id = `${base}-${n}`;
  return id;
}
function nextStageId(d, takenIds) {
  let max = 0;
  for (const id of [...d.advancedPurchase.stages.map(s => s.id), ...takenIds]) {
    const m = /^aps-(\d+)$/.exec(id ?? '');
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `aps-${max + 1}`;
}

const isNetErr = (m) => /no-token|timed out|network|read failed|Failed to fetch/i.test(String(m));

// Dual-path save: live GitHub commit when the edit key is reachable, otherwise
// apply on-device and queue the op for the morning sync run ("Send sync").
async function saveViaMutate(btn, mutator, op, message, okMsg) {
  btn.disabled = true;
  let tok = effectiveToken();
  if (!tok && !state.snapshot) { await loadTeamKey(); tok = effectiveToken(); }
  if (!tok) { queueAndClose(op); return; }
  try {
    await remoteMutate(mutator, message);
    closeModal();
    render();
    toast(okMsg, 'ok');
  } catch (err) {
    if (isNetErr(err.message)) { queueAndClose(op); return; }
    btn.disabled = false;
    toast(err.message, 'warn');
  }
}
function queueAndClose(op) {
  enqueueOp(op);
  closeModal();
  render();
  toast('Saved on this device — tap “📤 Send sync” up top to share it with the team.', 'ok');
}

// Two-step in-place delete: first click arms, second click (within 4s) confirms.
function armDelete(btn, onConfirm) {
  let armed = false;
  let timer = null;
  btn.addEventListener('click', () => {
    if (!armed) {
      armed = true;
      btn.textContent = 'Really delete?';
      btn.classList.add('armed');
      timer = setTimeout(() => {
        armed = false;
        btn.textContent = 'Delete';
        btn.classList.remove('armed');
      }, 4000);
      return;
    }
    clearTimeout(timer);
    onConfirm(btn);
  });
}

function memberOptionsHtml(selectedId) {
  return state.data.groups.map(g => {
    const opts = state.data.members
      .filter(m => m.group === g.id)
      .map(m => `<option value="${esc(m.id)}" ${m.id === selectedId ? 'selected' : ''}>${esc(m.name)}</option>`)
      .join('');
    return opts ? `<optgroup label="${esc(g.name)}">${opts}</optgroup>` : '';
  }).join('');
}

function syncStickyHeight() {
  const h = $('#topbar')?.offsetHeight || 120;
  document.documentElement.style.setProperty('--sticky-h', `${h}px`);
}

/* ---------------- rendering ---------------- */
// Cards render compact: item details and long notes are collapsed until
// clicked. These sets keep what the user expanded open across re-renders.
const expandedItems = new Set();
const expandedNotes = new Set();

function render() {
  sortMeetings();
  renderTopbar();
  renderGroupNav();
  renderAvailability();
  renderAps();
  renderRisks();
  renderOpenSummary();
  renderTeam();
  renderFooter();
  if (present.active) {
    // Keep the current slide in sync after completions/edits made mid-call.
    buildSlides();
    present.idx = Math.min(present.idx, present.slides.length - 1);
    renderPresent();
  }
}

function renderGroupNav() {
  $('#groupnav').innerHTML = state.data.groups.map(g => {
    const members = state.data.members.filter(m => m.group === g.id);
    if (!members.length) return '';
    const n = members.reduce((sum, m) => sum + openItems(m.id).length, 0);
    return `<button class="gnav-chip" data-target="group-${esc(g.id)}">${esc(g.name)}${n ? `<span class="gnav-count">${n}</span>` : ''}</button>`;
  }).join('');
  syncStickyHeight();
}

function renderTopbar() {
  const el = $('#asof');
  if (state.snapshot) {
    el.textContent = `Snapshot · data as of ${fmtStamp(state.data.lastUpdated)}`;
    el.classList.add('snapshot');
  } else {
    el.textContent = `Updated ${fmtStamp(state.data.lastUpdated)}`;
    el.classList.remove('snapshot');
  }
  renderSyncButton();
}

function renderAvailability() {
  const root = $('#availability');
  const out = [];
  const upcoming = [];
  for (const m of state.data.members) {
    const now = activePto(m.id);
    if (now) { out.push({ m, p: now }); continue; }
    const soon = upcomingPto(m.id);
    if (soon) upcoming.push({ m, p: soon });
  }
  let html = '';
  if (out.length) {
    html += `<span class="avail-label">Out today</span>` + out.map(({ m, p }) =>
      `<span class="avail-chip"><b>${esc(m.name)}</b> ${esc(p.type)} · back ${fmtDay(p.returns, { month: 'short', day: 'numeric' })}</span>`
    ).join('');
  }
  if (upcoming.length) {
    html += `<span class="avail-label">Upcoming</span>` + upcoming.map(({ m, p }) =>
      `<span class="avail-chip future"><b>${esc(m.name)}</b> ${esc(p.type)} ${fmtDay(p.start, { month: 'short', day: 'numeric' })}–${fmtDay(p.end, { month: 'short', day: 'numeric' })}</span>`
    ).join('');
  }
  root.innerHTML = html;
}

function renderAps() {
  const aps = state.data.advancedPurchase;
  $('#aps-verified').textContent = `verified ${fmtDay(aps.lastVerified)}`;
  $('#aps-body').innerHTML =
    aps.stages.map(s => `
      <div class="aps-stage">
        <span class="aps-dot"></span>
        <div>
          <div class="aps-label">${esc(s.label)}</div>
          ${s.note ? `<div class="aps-note">${esc(s.note)}</div>` : ''}
        </div>
      </div>`).join('') +
    (aps.lastVerifiedNote ? `<div class="aps-footnote">${esc(aps.lastVerifiedNote)}</div>` : '');
}

function renderRisks() {
  const risks = state.data.risks;
  $('#risks-count').textContent = `${risks.length} active`;
  $('#risks-body').innerHTML = risks.map(r => `
    <li>
      <div class="risk-row">
        <div class="risk-title">${esc(r.title)}</div>
        <button class="risk-edit" data-id="${esc(r.id)}" title="Edit this risk">✎</button>
      </div>
      ${r.detail ? `<div class="risk-detail">${esc(r.detail)}</div>` : ''}
      ${r.lastUpdateNote ? `<div class="risk-note">${fmtDay(r.lastUpdate, { month: 'short', day: 'numeric' })} — ${esc(r.lastUpdateNote)}</div>` : ''}
    </li>`).join('');
}

function renderOpenSummary() {
  const open = state.data.actionItems.filter(i => i.status === 'open');
  const mtg = latestMeeting();
  $('#open-summary').innerHTML =
    `<b>${open.length}</b> open action item${open.length === 1 ? '' : 's'} across the team · latest stand-up: <b>${esc(fmtDay(mtg.date, { weekday: 'long', month: 'long', day: 'numeric' }))}</b>${mtg.durationMin ? ` (${mtg.durationMin} min)` : ''}`;
}

function aiItemHtml(item, done) {
  const c = item.completed;
  const age = ageDays(item.created);
  // Compact row: just the title plus a tiny age/status tag. The full meta line
  // and any detail/completion note live behind the chevron.
  const pendingFlag = item._pending ? ' <span class="local-flag" title="Saved on this device — use Send sync to share it">⏳</span>' : '';
  const tag = done
    ? `${c?.method === 'verbal' ? '🗣' : '✓'} ${fmtDay(c?.date, { month: 'short', day: 'numeric' })}${pendingFlag}`
    : `<span class="${age >= 3 ? 'age-hot' : ''}">${age}d</span>${pendingFlag}`;
  const meta = done
    ? `Completed ${fmtDay(c?.date, { month: 'short', day: 'numeric' })}${c?.method ? ` · ${c.method === 'verbal' ? '🗣 verbal (from transcript)' : '✓ manual'}` : ''}${item._pending ? ' · <span class="local-flag">awaiting sync</span>' : ''}`
    : `Raised ${fmtDay(item.created, { month: 'short', day: 'numeric' })}${item.source ? ` · ${esc(item.source)}` : ''}${item._pending ? ' · <span class="local-flag">awaiting sync</span>' : ''}`;
  const extra = (done ? [c?.note, item.detail] : [item.detail]).filter(Boolean);
  return `
    <li class="ai-item ${done ? 'done' : ''} ${expandedItems.has(item.id) ? 'expanded' : ''}" data-id="${esc(item.id)}">
      <button class="ai-check" data-action="${done ? 'reopen' : 'complete'}" data-id="${esc(item.id)}" title="${done ? 'Reopen this item' : 'Mark complete'}">✓</button>
      <div class="ai-text has-detail" title="Click for details">
        <div class="ai-title">
          <span class="ai-chev">▸</span>
          <span class="ai-title-text">${esc(item.text)}</span>
          <span class="ai-tag">${tag}</span>
        </div>
        <div class="ai-detail">
          <div class="ai-meta">${meta}</div>
          ${extra.map(p => `<div>${esc(p)}</div>`).join('')}
        </div>
      </div>
      ${done ? '' : `<button class="ai-edit" data-id="${esc(item.id)}" title="Edit this item">✎</button>`}
    </li>`;
}

function renderTeam() {
  const mtg = latestMeeting();
  const groups = state.data.groups.map(g => {
    const members = state.data.members.filter(m => m.group === g.id);
    if (!members.length) return '';
    const cards = members.map(m => {
      const pto = activePto(m.id);
      const absent = mtg.absent?.[m.id];
      const notes = notesFor(m.id);
      const open = openItems(m.id);
      const { fresh, folded } = splitDone(m.id);
      const foldedShow = folded.slice(0, 6);
      let badge = '';
      if (pto) badge = `<span class="badge badge-ooo">${esc(pto.type)} · back ${fmtDay(pto.returns, { month: 'short', day: 'numeric' })}</span>`;
      else if (absent) badge = `<span class="badge badge-absent" title="${esc(absent)}">absent ${fmtDay(mtg.date, { month: 'short', day: 'numeric' })}</span>`;
      return `
      <div class="card member-card" id="member-${esc(m.id)}">
        <div class="member-head">
          <span class="avatar" style="background:hsl(${hueFor(m.id)} 45% 46%)">${esc(initials(m.name))}</span>
          <div>
            <div class="member-name">${esc(m.name)}</div>
            <div class="member-meta">${esc(g.name)}${pto?.note ? ` — ${esc(pto.note)}` : ''}</div>
          </div>
          ${badge}
          <button class="card-add" data-member="${esc(m.id)}" title="Add an action item for ${esc(m.name)}">＋</button>
        </div>
        ${(open.length || fresh.length) ? `
        <div>
          <div class="section-label"><span>Action items (${open.length})</span></div>
          <ul class="ai-list">${open.map(i => aiItemHtml(i, false)).join('')}${fresh.map(i => aiItemHtml(i, true)).join('')}</ul>
        </div>` : ''}
        <div>
          <div class="section-label">
            <span>Notes</span>
            ${notes ? `<span class="when">${notes.isLatest ? '' : 'last update — '}${fmtDay(notes.date)}</span>` : ''}
          </div>
          ${notes
            ? `<ul class="notes-list">${notes.notes.map((n, idx) => {
                const key = `${m.id}:${notes.date}:${idx}`;
                const clampable = n.length > 140;
                return `<li class="${clampable ? 'clampable' : ''} ${expandedNotes.has(key) ? 'expanded' : ''}" data-nkey="${esc(key)}"${clampable ? ' title="Click to expand"' : ''}>${esc(n)}</li>`;
              }).join('')}</ul>`
            : `<div class="notes-empty">No notes yet.</div>`}
          ${absent && notes && !notes.isLatest ? `<div class="notes-empty" style="margin-top:4px">${fmtDay(mtg.date, { month: 'short', day: 'numeric' })}: ${esc(absent)}</div>` : ''}
        </div>
        ${foldedShow.length ? `
        <details class="completed-fold">
          <summary>Recently completed (${foldedShow.length})</summary>
          <ul class="ai-list">${foldedShow.map(i => aiItemHtml(i, true)).join('')}</ul>
        </details>` : ''}
      </div>`;
    }).join('');
    return `<div class="group-block" id="group-${esc(g.id)}"><h3 class="group-title">${esc(g.name)}</h3><div class="member-grid">${cards}</div></div>`;
  }).join('');
  $('#team').innerHTML = groups;
}

function renderFooter() {
  $('#footer-updated').textContent = `Data updated ${fmtStamp(state.data.lastUpdated)} · v${APP_VERSION}`;
  renderKeyCountdown();
  const repo = $('#footer-repo');
  repo.href = `https://github.com/${CONFIG.owner}/${CONFIG.repo}`;
}

/* ---------------- modals ---------------- */
// Make every textarea in `scope` grow with its content. Fields marked
// data-single keep single-line semantics (Enter is ignored; normalized on save).
function enableAutoGrow(scope) {
  const MAX = 380; // beyond this, scroll inside instead of growing the modal off-screen
  scope.querySelectorAll('textarea:not([data-grow])').forEach(t => {
    t.dataset.grow = '1';
    const grow = () => {
      t.style.height = 'auto';
      const want = t.scrollHeight + 2;
      t.style.height = `${Math.min(want, MAX)}px`;
      t.style.overflowY = want > MAX ? 'auto' : 'hidden';
    };
    t.addEventListener('input', grow);
    if (t.dataset.single !== undefined) {
      t.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
    }
    grow();                      // size to content immediately
    requestAnimationFrame(grow); // and again after first paint (fonts/layout settle)
  });
}
const oneLine = (s) => s.replace(/\s+/g, ' ').trim();

function openModal(html, narrow = false) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-backdrop"><div class="modal ${narrow ? 'narrow' : ''}">${html}</div></div>`;
  root.querySelector('.modal-backdrop').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
  });
  root.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', closeModal));
  enableAutoGrow(root);
  return root;
}
function closeModal() { $('#modal-root').innerHTML = ''; }

function confirmCompleteModal(item) {
  const canWrite = !!effectiveToken();
  const root = openModal(`
    <div class="modal-head"><h2>Mark complete</h2><button class="modal-close" data-close>×</button></div>
    <p style="margin:0 0 4px"><b>${esc(item.text)}</b></p>
    <p class="muted" style="margin:0;font-size:13px">${esc(memberById(item.owner)?.name ?? item.owner)} · raised ${fmtDay(item.created)}</p>
    <label for="complete-note">Note (optional)</label>
    <textarea id="complete-note" rows="1" data-single placeholder="e.g. shipped this morning"></textarea>
    <p class="hint">${canWrite
      ? 'Saves for the whole team — this commits the update to GitHub.'
      : 'Checks off on this device right away — tap “📤 Send sync” afterwards and it lands for the whole team at the next update.'}</p>
    <div class="modal-actions">
      <button class="btn" data-close>Cancel</button>
      <button class="btn btn-primary" id="complete-go">Mark complete</button>
    </div>`, true);
  root.querySelector('#complete-go').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    const note = oneLine(root.querySelector('#complete-note').value);
    const by = editorName();
    const op = baseOp('complete', { itemId: item.id, ...(note ? { note } : {}) });
    let tok = effectiveToken();
    if (!tok && !state.snapshot) { await loadTeamKey(); tok = effectiveToken(); }
    if (!tok) { queueAndClose(op); return; }
    try {
      await remoteMutate((d) => {
        const it = d.actionItems.find(i => i.id === item.id);
        if (!it) throw new Error('Item no longer exists — refresh.');
        it.status = 'completed';
        it.completed = { date: todayStr(), method: 'manual', by, ...(note ? { note } : {}) };
      }, `Complete: ${item.text.slice(0, 60)} (${by})`);
      closeModal(); render();
      toast('Completed — saved for the whole team.', 'ok');
    } catch (err) {
      if (isNetErr(err.message)) { queueAndClose(op); return; }
      btn.disabled = false;
      toast(err.message, 'warn');
    }
  });
}

function confirmReopenModal(item) {
  const pend = pendingCompleteOp(item.id);
  const root = openModal(`
    <div class="modal-head"><h2>Reopen item</h2><button class="modal-close" data-close>×</button></div>
    <p style="margin:0 0 4px"><b>${esc(item.text)}</b></p>
    <p class="hint">${pend
      ? 'This undoes the check-off queued on this device.'
      : 'Puts the item back in the open list for everyone.'}</p>
    <div class="modal-actions">
      <button class="btn" data-close>Cancel</button>
      <button class="btn btn-primary" id="reopen-go">Reopen</button>
    </div>`, true);
  root.querySelector('#reopen-go').addEventListener('click', async (e) => {
    // Capture the button now — e.currentTarget is null after the first await.
    const btn = e.currentTarget;
    btn.disabled = true;
    if (pend) {
      // Cancel the queued completion instead of layering a reopen on top.
      setPendingOps(pendingOps().filter(o => o.id !== pend.id));
      const it = state.data.actionItems.find(i => i.id === item.id);
      if (it) { it.status = 'open'; it.completed = null; delete it._pending; }
      closeModal(); render();
      toast('Reopened.', 'ok');
      return;
    }
    const op = baseOp('reopen', { itemId: item.id });
    let tok = effectiveToken();
    if (!tok && !state.snapshot) { await loadTeamKey(); tok = effectiveToken(); }
    if (!tok) { queueAndClose(op); return; }
    try {
      await remoteMutate((d) => {
        const it = d.actionItems.find(i => i.id === item.id);
        if (!it) throw new Error('Item no longer exists — refresh.');
        it.status = 'open';
        it.completed = null;
      }, `Reopen: ${item.text.slice(0, 60)}`);
      closeModal(); render();
      toast('Reopened for the whole team.', 'ok');
    } catch (err) {
      if (isNetErr(err.message)) { queueAndClose(op); return; }
      btn.disabled = false;
      toast(err.message, 'warn');
    }
  });
}

function editActionItemModal(item) {
  const root = openModal(`
    <div class="modal-head"><h2>Edit action item</h2><button class="modal-close" data-close>×</button></div>
    <p class="muted" style="margin:0;font-size:12.5px">${esc(item.id)} · raised ${fmtDay(item.created)}${item.source ? ` · ${esc(item.source)}` : ''}</p>
    <label for="ai-text">Item</label>
    <textarea id="ai-text" rows="1" data-single>${esc(item.text)}</textarea>
    <label for="ai-detail">Detail (optional)</label>
    <textarea id="ai-detail" rows="3">${esc(item.detail ?? '')}</textarea>
    <label for="ai-owner">Owner</label>
    <select id="ai-owner">${memberOptionsHtml(item.owner)}</select>
    <p class="error" id="ai-err" hidden>The item text can’t be empty.</p>
    <div class="modal-actions" style="justify-content:space-between">
      <button class="btn btn-danger" id="ai-delete">Delete</button>
      <span style="display:flex;gap:9px">
        <button class="btn" data-close>Cancel</button>
        <button class="btn btn-primary" id="ai-save">Save</button>
      </span>
    </div>`, true);
  root.querySelector('#ai-save').addEventListener('click', (e) => {
    const text = oneLine(root.querySelector('#ai-text').value);
    const detail = root.querySelector('#ai-detail').value.trim();
    const owner = root.querySelector('#ai-owner').value;
    if (!text) { root.querySelector('#ai-err').hidden = false; return; }
    saveViaMutate(e.currentTarget, (d) => {
      const it = d.actionItems.find(i => i.id === item.id);
      if (!it) throw new Error('That item no longer exists — someone may have deleted it. Refresh and retry.');
      it.text = text;
      if (detail) it.detail = detail; else delete it.detail;
      it.owner = owner;
    }, baseOp('item-edit', { itemId: item.id, text, detail, owner }),
    `Edit item: ${text.slice(0, 60)} (${editorName()})`, 'Item updated for the whole team.');
  });
  armDelete(root.querySelector('#ai-delete'), (btn) => {
    saveViaMutate(btn, (d) => {
      const idx = d.actionItems.findIndex(i => i.id === item.id);
      if (idx < 0) throw new Error('That item no longer exists — refresh.');
      d.actionItems.splice(idx, 1);
    }, baseOp('item-delete', { itemId: item.id }),
    `Delete item: ${item.text.slice(0, 60)} (${editorName()})`, 'Item deleted.');
  });
}

function addActionItemModal(ownerId) {
  const root = openModal(`
    <div class="modal-head"><h2>Add action item</h2><button class="modal-close" data-close>×</button></div>
    <label for="ai-owner">Owner</label>
    <select id="ai-owner">${memberOptionsHtml(ownerId)}</select>
    <label for="ai-text">Item</label>
    <textarea id="ai-text" rows="1" data-single placeholder="Imperative — e.g. Send the budgetary quote to Cox"></textarea>
    <label for="ai-detail">Detail (optional)</label>
    <textarea id="ai-detail" rows="3" placeholder="Context, names, dates"></textarea>
    <p class="hint">Saves for the whole team (commits to GitHub). Raised today; id assigned automatically.</p>
    <p class="error" id="ai-err" hidden>The item text can’t be empty.</p>
    <div class="modal-actions">
      <button class="btn" data-close>Cancel</button>
      <button class="btn btn-primary" id="ai-save">Add item</button>
    </div>`, true);
  root.querySelector('#ai-save').addEventListener('click', (e) => {
    const text = oneLine(root.querySelector('#ai-text').value);
    const detail = root.querySelector('#ai-detail').value.trim();
    const owner = root.querySelector('#ai-owner').value;
    if (!text) { root.querySelector('#ai-err').hidden = false; return; }
    saveViaMutate(e.currentTarget, (d) => {
      d.actionItems.unshift({
        id: nextWebAiId(d),
        owner,
        text,
        ...(detail ? { detail } : {}),
        created: todayStr(),
        source: `web — ${editorName()}`,
        status: 'open',
        completed: null,
      });
    }, baseOp('item-add', { owner, text, detail }),
    `Add item: ${text.slice(0, 60)} (${editorName()})`, 'Item added for the whole team.');
  });
}

function apsEditModal() {
  const aps = state.data.advancedPurchase;
  const rowHtml = (s) => `
    <div class="aps-edit-row"${s?.id ? ` data-stage-id="${esc(s.id)}"` : ''}>
      <textarea class="aps-label" rows="1" data-single placeholder="Stage">${esc(s?.label ?? '')}</textarea>
      <textarea class="aps-note" rows="1" placeholder="Note (optional)">${esc(s?.note ?? '')}</textarea>
      <button class="btn btn-small aps-row-del" title="Remove this stage">×</button>
    </div>`;
  const root = openModal(`
    <div class="modal-head"><h2>Edit advanced purchase status</h2><button class="modal-close" data-close>×</button></div>
    <div id="aps-rows">${aps.stages.map(rowHtml).join('')}</div>
    <button class="btn btn-small" id="aps-add-row">＋ Add stage</button>
    <label for="aps-footnote">Verification footnote (optional)</label>
    <textarea id="aps-footnote" rows="2">${esc(aps.lastVerifiedNote ?? '')}</textarea>
    <p class="hint">Saving updates it for the whole team and marks the status verified today (${esc(fmtDay(todayStr()))}).</p>
    <p class="error" id="aps-err" hidden>Every stage needs a label — remove empty rows with × instead.</p>
    <div class="modal-actions">
      <button class="btn" data-close>Cancel</button>
      <button class="btn btn-primary" id="aps-save">Save</button>
    </div>`);
  root.querySelector('#aps-add-row').addEventListener('click', () => {
    root.querySelector('#aps-rows').insertAdjacentHTML('beforeend', rowHtml(null));
    enableAutoGrow(root.querySelector('#aps-rows'));
  });
  root.querySelector('#aps-rows').addEventListener('click', (e) => {
    const del = e.target.closest('.aps-row-del');
    if (del) del.closest('.aps-edit-row').remove();
  });
  root.querySelector('#aps-save').addEventListener('click', (e) => {
    const rows = [...root.querySelectorAll('.aps-edit-row')].map(r => ({
      id: r.dataset.stageId || null,
      label: oneLine(r.querySelector('.aps-label').value),
      note: r.querySelector('.aps-note').value.trim(),
    }));
    if (rows.some(r => !r.label)) { root.querySelector('#aps-err').hidden = false; return; }
    const note = root.querySelector('#aps-footnote').value.trim();
    saveViaMutate(e.currentTarget, (d) => {
      const taken = rows.map(r => r.id).filter(Boolean);
      d.advancedPurchase.stages = rows.map(r => {
        const id = r.id ?? nextStageId(d, taken);
        if (!r.id) taken.push(id);
        return { id, label: r.label, ...(r.note ? { note: r.note } : {}) };
      });
      d.advancedPurchase.lastVerified = todayStr();
      if (note) d.advancedPurchase.lastVerifiedNote = note; else delete d.advancedPurchase.lastVerifiedNote;
    }, baseOp('aps-edit', { stages: rows.map(r => ({ ...(r.id ? { id: r.id } : {}), label: r.label, note: r.note })), footnote: note }),
    `Edit advanced purchase status (${editorName()})`, 'Advanced purchase status updated.');
  });
}

function riskModal(risk) {
  const isEdit = !!risk;
  const root = openModal(`
    <div class="modal-head"><h2>${isEdit ? 'Edit risk' : 'Add risk'}</h2><button class="modal-close" data-close>×</button></div>
    <label for="risk-title">Title</label>
    <textarea id="risk-title" rows="1" data-single placeholder="Short risk name">${esc(risk?.title ?? '')}</textarea>
    <label for="risk-detail">Detail (optional)</label>
    <textarea id="risk-detail" rows="3">${esc(risk?.detail ?? '')}</textarea>
    <label for="risk-note">Latest update note (optional)</label>
    <textarea id="risk-note" rows="1" data-single placeholder="e.g. Order shipped; monitoring">${esc(risk?.lastUpdateNote ?? '')}</textarea>
    <p class="hint">Saving stamps this risk as updated today (${esc(fmtDay(todayStr()))}).</p>
    <p class="error" id="risk-err" hidden>The title can’t be empty.</p>
    <div class="modal-actions"${isEdit ? ' style="justify-content:space-between"' : ''}>
      ${isEdit ? '<button class="btn btn-danger" id="risk-delete">Delete</button><span style="display:flex;gap:9px">' : ''}
      <button class="btn" data-close>Cancel</button>
      <button class="btn btn-primary" id="risk-save">${isEdit ? 'Save' : 'Add risk'}</button>
      ${isEdit ? '</span>' : ''}
    </div>`, true);
  root.querySelector('#risk-save').addEventListener('click', (e) => {
    const title = oneLine(root.querySelector('#risk-title').value);
    const detail = root.querySelector('#risk-detail').value.trim();
    const note = oneLine(root.querySelector('#risk-note').value);
    if (!title) { root.querySelector('#risk-err').hidden = false; return; }
    if (isEdit) {
      saveViaMutate(e.currentTarget, (d) => {
        const r = d.risks.find(x => x.id === risk.id) ?? d.risks.find(x => x.title === risk.title);
        if (!r) throw new Error('That risk no longer exists — someone may have removed it. Refresh.');
        r.title = title;
        if (detail) r.detail = detail; else delete r.detail;
        if (note) r.lastUpdateNote = note; else delete r.lastUpdateNote;
        r.lastUpdate = todayStr();
      }, baseOp('risk-edit', { riskId: risk.id, title, detail, note }),
      `Edit risk: ${title.slice(0, 60)} (${editorName()})`, 'Risk updated for the whole team.');
    } else {
      saveViaMutate(e.currentTarget, (d) => {
        d.risks.push({
          id: newRiskId(d, title),
          title,
          ...(detail ? { detail } : {}),
          lastUpdate: todayStr(),
          ...(note ? { lastUpdateNote: note } : {}),
        });
      }, baseOp('risk-add', { title, detail, note }),
      `Add risk: ${title.slice(0, 60)} (${editorName()})`, 'Risk added for the whole team.');
    }
  });
  if (isEdit) {
    armDelete(root.querySelector('#risk-delete'), (btn) => {
      saveViaMutate(btn, (d) => {
        let idx = d.risks.findIndex(x => x.id === risk.id);
        if (idx < 0) idx = d.risks.findIndex(x => x.title === risk.title);
        if (idx < 0) throw new Error('That risk no longer exists — refresh.');
        d.risks.splice(idx, 1);
      }, baseOp('risk-delete', { riskId: risk.id }),
      `Delete risk: ${risk.title.slice(0, 60)} (${editorName()})`, 'Risk removed.');
    });
  }
}

function historyModal() {
  const meetings = state.data.meetings;
  const html = `
    <div class="modal-head"><h2>Meeting history</h2><button class="modal-close" data-close>×</button></div>
    ${meetings.map((mtg, idx) => `
      <details class="history-meeting" ${idx === 0 ? 'open' : ''}>
        <summary>${esc(fmtDay(mtg.date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }))}<small>${mtg.durationMin ? `${mtg.durationMin} min` : ''}</small></summary>
        <div class="history-body">
          ${mtg.advancedPurchase ? `<div class="history-fact"><b>Advanced purchase:</b> ${esc(mtg.advancedPurchase)}</div>` : ''}
          ${mtg.risks ? `<div class="history-fact"><b>Risks:</b> ${esc(mtg.risks)}</div>` : ''}
          ${mtg.funFriday ? `<div class="history-fact"><b>Fun Friday:</b> ${esc(mtg.funFriday)}</div>` : ''}
          ${mtg.absent && Object.keys(mtg.absent).length ? `<div class="history-fact"><b>Not on:</b> ${esc(Object.entries(mtg.absent).map(([id, why]) => `${memberById(id)?.name ?? id} (${why})`).join(' · '))}</div>` : ''}
          <div class="history-notes">
            ${Object.entries(mtg.notes ?? {}).map(([id, notes]) => notes?.length ? `
              <div class="history-speaker">
                <h4>${esc(memberById(id)?.name ?? id)}</h4>
                <ul>${notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>
              </div>` : '').join('')}
          </div>
        </div>
      </details>`).join('')}`;
  openModal(html);
}

function settingsModal() {
  const name = getLS(LS.name) ?? '';
  let keyLine = '';
  if (state.teamToken && state.teamKeyExpires !== undefined) {
    if (state.teamKeyExpires === null) {
      keyLine = 'The shared edit key has no expiration.';
    } else {
      const d = keyDaysLeft();
      keyLine = d < 0
        ? '⚠ The shared edit key has <b>expired</b> — the owner needs to publish a fresh one (new fine-grained GitHub token → <code>node scripts/publish-edit-key.mjs</code>).'
        : `The shared edit key renews in <b>${d} day${d === 1 ? '' : 's'}</b> (${esc(fmtDay(state.teamKeyExpires.slice(0, 10), { month: 'short', day: 'numeric', year: 'numeric' }))}). Renewal takes ~2 minutes: new fine-grained GitHub token → <code>node scripts/publish-edit-key.mjs</code>.`;
    }
  }
  const root = openModal(`
    <div class="modal-head"><h2>Settings</h2><button class="modal-close" data-close>×</button></div>
    <label for="set-name">Your name (shown on items you complete or edit)</label>
    <input id="set-name" type="text" value="${esc(name)}" placeholder="e.g. Tyler">
    <p class="hint" style="margin-top:10px">${state.teamToken
      ? '✓ <b>Live editing is on.</b> Completes, edits, and new items save for the whole team instantly.'
      : '<b>Editing works offline here.</b> Changes save on this device instantly; tap “📤 Send sync” up top and they land for the whole team at the next tracker update.'}</p>
    ${keyLine ? `<p class="hint" style="margin-top:4px">${keyLine}</p>` : ''}
    ${pendingOps().some(o => o.sentAt) ? `<p class="hint" style="margin-top:4px">${pendingOps().filter(o => o.sentAt).length} synced change(s) sent, awaiting the next update. <button class="btn btn-small" id="set-resend">Re-queue them</button> if the email never went out.</p>` : ''}
    <div class="settings-info">
      <b>How it works.</b> The tracker is one encrypted file; the team passphrase unlocks it. Every weekday morning the meeting transcript updates it automatically — including items people said were done — and this file/page refreshes. Edits you make in between save live where possible, or ride along via Send sync.
    </div>
    <div class="modal-actions">
      <button class="btn" id="set-lock">Lock tracker on this device</button>
      <button class="btn btn-primary" id="set-save">Save</button>
    </div>`, true);
  root.querySelector('#set-resend')?.addEventListener('click', () => {
    setPendingOps(pendingOps().map(o => ({ ...o, sentAt: undefined })));
    closeModal();
    toast('Changes re-queued — tap “📤 Send sync” to open the email again.', 'ok');
  });
  root.querySelector('#set-save').addEventListener('click', () => {
    setLS(LS.name, root.querySelector('#set-name').value.trim() || null);
    closeModal();
    toast('Settings saved.', 'ok');
  });
  root.querySelector('#set-lock').addEventListener('click', () => {
    setLS(LS.pass, null);
    sessionStorage.removeItem(LS.pass);
    location.reload();
  });
}

/* ---------------- presentation mode ----------------
 * Full-screen, one slide per step of the call: welcome → advanced purchase →
 * risks → every member in call order (PTO/OOO members included, clearly
 * badged) → wrap-up. ✓ buttons stay live so items can be closed as people
 * report them. */
const present = { active: false, idx: 0, slides: [] };

function buildSlides() {
  const slides = [{ type: 'title' }, { type: 'aps' }, { type: 'risks' }];
  for (const g of state.data.groups) {
    for (const m of state.data.members.filter(x => x.group === g.id)) {
      slides.push({ type: 'member', memberId: m.id, groupName: g.name });
    }
  }
  slides.push({ type: 'wrap' });
  present.slides = slides;
}

function slideLabel(s) {
  if (!s) return '';
  if (s.type === 'title') return 'Welcome';
  if (s.type === 'aps') return 'Advanced Purchase Status';
  if (s.type === 'risks') return 'Current Risks & Updates';
  if (s.type === 'wrap') return 'Wrap-up';
  return memberById(s.memberId)?.name ?? '';
}

function openCount() {
  return state.data.actionItems.filter(i => i.status === 'open').length;
}

function presentSlideHtml(s) {
  const d = state.data;
  const mtg = latestMeeting();
  if (s.type === 'title') {
    const out = d.members.map(m => ({ m, p: activePto(m.id) })).filter(x => x.p);
    return `
      <div class="present-kicker">${esc(d.team)} · Daily Stand-Up</div>
      <div class="p-title-date">${esc(new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }))}</div>
      <div class="p-chips">
        <div class="p-chip"><b>${openCount()}</b> open action items</div>
        ${out.length ? `<div class="p-chip">Out today: ${esc(out.map(x => `${x.m.name.split(' ')[0]} (back ${fmtDay(x.p.returns, { month: 'short', day: 'numeric' })})`).join(' · '))}</div>` : ''}
        <div class="p-chip">Last stand-up: <b>${esc(fmtDay(mtg.date, { weekday: 'short', month: 'short', day: 'numeric' }))}</b></div>
      </div>
      <p class="present-sub" style="margin-top:28px">Press → or click Next to start with the advanced purchase status.</p>`;
  }
  if (s.type === 'aps') {
    const aps = d.advancedPurchase;
    return `
      <div class="present-kicker">First up · Any changes?</div>
      <div class="present-name">Advanced Purchase Status <button class="p-add" id="p-aps-edit">✎ Edit</button></div>
      <p class="present-sub">Verified ${esc(fmtDay(aps.lastVerified))}${aps.lastVerifiedNote ? ` — ${esc(aps.lastVerifiedNote)}` : ''}</p>
      <div>${aps.stages.map(st => `
        <div class="p-stage"><span class="p-stage-dot"></span>
          <div>
            <div class="p-stage-label">${esc(st.label)}</div>
            ${st.note ? `<div class="p-stage-note">${esc(st.note)}</div>` : ''}
          </div>
        </div>`).join('')}</div>`;
  }
  if (s.type === 'risks') {
    return `
      <div class="present-kicker">Kate · Any changes?</div>
      <div class="present-name">Current Risks &amp; Updates <button class="p-add" id="p-risk-add">＋ Add risk</button></div>
      <p class="present-sub">${d.risks.length} active</p>
      <div>${d.risks.map(r => `
        <div class="p-risk">
          <div class="p-risk-row">
            <div class="p-risk-title">${esc(r.title)}</div>
            <button class="risk-edit" data-id="${esc(r.id)}" title="Edit this risk">✎</button>
          </div>
          ${r.detail ? `<div class="p-risk-detail">${esc(r.detail)}</div>` : ''}
          ${r.lastUpdateNote ? `<div class="p-risk-note">${esc(fmtDay(r.lastUpdate, { month: 'short', day: 'numeric' }))} — ${esc(r.lastUpdateNote)}</div>` : ''}
        </div>`).join('')}</div>`;
  }
  if (s.type === 'wrap') {
    return `
      <div class="present-kicker">That's the round</div>
      <div class="present-name">Anything for the group?</div>
      <div class="p-chips">
        <div class="p-chip"><b>${openCount()}</b> action items open across the team</div>
        <div class="p-chip">Today's transcript updates the tracker automatically after the call</div>
      </div>`;
  }
  const m = memberById(s.memberId);
  const open = openItems(m.id);
  const { fresh } = splitDone(m.id);
  const notes = notesFor(m.id);
  const absent = mtg.absent?.[m.id];
  const pto = activePto(m.id);
  return `
    <div class="present-kicker">${esc(s.groupName)}</div>
    <div class="present-name">
      <span class="avatar present-avatar" style="background:hsl(${hueFor(m.id)} 45% 46%)">${esc(initials(m.name))}</span>
      ${esc(m.name)}
      ${pto
        ? `<span class="badge badge-ooo">${esc(pto.type)} · back ${esc(fmtDay(pto.returns, { month: 'short', day: 'numeric' }))}</span>`
        : (absent ? `<span class="badge badge-absent">absent ${esc(fmtDay(mtg.date, { month: 'short', day: 'numeric' }))} — ${esc(absent)}</span>` : '')}
    </div>
    ${pto?.note ? `<p class="present-sub" style="margin-bottom:0">${esc(pto.note)}</p>` : ''}
    <div class="present-cols">
      <div class="present-col">
        <h3>Open action items (${open.length}) <button class="p-add" data-member="${esc(m.id)}">＋ Add</button></h3>
        ${(open.length || fresh.length)
          ? `<ul class="ai-list">${open.map(i => aiItemHtml(i, false)).join('')}${fresh.map(i => aiItemHtml(i, true)).join('')}</ul>`
          : `<div class="p-empty">Nothing open — all clear.</div>`}
      </div>
      <div class="present-col">
        <h3>Notes — ${notes ? esc(fmtDay(notes.date)) : 'last stand-up'}</h3>
        ${notes
          ? `<ul class="p-notes">${notes.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>`
          : `<div class="p-empty">No notes recorded yet.</div>`}
      </div>
    </div>`;
}

function renderPresent() {
  const s = present.slides[present.idx];
  $('#present-slide').innerHTML = `<div class="present-inner">${presentSlideHtml(s)}</div>`;
  $('#present-slide').scrollTop = 0;
  const next = present.slides[present.idx + 1];
  $('#present-progress').textContent = `${present.idx + 1} / ${present.slides.length}`;
  $('#present-next-label').textContent = next ? `Up next: ${slideLabel(next)}` : 'Last slide — Esc to exit';
  $('#present-prev').disabled = present.idx === 0;
  $('#present-next').disabled = present.idx === present.slides.length - 1;
}

function openPresent() {
  present.active = true;
  buildSlides();
  present.idx = 0;
  document.body.classList.add('presenting');
  $('#present').hidden = false;
  renderPresent();
  document.activeElement?.blur?.();
}
function closePresent() {
  present.active = false;
  document.body.classList.remove('presenting');
  $('#present').hidden = true;
}
function presentNext() { if (present.idx < present.slides.length - 1) { present.idx++; renderPresent(); } }
function presentPrev() { if (present.idx > 0) { present.idx--; renderPresent(); } }

/* ---------------- boot flow ---------------- */
function applyTheme() {
  document.documentElement.dataset.theme = getLS(LS.theme, 'auto');
}
function cycleTheme() {
  const order = ['auto', 'light', 'dark'];
  const cur = getLS(LS.theme, 'auto');
  const next = order[(order.indexOf(cur) + 1) % order.length];
  setLS(LS.theme, next);
  applyTheme();
  toast(`Theme: ${next}`);
}

async function tryUnlock(pass) {
  const data = await decryptEnvelope(state.env, pass);
  state.passphrase = pass;
  state.data = data;
  // Re-apply this device's queued sync ops on top of the shared data (and drop
  // any the morning run has since applied — their ids land in data.appliedOps).
  replayPendingOps();
}

function showApp() {
  if (window.__HPT) window.__HPT.booted = true;
  $('#loading').hidden = true;
  $('#unlock').hidden = true;
  $('#topbar').hidden = false;
  $('#app').hidden = false;
  render();
  loadTeamKey(); // async — edit access appears as soon as the shared key decrypts
  if (state.snapshot) refreshFromLive(); // quietly upgrade to live data when reachable
}

function showUnlock(errMsg) {
  if (window.__HPT) window.__HPT.booted = true;
  $('#loading').hidden = true;
  $('#unlock').hidden = false;
  const err = $('#unlock-error');
  if (errMsg) { err.textContent = errMsg; err.hidden = false; } else { err.hidden = true; }
  setTimeout(() => $('#unlock-pass').focus(), 50);
}

async function refresh(showToast = false) {
  try {
    // Refresh must come from the LIVE sources — never re-read the embedded
    // snapshot (that caused pages that had upgraded to live data to revert
    // to the file's older built-in copy a couple of minutes later).
    const env = IS_FILE ? await fetchEnvelopeLive() : await fetchEnvelope();
    if (env.ct === state.env?.ct) { if (showToast) toast('Already up to date.', 'ok'); return; }
    // Never step backwards in time, whatever the source served us.
    if ((env.lastUpdated ?? '') < (state.env?.lastUpdated ?? '')) {
      if (showToast) toast('The server copy is older than what you’re viewing — keeping the newer data.', 'warn');
      return;
    }
    state.env = env;
    await tryUnlock(state.passphrase);
    state.snapshot = false;
    render();
    if (showToast) toast('Tracker updated.', 'ok');
  } catch (e) {
    if (showToast) toast(`Refresh failed: ${e.message}`, 'warn');
  }
}

async function boot() {
  console.log(`Cox HPT tracker v${APP_VERSION}`);
  applyTheme();
  step('Fetching tracker data');
  try {
    state.env = await fetchEnvelope();
  } catch (e) {
    if (window.__HPT) window.__HPT.booted = true; // show this message, not the watchdog's
    $('#loading').innerHTML = `
      <div style="max-width:560px;text-align:center;padding:0 16px">
        <p class="error" style="font-size:16px;font-weight:600">Couldn’t load the tracker data.</p>
        <p class="muted" style="font-size:13px;word-break:break-word">${esc(e.message)}</p>
        <p class="muted" style="font-size:13px">If this is a work laptop, a security agent may be blocking these requests — try another browser or your phone.</p>
        <button class="btn btn-primary" onclick="location.reload()">Retry</button>
      </div>`;
    return;
  }
  step('Checking saved passphrase');
  const savedPass = getLS(LS.pass) ?? sessionStorage.getItem(LS.pass);
  if (savedPass) {
    try { await tryUnlock(savedPass); showApp(); return; }
    catch { setLS(LS.pass, null); sessionStorage.removeItem(LS.pass); }
  }
  showUnlock();
}

/* ---------------- events ---------------- */
document.addEventListener('DOMContentLoaded', () => {
  $('#unlock-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pass = $('#unlock-pass').value;
    if (!pass) return;
    try {
      await tryUnlock(pass);
      if ($('#unlock-remember').checked) setLS(LS.pass, pass);
      else sessionStorage.setItem(LS.pass, pass);
      showApp();
    } catch {
      showUnlock('That passphrase didn’t work — try again.');
    }
  });

  $('#btn-sync').addEventListener('click', () => (state.snapshot ? refreshFromLive(true) : refresh(true)));
  $('#btn-sendsync').addEventListener('click', sendSync);
  $('#btn-history').addEventListener('click', historyModal);
  $('#btn-settings').addEventListener('click', settingsModal);
  $('#btn-theme').addEventListener('click', cycleTheme);

  // Delegated clicks in the team grid: complete/reopen, edit, add
  $('#team').addEventListener('click', (e) => {
    const chk = e.target.closest('.ai-check');
    if (chk) {
      const item = state.data.actionItems.find(i => i.id === chk.dataset.id);
      if (!item) return;
      if (chk.dataset.action === 'complete') confirmCompleteModal(item);
      else confirmReopenModal(item);
      return;
    }
    const edit = e.target.closest('.ai-edit');
    if (edit) {
      const item = state.data.actionItems.find(i => i.id === edit.dataset.id);
      if (item && requireWrite()) editActionItemModal(item);
      return;
    }
    const add = e.target.closest('.card-add');
    if (add && requireWrite()) { addActionItemModal(add.dataset.member); return; }
    // Compact-layout toggles: expand/collapse item details and long notes
    const txt = e.target.closest('.ai-text.has-detail');
    if (txt) {
      const li = txt.closest('.ai-item');
      const id = li.dataset.id;
      expandedItems.has(id) ? expandedItems.delete(id) : expandedItems.add(id);
      li.classList.toggle('expanded');
      return;
    }
    const noteLi = e.target.closest('.notes-list li.clampable');
    if (noteLi) {
      const key = noteLi.dataset.nkey;
      expandedNotes.has(key) ? expandedNotes.delete(key) : expandedNotes.add(key);
      noteLi.classList.toggle('expanded');
    }
  });

  // Risk + advanced purchase editing
  $('#risks-body').addEventListener('click', (e) => {
    const btn = e.target.closest('.risk-edit');
    if (!btn) return;
    const risk = state.data.risks.find(r => r.id === btn.dataset.id);
    if (risk && requireWrite()) riskModal(risk);
  });
  $('#btn-aps-edit').addEventListener('click', () => { if (requireWrite()) apsEditModal(); });
  $('#btn-risk-add').addEventListener('click', () => { if (requireWrite()) riskModal(null); });

  // Team jump navigation
  $('#groupnav').addEventListener('click', (e) => {
    const chip = e.target.closest('.gnav-chip');
    if (!chip) return;
    document.getElementById(chip.dataset.target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  window.addEventListener('resize', syncStickyHeight);

  // Presentation mode
  $('#btn-present').addEventListener('click', openPresent);
  $('#present-exit').addEventListener('click', closePresent);
  $('#present-prev').addEventListener('click', presentPrev);
  $('#present-next').addEventListener('click', presentNext);
  // Slides stay fully interactive: complete/reopen, edit, add, expand details.
  $('#present-slide').addEventListener('click', (e) => {
    const chk = e.target.closest('.ai-check');
    if (chk) {
      const item = state.data.actionItems.find(i => i.id === chk.dataset.id);
      if (!item) return;
      if (chk.dataset.action === 'complete') confirmCompleteModal(item);
      else confirmReopenModal(item);
      return;
    }
    const edit = e.target.closest('.ai-edit');
    if (edit) {
      const item = state.data.actionItems.find(i => i.id === edit.dataset.id);
      if (item && requireWrite()) editActionItemModal(item);
      return;
    }
    const addMember = e.target.closest('.p-add[data-member]');
    if (addMember) {
      if (requireWrite()) addActionItemModal(addMember.dataset.member);
      return;
    }
    if (e.target.closest('#p-aps-edit')) {
      if (requireWrite()) apsEditModal();
      return;
    }
    if (e.target.closest('#p-risk-add')) {
      if (requireWrite()) riskModal(null);
      return;
    }
    const riskEdit = e.target.closest('.risk-edit');
    if (riskEdit) {
      const risk = state.data.risks.find(r => r.id === riskEdit.dataset.id);
      if (risk && requireWrite()) riskModal(risk);
      return;
    }
    const txt = e.target.closest('.ai-text.has-detail');
    if (txt) {
      const li = txt.closest('.ai-item');
      const id = li.dataset.id;
      expandedItems.has(id) ? expandedItems.delete(id) : expandedItems.add(id);
      li.classList.toggle('expanded');
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (document.querySelector('#modal-root .modal')) { closeModal(); return; }
      if (present.active) closePresent();
      return;
    }
    if (!present.active) return;
    if (document.querySelector('#modal-root .modal')) return;
    if (e.target.matches?.('input, textarea, select')) return;
    if (e.key === ' ' && e.target.closest?.('button')) return; // let focused buttons take Space
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { e.preventDefault(); presentNext(); }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); presentPrev(); }
    else if (e.key === 'Home') { present.idx = 0; renderPresent(); }
  });

  // Gentle auto-refresh while the tab is visible (same-origin fetch — no rate limits).
  setInterval(() => { if (!document.hidden && state.data) refresh(false); }, 120000);

  boot();
});
})();
