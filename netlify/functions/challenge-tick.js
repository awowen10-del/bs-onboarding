/**
 * challenge-tick.js — Netlify serverless function, run once a morning by challenge-tick-daily.js
 *
 * The tracker owns the clock. Each challenger's day number comes from the roster, using the same
 * sum as currentDay() in index.html, so a moved date, an Undo or a pause all move the emails too.
 * This function only tells GHL what is due, by adding a tag. Each tag starts its own email
 * workflow in GHL, so the wording stays in GHL where Ash can see it.
 *
 *   '6wc day N'         the email for day N is due. Only the latest stays on the contact: the
 *                       one before comes off, and the one left is the record of how far they got.
 *   'member'            outcome 'stayed' on the tracker. No more challenge emails.
 *   '6wc finished'      their six weeks are up. A member's membership emails wait for this.
 *   '6wc lapsed'        a week after finishing, with no membership: Trainerize is deactivated
 *                       and the tag puts them on the lapsed list.
 *   '6wc guide ...'     that guide is in their Trainerize attachments, so it's never added twice.
 *
 *   '6wc guide failed'  a guide couldn't be added. The tag starts a text to Ash in GHL.
 *
 * The guides go on as soon as a coach presses Done on the Intro (guides-now-background.js). The
 * morning run catches anyone that missed, and adds them before the email, as the email tells
 * people they're there. If one fails, that person gets no email and the next morning carries on
 * from the guide it stopped at.
 *
 * The first email goes the morning after a coach presses Done on their Intro. The rest run from
 * the start date.
 *
 * Skipped: Intro not done, paused, left, or (for emails) joined. Joining is the GHL tag 'member'
 * or outcome 'stayed' on the tracker.
 *
 * SAFE BY DEFAULT. Nothing is written unless CHALLENGE_LIVE=1 and the request is not a dry run.
 * Nobody whose clock started before CHALLENGE_FROM (YYYY-MM-DD) is touched, so people already
 * part way through don't get a run of old emails.
 *
 * ENVIRONMENT VARIABLES: SUPABASE_URL, SUPABASE_SERVICE_KEY, WEBHOOK_SECRET, GHL_TOKEN,
 * TRAINERIZE_GROUP_ID, TRAINERIZE_API_ACCESS, CHALLENGE_LIVE, CHALLENGE_FROM
 */

const MS_DAY = 86400000;
const EMAIL_DAYS = [0, 2, 7, 14, 21, 28, 35, 37, 39, 41];
const LAPSE_AFTER = 7;
const GHL = 'https://services.leadconnectorhq.com';
const LOCATION = process.env.GHL_LOCATION_ID || 'I88mpb966qBRVCCDbEx5';
const TZ_API = 'https://api.trainerize.com/v03';
const GUIDE_FAILED = '6wc guide failed';
const GUIDES = [
  { tag: '6wc guide welcome', name: 'Bodysculpt Welcome Guide.pdf', path: 'guides/Bodysculpt-Welcome-Guide.pdf' },
  { tag: '6wc guide nutracheck', name: 'Bodysculpt Nutracheck Guide.pdf', path: 'guides/Bodysculpt-Nutracheck-Guide.pdf' },
  { tag: '6wc guide myfitnesspal', name: 'Bodysculpt MyFitnessPal Guide.pdf', path: 'guides/Bodysculpt-MyFitnessPal-Guide.pdf' },
];

const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();

/* Midnight today in Warrington, as the tracker's today0() sees it. */
function today0(now = new Date()) {
  const d = new Date(now.toLocaleString('en-GB', { timeZone: 'Europe/London', hour12: false }).replace(/(\d+)\/(\d+)\/(\d+),.*/, '$3-$2-$1') + 'T00:00:00Z');
  return d.getTime();
}
/* Stored dates are local midnights, so round to the nearest day when comparing with UTC.
   The clock runs from day0 once it's started, or from the booked first session until then.
   Null means no date yet; a date still to come gives a negative day. */
