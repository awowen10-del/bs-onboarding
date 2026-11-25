/**
 * attendance-sync-background.js — Netlify background function (up to 15 minutes)
 *
 * Who trains, and how often, straight from TeamUp. Writes one row, 'attendance-teamup', that the
 * tracker's Attendance tab and member profiles read. Nothing in TeamUp or GHL is changed.
 *
 *   WHO   everyone with the GHL tag `member` (the one list of who is a member), matched to their
 *         TeamUp customer by email. TeamUp's own "active" memberships can't be the list: plenty
 *         were never closed when people left (269 "active" on 25 Nov 2026, 145 of them training).
 *   SINCE the start of their current unbroken run of TeamUp memberships, so moving from PT 12 to
 *         Gold doesn't restart the clock but leaving and coming back months later does.
 *   COUNT ONLY sessions they ATTENDED, and only training ones (Bodysculpt PT, BUILD, SWEAT,
 *         Capacity...), not intros, reviews, workshops or socials. No-shows and late cancels are
 *         never read here (Ash, 25 Nov 2026: they'll be their own report).
 *
 * First run backfills each member's whole history (about a thousand TeamUp calls, kept under the
 * 250-a-minute limit). After that each morning re-reads the last three weeks, which catches
 * late check-ins and corrections.
 *
 * Started by attendance-sync-daily.js (schedule in netlify.toml), or by hand:
 *   POST /.netlify/functions/attendance-sync-background  with header x-webhook-secret
 *   body {"full":true} redoes the whole backfill.
 *
 * ENV: TEAMUP_TOKEN, GHL_TOKEN, GHL_LOCATION_ID, SUPABASE_URL, SUPABASE_SERVICE_KEY, WEBHOOK_SECRET
 */

const TU = 'https://goteamup.com/api/v2';
const TU_PROVIDER = process.env.TEAMUP_PROVIDER_ID || '1653275';
const GHL = 'https://services.leadconnectorhq.com';
const LOCATION = process.env.GHL_LOCATION_ID || 'I88mpb966qBRVCCDbEx5';
const ROW = 'attendance-teamup';
const DAY = 86400000;
const RECHECK_DAYS = 21;
const CHAIN_GAP_DAYS = 45;     // a gap longer than this between memberships means they left and came back
/* GHL contact id -> TeamUp customer id, for members whose email differs between the two systems.
   Checked by hand on 25 Nov 2026 (same person, different address). Emails are left as they are:
   GHL's also finds them on Trainerize, so changing it could break that. */
const LINKS = {
  zi4uXHo4tUrCduab2Yqx: '10096405',   // Beckie Finn = Rebecca Finn on TeamUp
  kMAvpQMUPR9CyxcJpj3T: '13776995',   // Debbie MacMillan
  BToWD8773bNKWhphBClw: '13590480',   // Gaynor Wright
  ZkQLSUNf7IUJmd5xd7JE: '5316568',    // Lexander Wist
  j2rtyl1zyMXpbPA1d0Fz: '13290359',   // Paul Wilde
  eFDritqFr3l8IBVtTVik: '1946473',    // Emma Benson
};
const NOT_TRAINING = /intro|review|workshop|quiz|goal setting|cold water|games|social|consult|assessment/i;

const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- pure helpers (tested) ---------- */

/* ISO week key, Monday start, the same 'YYYY-Www' the tracker uses. */
function isoWeekKey(ms) {
  const d = new Date(ms); const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const day = new Date(t).getUTCDay() || 7;
  const thu = new Date(t + (4 - day) * DAY);
  const y = thu.getUTCFullYear();
  const wk = Math.ceil(((thu - Date.UTC(y, 0, 1)) / DAY + 1) / 7);
  return `${y}-W${String(wk).padStart(2, '0')}`;
}
const mondayOf = (ms) => { const d = new Date(ms); const t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); return t - ((new Date(t).getUTCDay() || 7) - 1) * DAY; };

const isTraining = (typeName) => !!typeName && !NOT_TRAINING.test(typeName);

