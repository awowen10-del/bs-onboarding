/**
 * new-challenger.js — Netlify serverless function
 *
 * Receives a webhook from Ontraport when a "6 Week Challenge" tag is added,
 * and creates a "Not started" challenger in the tracker's Supabase roster.
 *
 * Ontraport calls this with the new client's name (and optionally coach).
 * The function appends them to the single 'roster' row the app reads.
 *
 * ENVIRONMENT VARIABLES (set in Netlify → Site settings → Environment variables):
 *   SUPABASE_URL          your project URL (https://xxxx.supabase.co)
 *   SUPABASE_SERVICE_KEY  the Supabase SECRET key (server-only, never in the browser)
 *   WEBHOOK_SECRET        a long random string you also put in the Ontraport webhook URL
 *
 * A payer from GHL arrives with an email, so this also sets them up in Trainerize and TeamUp,
 * using the same event. Ontraport's webhook sends a name only, and those two refuse it. If
 * either app fails it is logged and the tracker result still stands: nobody loses their place
 * on the tracker because an app was down, and a repeat webhook is safe in all three.
 *
 * Ontraport posts to:
 *   https://<your-site>.netlify.app/.netlify/functions/new-challenger?secret=WEBHOOK_SECRET
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const ROW_KEY = 'roster';

/* Black Friday 2026: anyone who pays from Sunday 15 to Sunday 22 November trains free until
   their six weeks start on Monday 4 January 2027. The tracker holds their clock at day 0 until
   then (m.sixStart), and a coach can change or clear the date on the Edit form.
   Times are UK midnights, which are UTC midnights in winter. */
const BF_FROM = Date.UTC(2026, 10, 15), BF_TO = Date.UTC(2026, 10, 23), BF_SIX_START = Date.UTC(2027, 0, 4);
const sixStartFor = (now) => (now >= BF_FROM && now < BF_TO ? BF_SIX_START : null);

const trainerize = require('./trainerize-new-client');
const teamup = require('./teamup-new-client');

exports.handler = async (event) => {
  const res = await addToTracker(event);
  if (res.statusCode === 200) {
    const apps = await Promise.allSettled([trainerize.handler(event), teamup.handler(event)]);
    ['trainerize', 'teamup'].forEach((app, i) => {
      const r = apps[i];
      console.log(`APP ${app}: ` + (r.status === 'fulfilled' ? `${r.value.statusCode} ${r.value.body}` : String(r.reason)));
    });
  }
  return res;
};