function currentDay(m, t0) {
  const start = m.day0 || m.booked;
  if (!start) return null;
  let e = Math.round((t0 - start) / MS_DAY);
  e -= m.pausedDays || 0;
  if (m.pausedAt) e -= Math.round((t0 - m.pausedAt) / MS_DAY);
  return e;
}
const introDone = (m) => (m.completed || []).includes('intro') || !!m.firstSessionDone;
const totalDays = (m) => 42 + (m.extraDays || 0);

/* What this person is due today. Pure, so it can be tested without the outside world. */
function plan(m, tags, t0, fromMs) {
  if (!norm(m.email) || m.outcome === 'left' || m.pausedAt) return { skip: 'not eligible' };
  if (!introDone(m)) return { skip: 'intro not done' };
  const day = currentDay(m, t0);
  const start = m.day0 || m.booked;
  if (fromMs && start && start < fromMs - MS_DAY / 2) return { skip: 'started before launch' };
  const has = (t) => tags.includes(t);
  const joined = has('member') || m.outcome === 'stayed';
  const add = [];
  let lapse = false;
  const remove = [];
  if (m.outcome === 'stayed' && !has('member')) add.push('member');
  if (!joined) {
    const sent = tags.map((t) => /^6wc day (\d+)$/.exec(t)).filter(Boolean).map((x) => Number(x[1]));
    const last = sent.length ? Math.max(...sent) : -1;
    const due = EMAIL_DAYS.find((d) => d > last && (d === 0 || (day !== null && day >= d)));   // Day 0 goes on the Intro being done; the next unsent, one a day
    if (due !== undefined) {
      add.push('6wc day ' + due);
      sent.forEach((d) => remove.push('6wc day ' + d));
    }
  }
  const running = !!m.firstSessionDone && !!m.day0;
  if (running && day >= totalDays(m) && !has('6wc finished')) add.push('6wc finished');
  if (running && !joined && day >= totalDays(m) + LAPSE_AFTER && !has('6wc lapsed')) { add.push('6wc lapsed'); lapse = true; }
  return { day, add, remove, lapse, guides: GUIDES.filter((g) => !has(g.tag)) };
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
  const q = `${GHL}/contacts/?locationId=${encodeURIComponent(LOCATION)}&query=${encodeURIComponent(email)}&limit=20`;
  const r = await json(q, { headers: ghlHeaders() });
  return (r.contacts || []).find((c) => norm(c.email) === norm(email)) || null;
}
async function addTags(id, tags) {
  return json(`${GHL}/contacts/${id}/tags`, { method: 'POST', headers: ghlHeaders(), body: JSON.stringify({ tags }) });
}
async function removeTags(id, tags) {
  return json(`${GHL}/contacts/${id}/tags`, { method: 'DELETE', headers: ghlHeaders(), body: JSON.stringify({ tags }) });
}
function tzAuth() {
  const token = process.env.TRAINERIZE_API_TOKEN || process.env.TRAINERIZE_API_ACCESS;
  return 'Basic ' + Buffer.from(`${process.env.TRAINERIZE_GROUP_ID}:${token}`).toString('base64');
}
const tzHeaders = () => ({ 'Content-Type': 'application/json', Authorization: tzAuth() });
async function findTrainerize(email) {
  const r = await json(TZ_API + '/user/find', { method: 'POST', headers: tzHeaders(), body: JSON.stringify({ searchTerm: email, view: 'allClient', start: 0, count: 10 }) });
  return (r.users || []).find((x) => norm(x.email) === norm(email)) || null;
}
async function deactivateTrainerize(email) {
  const u = await findTrainerize(email);
  if (!u) return 'not on Trainerize';
  await json(TZ_API + '/user/setStatus', { method: 'POST', headers: tzHeaders(), body: JSON.stringify({ userID: u.id, accountStatus: 'deactivated' }) });
  return 'deactivated';
}
/* Adds one guide to a client's Trainerize attachments. The PDFs are served by this site. */
async function uploadGuide(userID, guide) {
  const pdf = await fetch(`${process.env.URL}/${guide.path}`);
  if (!pdf.ok) throw new Error(`${guide.path} ${pdf.status}`);
  const form = new FormData();
  form.append('data', JSON.stringify({ fileName: guide.name, attachType: 'userAttachment', attachTo: userID }));
  form.append('file', new Blob([await pdf.arrayBuffer()], { type: 'application/pdf' }), guide.name);
  const r = await json(TZ_API + '/file/upload', { method: 'POST', headers: { Authorization: tzAuth() }, body: form });
  if (!r.id) throw new Error(`${guide.name} not added: ${JSON.stringify(r).slice(0, 200)}`);
}
/* Guides first: the tag goes on after each one, so a failure part way picks up where it stopped. */
async function addGuides(email, contact, guides) {
  if (!guides.length) return;
  const failedBefore = (contact.tags || []).map(norm).includes(GUIDE_FAILED);
  try {
    const u = await findTrainerize(email);
    if (!u) throw new Error('not on Trainerize, so no guides or email today');
    for (const g of guides) {
      await uploadGuide(u.id, g);
      await addTags(contact.id, [g.tag]);
    }
    if (failedBefore) await removeTags(contact.id, [GUIDE_FAILED]);
  } catch (e) {
    if (!failedBefore) await addTags(contact.id, [GUIDE_FAILED]).catch(() => {});   // one text, not one a day
    throw e;
  }
}
/* A coach has just pressed Done on this person's Intro. Anyone can call this, as all it can ever
   do is what the morning run would have done anyway: the roster and the tags decide. */