/* The start of someone's current unbroken run of memberships. ms = [{start, end, status}]. */
function memberSince(ms) {
  const list = ms.filter((m) => m.start).slice().sort((a, b) => a.start.localeCompare(b.start));
  if (!list.length) return null;
  let i = list.length - 1;
  const live = list.map((m) => ['active', 'hold'].includes(m.status));
  for (let k = list.length - 1; k >= 0; k--) if (live[k]) { i = k; break; }
  let since = list[i].start;
  for (let k = i - 1; k >= 0; k--) {
    const prev = list[k];
    const end = prev.end ? Date.parse(prev.end) : Infinity;
    if (end >= Date.parse(since) - CHAIN_GAP_DAYS * DAY) since = prev.start < since ? prev.start : since;
    else break;
  }
  return since.slice(0, 10);
}

/* Fold ATTENDED sessions into weeks[tid][wk] = count and last[tid] = latest attended day. Anything not
   'attended' is ignored even if it arrives. */
function foldAttendances(rows, weeks, last, keep) {
  for (const a of rows) {
    const tid = String(a.customer && a.customer.id != null ? a.customer.id : a.customer);
    if (keep && !keep.has(tid)) continue;
    const at = a.event && a.event.starts_at; if (!at) continue;
    const type = a.event.offering_type && a.event.offering_type.name;
    if (!isTraining(type)) continue;
    if (a.status !== 'attended') continue;
    const wk = isoWeekKey(Date.parse(at));
    const w = (weeks[tid] = weeks[tid] || {});
    w[wk] = (w[wk] || 0) + 1;
    const d = at.slice(0, 10); if (!last[tid] || d > last[tid]) last[tid] = d;
  }
}

/* ---------- I/O ---------- */
async function json(url, opts) {
  const res = await fetch(url, opts); const text = await res.text();
  if (!res.ok) { const e = new Error(`${url.split('?')[0]} ${res.status}: ${text.slice(0, 200)}`); e.status = res.status; throw e; }
  return text ? JSON.parse(text) : {};
}
let tuPrefix = 'Bearer';
async function tu(path) {
  for (let attempt = 0; attempt < 5; attempt++) {
    await sleep(260);   // ~230 a minute, under TeamUp's 250
    try {
      return await json(path.startsWith('http') ? path : `${TU}/${path}`, { headers: {
        Accept: 'application/json', Authorization: `${tuPrefix} ${(process.env.TEAMUP_TOKEN || '').trim()}`,
        'Teamup-Provider-ID': TU_PROVIDER, 'Teamup-Request-Mode': 'provider' } });
    } catch (e) {
      if (e.status === 401 && tuPrefix === 'Bearer') { tuPrefix = 'Token'; continue; }
      if (e.status === 429 || e.status >= 500) { await sleep(2000 * (attempt + 1)); continue; }
      throw e;
    }
  }
  throw new Error('TeamUp kept refusing: ' + path.split('?')[0]);
}
async function tuAll(path) {
  const out = []; let url = path;
  for (let p = 0; p < 2000 && url; p++) { const j = await tu(url); out.push(...(j.results || [])); url = j.next || null; }
  return out;
}
const ghlHeaders = () => ({ Authorization: 'Bearer ' + (process.env.GHL_TOKEN || '').trim(), Version: '2021-07-28', 'Content-Type': 'application/json', Accept: 'application/json' });
async function ghlTagged(tag) {
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const r = await json(`${GHL}/contacts/search`, { method: 'POST', headers: ghlHeaders(), body: JSON.stringify({ locationId: LOCATION, page, pageLimit: 100, filters: [{ field: 'tags', operator: 'contains', value: [tag] }] }) });
    const got = r.contacts || []; out.push(...got); if (got.length < 100) break;
  }
  return out.filter((c) => (c.tags || []).map(norm).includes(tag));   // exactly this tag ('member' also matches 'member start' in GHL's search)
}
const ghlMembers = () => ghlTagged('member');
const LEAVING_TAGS = ['cancel approved', 'cancel approved now'];
const GONE_TAGS = ['cancelled member', 'lapsed member'];
/* Members-tab people GHL says have gone (a gone tag and no 'member'), matched by email, else full name. Pure. */
function goneFromTracker(retention, gone) {
  const em = new Set(gone.map((c) => norm(c.email)).filter(Boolean));
  const nm = new Set(gone.map((c) => norm([c.firstName, c.lastName].filter(Boolean).join(' ')).replace(/\s+/g, ' ')).filter(Boolean));
  return (retention || []).filter((m) => m && !m.left && ((m.email && em.has(norm(m.email))) || nm.has(norm(m.name).replace(/\s+/g, ' '))));
}
async function readRow(key) {
  const k = process.env.SUPABASE_SERVICE_KEY;
  const rows = await json(`${process.env.SUPABASE_URL}/rest/v1/bodysculpt?key=eq.${key}&select=value`, { headers: { apikey: k, Authorization: 'Bearer ' + k } });
  return rows[0] && rows[0].value;
}
async function writeRow(key, value) {
  const k = process.env.SUPABASE_SERVICE_KEY;
  await json(`${process.env.SUPABASE_URL}/rest/v1/bodysculpt`, { method: 'POST',
    headers: { apikey: k, Authorization: 'Bearer ' + k, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }) });
}
const ATT_Q = (from, to) => `attendances?status=attended&event_starts_at_gte=${from}T00:00:00Z&event_starts_at_lte=${to}T23:59:59Z`
  + `&expand=event,event.offering_type&fields=customer,status,event.starts_at,event.offering_type.name&page_size=100&sort=event_starts_at`;