async function addToTracker(event) {
  // 1. Only accept POST
  if (event.httpMethod !== 'POST') {
    return resp(405, { error: 'Method not allowed' });
  }

  // 2. Check the shared secret (query string ?secret=... or x-webhook-secret header)
  const provided = (event.queryStringParameters && event.queryStringParameters.secret)
    || event.headers['x-webhook-secret'];
  if (!WEBHOOK_SECRET) {
    console.log('REJECT: WEBHOOK_SECRET env var is not set in Netlify');
    return resp(401, { error: 'Unauthorized (no secret configured)' });
  }
  if (provided !== WEBHOOK_SECRET) {
    console.log('REJECT: secret mismatch. Provided=' + JSON.stringify(provided));
    return resp(401, { error: 'Unauthorized (secret mismatch)' });
  }

  // 3. Make sure the server is configured
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.log('REJECT: missing env vars. URL set=' + !!SUPABASE_URL + ' KEY set=' + !!SERVICE_KEY);
    return resp(500, { error: 'Server not configured (missing Supabase env vars)' });
  }

  // 4. Parse the incoming payload. Ontraport can send JSON or form-encoded;
  //    we accept a few likely field names so it's forgiving.
  let data = {};
  try {
    const ct = (event.headers['content-type'] || '').toLowerCase();
    if (ct.includes('application/json')) {
      data = JSON.parse(event.body || '{}');
    } else {
      // form-encoded (Ontraport default for some webhooks)
      data = Object.fromEntries(new URLSearchParams(event.body || ''));
    }
  } catch (e) {
    console.log('REJECT: could not parse body. Raw body=' + (event.body || '').slice(0, 300));
    return resp(400, { error: 'Could not parse body' });
  }
  console.log('PAYLOAD received: ' + JSON.stringify(data).slice(0, 400));

  // Pull a name from the most likely fields
  const first = data.firstname || data.first_name || data.firstName || '';
  const last  = data.lastname  || data.last_name  || data.lastName  || '';
  let name = (data.name || `${first} ${last}`).trim();
  if (!name) {
    console.log('REJECT: no name found in payload. Keys=' + Object.keys(data).join(','));
    return resp(400, { error: 'No name in payload', keysReceived: Object.keys(data) });
  }

  // Email, if Ontraport sent one. Not used by the app, but set-dob.js falls back to it when
  // a later webhook can't match on name alone, so it is worth keeping from the start.
  const email = String(data.email || data.contact_email || data.Email || '').trim().toLowerCase();

  // Coach: use what's sent, else default to a placeholder the team can change
  const validCoaches = ['Dan', 'Grace', 'Gaz', 'Ash'];
  let coach = (data.coach || '').trim();
  if (!validCoaches.includes(coach)) coach = 'Dan';
  console.log('OK: creating challenger name="' + name + '" coach="' + coach + '"');

  try {
    // 5. Read the current roster row
    const getRes = await fetch(
      `${SUPABASE_URL}/rest/v1/bodysculpt?key=eq.${ROW_KEY}&select=value`,
      { headers: authHeaders() }
    );
    if (!getRes.ok) throw new Error(`read failed: ${getRes.status}`);
    const rows = await getRes.json();
    const roster = (rows[0] && Array.isArray(rows[0].value)) ? rows[0].value : [];

    // 6. Duplicate guard — if a not-started challenger with this name already
    //    exists (e.g. webhook fired twice), don't create a second one.
    const exists = roster.some(m =>
      (m.name || '').trim().toLowerCase() === name.toLowerCase() && !m.firstSessionDone
    );
    if (exists) {
      return resp(200, { ok: true, skipped: 'duplicate', name });
    }

    // 7. Build the new challenger in the EXACT shape the app expects.
    //    "Exact" means: every field index.html's migrateList() would otherwise have to
    //    back-fill. The app copes either way — migrateList defaults anything missing — but a
    //    record that arrives complete is a record no coach's browser has to repair before the
    //    blob is correct in Supabase, and it keeps a webhook-created challenger byte-for-byte
    //    comparable with one typed in through "+ Add challenger".
    //    Anything added to migrateList from here on belongs in this object too.
    const challenger = {
      id: 'op' + Date.now() + Math.random().toString(36).slice(2, 6),
      name,
      booked: null,
      day0: null,
      sixStart: sixStartFor(Date.now()),   // Black Friday payers: six weeks start 4 January
      firstSessionDone: false,
      coach,
      personal: '',
      email: email || null,
      dob: null,               // filled in later by hand, or by the set-dob webhook
      extraDays: 0,
      pausedDays: 0,
      pausedAt: null,
      signedUp: false,
      outcome: null,
      completed: [],
      missed: [],              // touchpoints explicitly marked missed
      doneMeta: {},
      checks: {},
      notes: '',               // the shared per-client notes document
      followUpOn: null,        // "Left — follow up": timestamp (local midnight) or null
      followUpStatus: null,    // 'pending' | 'done' | null
      birthdayIgnored: false,  // hidden from the Birthdays tab for good
      birthdayActionedYear: null, // the year of the birthday already handled, or null
      source: 'ontraport'      // handy marker; the app ignores unknown fields
    };
    roster.push(challenger);

    // 8. Write the roster back (upsert the single row)
    const putRes = await fetch(
      `${SUPABASE_URL}/rest/v1/bodysculpt?on_conflict=key`,
      {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({ key: ROW_KEY, value: roster, updated_at: new Date().toISOString() })
      }
    );
    if (!putRes.ok) throw new Error(`write failed: ${putRes.status} ${await putRes.text()}`);

    console.log('SUCCESS: challenger "' + name + '" added. Roster now has ' + roster.length + ' people.');
    return resp(200, { ok: true, created: name, coach });
  } catch (e) {
    console.log('ERROR during read/write: ' + String(e.message || e));
    return resp(500, { error: String(e.message || e) });
  }
}

function authHeaders() {
  return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
}
function resp(status, body) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
exports.sixStartFor = sixStartFor;
