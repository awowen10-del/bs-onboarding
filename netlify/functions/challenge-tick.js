/**
 * challenge-tick.js — Netlify serverless function, run once a morning by challenge-tick-daily.js
 *
 * The tracker owns the clock. Each challenger's day number comes from the roster, using the same
 * sum as currentDay() in index.html, so a moved date, an Undo or a pause all move the emails too.
 * This function only tells GHL what is due, by adding a tag. Each tag starts its own email
 * workflow in GHL, so the wording stays in GHL where Ash can see it.
 *
 *   '6wc day N'         the email for day N is due. The tag is also the record that it went.
 *   '6wc finished'      their six weeks are up. A member's membership emails wait for this.
 *   '6wc lapsed'        a week after finishing, with no membership: Trainerize is deactivated
 *                       and the tag puts them on the lapsed list.
 *
 * Skipped: not started, paused, left, or (for emails) joined. Joining is the GHL tag 'member'
 * or outcome 'stayed' on the tracker.
 *
 * SAFE BY DEFAULT. Nothing is written unless CHALLENGE_LIVE=1 and the request is not a dry run.
 * Nobody whose clock started before CHALLENGE_FROM (YYYY-MM-DD) is touched, so people already
 * part way through don't get a run of old emails.
 *
 * ENVIRONMENT VARIABLES: SUPABASE_URL, SUPABASE_SERVICE_KEY, WEBHOOK_SECRET, GHL_TOKEN,
 * GHL_LOCATION_ID, TRAINERIZE_GROUP_ID, TRAINERIZE_API_ACCESS, CHALLENGE_LIVE, CHALLENGE_FROM
 */

const MS_DAY = 86400000;
const EMAIL_DAYS = [0, 2, 7, 14, 21, 28, 35, 37, 39, 41];
const LAPSE_AFTER = 7;
const GHL = 'https://services.leadconnectorhq.com';
const TZ_API = 'https://api.trainerize.com/v03';

const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();

/* Midnight today in Warrington, as the tracker's today0() sees it. */
function today0(now = new Date()) {
  const d = new Date(now.toLocaleString('en-GB', { timeZone: 'Europe/London', hour12: false }).replace(/(\d+)\/(\d+)\/(\d+),.*/, '$3-$2-$1') + 'T00:00:00Z');
  return d.getTime();
}
/* Stored dates are local midnights, so round to the nearest day when comparing with UTC. */
function currentDay(m, t0) {
  if (!m.firstSessionDone || !m.day0) return null;
  let e = Math.round((t0 - m.day0) / MS_DAY);
  e -= m.pausedDays || 0;
  if (m.pausedAt) e -= Math.round((t0 - m.pausedAt) / MS_DAY);
  return Math.max(0, e);
}
const totalDays = (m) => 42 + (m.extraDays || 0);

/* What this person is due today. Pure, so it can be tested without the outside world. */
function plan(m, tags, t0, fromMs) {
  if (!norm(m.email) || m.outcome === 'left' || m.pausedAt) return { skip: 'not eligible' };
  const day = currentDay(m, t0);
  if (day === null) return { skip: 'not started' };
  if (fromMs && m.day0 < fromMs - MS_DAY / 2) return { skip: 'started before launch' };
  const has = (t) => tags.includes(t);
  const joined = has('member') || m.outcome === 'stayed';
  const add = [];
  let lapse = false;
  if (!joined) {
    const due = EMAIL_DAYS.find((d) => day >= d && !has('6wc day ' + d));   // earliest unsent, one a day
    if (due !== undefined) add.push('6wc day ' + due);
  }
  if (day >= totalDays(m) && !has('6wc finished')) add.push('6wc finished');
  if (!joined && day >= totalDays(m) + LAPSE_AFTER && !has('6wc lapsed')) { add.push('6wc lapsed'); lapse = true; }
  return { day, add, lapse };
}

async function json(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  if (!res.ok) throw new Error(`${url.split('?')[0]} ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}
const ghlHeaders = () => ({
  Authorization: 'Bearer ' + (process.env.GHL_TOKEN || '').trim(),
  Version: '2021-07-28', 'Content-Type': 'application/json', Accept: 'application/json',
});
async function findContact(email) {
  const q = `${GHL}/contacts/?locationId=${encodeURIComponent(process.env.GHL_LOCATION_ID)}&query=${encodeURIComponent(email)}&limit=20`;
  const r = await json(q, { headers: ghlHeaders() });
  return (r.contacts || []).find((c) => norm(c.email) === norm(email)) || null;
}
async function addTags(id, tags) {
  return json(`${GHL}/contacts/${id}/tags`, { method: 'POST', headers: ghlHeaders(), body: JSON.stringify({ tags }) });
}
async function deactivateTrainerize(email) {
  const token = process.env.TRAINERIZE_API_TOKEN || process.env.TRAINERIZE_API_ACCESS;
  const auth = 'Basic ' + Buffer.from(`${process.env.TRAINERIZE_GROUP_ID}:${token}`).toString('base64');
  const headers = { 'Content-Type': 'application/json', Authorization: auth };
  const r = await json(TZ_API + '/user/find', { method: 'POST', headers, body: JSON.stringify({ searchTerm: email, view: 'allClient', start: 0, count: 10 }) });
  const u = (r.users || []).find((x) => norm(x.email) === norm(email));
  if (!u) return 'not on Trainerize';
  await json(TZ_API + '/user/setStatus', { method: 'POST', headers, body: JSON.stringify({ userID: u.id, accountStatus: 'deactivated' }) });
  return 'deactivated';
}
async function roster() {
  const url = `${process.env.SUPABASE_URL}/rest/v1/bodysculpt?key=eq.roster&select=value`;
  const key = process.env.SUPABASE_SERVICE_KEY;
  const rows = await json(url, { headers: { apikey: key, Authorization: 'Bearer ' + key } });
  return (rows[0] && Array.isArray(rows[0].value)) ? rows[0].value : [];
}

async function run({ dryRun }) {
  const live = process.env.CHALLENGE_LIVE === '1' && !dryRun;
  const fromMs = process.env.CHALLENGE_FROM ? Date.parse(process.env.CHALLENGE_FROM + 'T00:00:00Z') : null;
  const t0 = today0();
  const report = { live, checked: 0, actions: [], errors: [] };
  for (const m of await roster()) {
    const pre = plan(m, [], t0, fromMs);
    if (pre.skip) continue;
    report.checked++;
    try {
      const c = await findContact(m.email);
      if (!c) { report.errors.push(`no GHL contact for ${m.name}`); continue; }
      const p = plan(m, (c.tags || []).map(norm), t0, fromMs);
      if (!p.add.length) continue;
      if (live) {
        if (p.lapse) await deactivateTrainerize(m.email);
        await addTags(c.id, p.add);
      }
      report.actions.push({ name: m.name, day: p.day, add: p.add });
    } catch (e) {
      report.errors.push(`${m.name}: ${e.message}`);
    }
  }
  console.log('TICK ' + JSON.stringify(report));
  return report;
}

exports.handler = async (event) => {
  const provided = (event.queryStringParameters && event.queryStringParameters.secret) || event.headers['x-webhook-secret'];
  if (!process.env.WEBHOOK_SECRET || provided !== process.env.WEBHOOK_SECRET) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }
  const dryRun = (event.queryStringParameters || {}).dry_run !== '0';
  try {
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(await run({ dryRun })) };
  } catch (e) {
    console.log('ERROR ' + e.message);
    return { statusCode: 502, body: JSON.stringify({ error: e.message }) };
  }
};
exports.run = run;
exports.plan = plan;
exports.currentDay = currentDay;