/* Progress and errors go to a small row of their own, because background function logs are hard to reach. */
async function status(stage, extra) {
  await writeRow(ROW + '-status', Object.assign({ at: new Date().toISOString(), stage }, extra || {})).catch(() => {});
}
async function run({ full = false } = {}) {
  const t0 = Date.now(), now = Date.now();
  await status('started');
  let before = full ? null : await readRow(ROW).catch(() => null);
  if (before && !before.attendedOnly) before = null;   // written before the attended-only rule: rebuild it whole

  // 1. who is a member (GHL), 2. their TeamUp memberships
  const contacts = await ghlMembers();
  await status('ghl members read', { count: contacts.length });
  const cms = await tuAll('customer_memberships?membership_type=recurring&page_size=100&expand=membership,customer'
    + '&fields=customer.id,customer.email,customer.first_name,customer.last_name,start_date,expiration_date,status,membership.name');
  const byEmail = {}, byTid = {};
  for (const m of cms) {
    const c = m.customer || {}; const tid = String(c.id);
    const e = (byTid[tid] = byTid[tid] || { tid, memberships: [] });
    e.memberships.push({ start: m.start_date, end: m.expiration_date, status: m.status, plan: m.membership && m.membership.name });
    const em = norm(c.email); if (em) byEmail[em] = e;
  }
  const members = [];
  for (const c of contacts) {
    const em = norm(c.email);
    let hit = (LINKS[c.id] && (byTid[LINKS[c.id]] || { tid: LINKS[c.id], memberships: [] })) || (em && byEmail[em]);
    if (!hit && em) {   // a joint partner or someone with no membership of their own: find the customer by email
      const r = await tu(`customers?query=${encodeURIComponent(em)}&page_size=5&fields=id,email`).catch(() => ({}));
      const cust = (r.results || []).find((x) => norm(x.email) === em);
      if (cust) hit = { tid: String(cust.id), memberships: [] };
    }
    const live = hit && hit.memberships.filter((m) => ['active', 'hold'].includes(m.status)).sort((a, b) => (b.start || '').localeCompare(a.start || ''))[0];
    const tags = (c.tags || []).map(norm);
    members.push({ id: c.id, name: [c.firstName, c.lastName].filter(Boolean).join(' ').replace(/\b\w/g, (x) => x.toUpperCase()) || c.email,
      email: c.email || null, tid: hit ? hit.tid : null, since: hit ? memberSince(hit.memberships) : null,
      plan: live ? live.plan : null,
      paused: (live ? live.status === 'hold' : false) || tags.includes('paused'),          // the pause form's tag counts as much as a TeamUp hold
      leaving: LEAVING_TAGS.some((t) => tags.includes(t)) });
  }
  const keep = new Set(members.map((m) => m.tid).filter(Boolean));
  await status('matched to TeamUp', { members: members.length, matched: keep.size, memberships: cms.length });

  // 3. attendance: whole history the first time (or for anyone whose start is earlier than we hold), else the last three weeks
  const weeks = (before && before.weeks) || {}, last = (before && before.last) || {};
  for (const tid of Object.keys(weeks)) if (!keep.has(tid)) { delete weeks[tid]; delete last[tid]; }
  const earliest = members.map((m) => m.since).filter(Boolean).sort()[0] || ymd(now - 365 * DAY);
  const heldFrom = before && before.heldFrom;
  const recheckFrom = ymd(mondayOf(now - RECHECK_DAYS * DAY));
  // the recheck window is re-read whole, so clear those weeks first
  const recheckWeeks = new Set(); for (let t = Date.parse(recheckFrom); t <= now; t += 7 * DAY) recheckWeeks.add(isoWeekKey(t));
  for (const tid of Object.keys(weeks)) for (const wk of recheckWeeks) delete weeks[tid][wk];
  for (const tid of Object.keys(last)) if (last[tid] >= recheckFrom) delete last[tid];
  foldAttendances(await tuAll(ATT_Q(recheckFrom, ymd(now))), weeks, last, keep);

  /* Backfill, newest month first, from just before the recheck window (or just before what we
     already hold) back to the earliest start. Newest first so that if time runs out, what we
     hold is still one unbroken stretch and the next run carries on from its oldest edge. */
  let held = heldFrom && heldFrom < recheckFrom ? heldFrom : recheckFrom;
  let done = true;
  while (earliest < held) {
    if (Date.now() - t0 > 12 * 60000) { done = false; console.log('ATTENDANCE: out of time, the next run carries on from ' + held); break; }
    const to = ymd(Date.parse(held) - DAY);
    const m = new Date(to + 'T00:00:00Z'); m.setUTCDate(1);
    const from = ymd(Math.max(m.getTime(), Date.parse(earliest)));
    foldAttendances(await tuAll(ATT_Q(from, to)), weeks, last, keep);
    held = from;
    await status('backfilling', { heldFrom: held, seconds: Math.round((Date.now() - t0) / 1000) });
  }
  // last attended day for anyone whose last session is before the recheck window: from their weeks we can't tell the day,
  // so keep what we had (cleared above only when inside the window)
  const value = { updated: new Date().toISOString(), heldFrom: held, complete: done, attendedOnly: true,
    counted: 'attended training sessions only (not intros, reviews, workshops or socials; never no-shows or late cancels)', members, weeks, last };
  await writeRow(ROW, value);
  // the Members tab: anyone GHL says has gone gets 'left' (same flag the old Ontraport webhook set)
  let markedLeft = [];
  try {
    const gone = [];
    for (const t of GONE_TAGS) for (const c of await ghlTagged(t)) if (!(c.tags || []).map(norm).includes('member')) gone.push(c);
    const ret = await readRow('retention');
    const hits = goneFromTracker(Array.isArray(ret) ? ret : [], gone);
    if (hits.length) {
      const ids = new Set(hits.map((m) => m.id));
      const fresh = await readRow('retention');   // re-read just before writing, so a coach's edit in between isn't lost
      const next = (Array.isArray(fresh) ? fresh : []).map((m) => (ids.has(m.id) && !m.left ? Object.assign({}, m, { left: true, leftAt: ymd(now), leftBy: 'GHL' }) : m));
      await writeRow('retention', next);
      markedLeft = hits.map((m) => m.name);
    }
  } catch (e) { console.log('ATTENDANCE: could not update the Members tab: ' + e.message); }
  await status('done', { markedLeft, members: members.length, matched: keep.size, heldFrom: held, complete: done, seconds: Math.round((Date.now() - t0) / 1000) });
  const unmatched = members.filter((m) => !m.tid).map((m) => m.name);
  console.log(`ATTENDANCE: ${members.length} members, ${keep.size} matched to TeamUp, held from ${held}, ${Math.round((Date.now() - t0) / 1000)}s. Not in TeamUp: ${unmatched.join(', ') || 'none'}`);
  return { members: members.length, matched: keep.size, unmatched };
}

exports.handler = async (event) => {
  const h = event.headers || {};
  if (!process.env.WEBHOOK_SECRET || h['x-webhook-secret'] !== process.env.WEBHOOK_SECRET) return { statusCode: 401, body: 'Unauthorized' };
  let body = {}; try { body = JSON.parse(event.body || '{}'); } catch (e) { /* empty */ }
  try { await run({ full: !!body.full }); } catch (e) { console.error('ATTENDANCE failed: ' + e.message); await status('failed', { error: String(e.message).slice(0, 500) }); }
  return { statusCode: 202 };
};
exports.run = run;
exports.isoWeekKey = isoWeekKey;
exports.memberSince = memberSince;
exports.foldAttendances = foldAttendances;
exports.isTraining = isTraining;
exports.goneFromTracker = goneFromTracker;