async function guidesNow(id) {
  if (process.env.CHALLENGE_LIVE !== '1') return 'not live';
  const fromMs = process.env.CHALLENGE_FROM ? Date.parse(process.env.CHALLENGE_FROM + 'T00:00:00Z') : null;
  const t0 = today0();
  const m = (await roster()).find((x) => x.id === id);
  if (!m) return 'not on the roster';
  const pre = plan(m, [], t0, fromMs);
  if (pre.skip) return pre.skip;
  const c = await findContact(m.email);
  if (!c) throw new Error(`no GHL contact for ${m.name}`);
  const p = plan(m, (c.tags || []).map(norm), t0, fromMs);
  await addGuides(m.email, c, p.guides);
  return `${p.guides.length} added`;
}
/* A test run on one person: adds all the guides and sets no tags. */
async function testGuides(email) {
  const u = await findTrainerize(email);
  if (!u) throw new Error('not on Trainerize');
  for (const g of GUIDES) await uploadGuide(u.id, g);
  return { userID: u.id, added: GUIDES.length };
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
      if (!p.add.length && !p.guides.length) continue;
      if (live) {
        await addGuides(m.email, c, p.guides);
        if (p.lapse) await deactivateTrainerize(m.email);
        await addTags(c.id, p.add);
        if (p.remove.length) await removeTags(c.id, p.remove);
      }
      report.actions.push({ name: m.name, day: p.day, add: p.add, guides: p.guides.map((g) => g.tag) });
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
    // ?check=<email>: confirm the GHL token works and show that contact's 6WC tags. Reads only.
    const check = (event.queryStringParameters || {}).check;
    if (check) {
      const c = await findContact(check);
      return { statusCode: 200, body: JSON.stringify({ found: !!c, tags: c ? (c.tags || []).filter((t) => /6wc|member/i.test(t)) : [] }) };
    }
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(await run({ dryRun })) };
  } catch (e) {
    console.log('ERROR ' + e.message);
    return { statusCode: 502, body: JSON.stringify({ error: e.message }) };
  }
};
exports.run = run;
exports.plan = plan;
exports.testGuides = testGuides;
exports.guidesNow = guidesNow;
exports.currentDay = currentDay;
