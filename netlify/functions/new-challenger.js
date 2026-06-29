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
 * Ontraport posts to:
 *   https://<your-site>.netlify.app/.netlify/functions/new-challenger?secret=WEBHOOK_SECRET
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const ROW_KEY = 'roster';

exports.handler = async (event) => {
  // 1. Only accept POST
  if (event.httpMethod !== 'POST') {
    return resp(405, { error: 'Method not allowed' });
  }

  // 2. Check the shared secret (query string ?secret=... or x-webhook-secret header)
  const provided = (event.queryStringParameters && event.queryStringParameters.secret)
    || event.headers['x-webhook-secret'];
  if (!WEBHOOK_SECRET || provided !== WEBHOOK_SECRET) {
    return resp(401, { error: 'Unauthorized' });
  }

  // 3. Make sure the server is configured
  if (!SUPABASE_URL || !SERVICE_KEY) {
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
    return resp(400, { error: 'Could not parse body' });
  }

  // Pull a name from the most likely fields
  const first = data.firstname || data.first_name || data.firstName || '';
  const last  = data.lastname  || data.last_name  || data.lastName  || '';
  let name = (data.name || `${first} ${last}`).trim();
  if (!name) return resp(400, { error: 'No name in payload' });

  // Coach: use what's sent, else default to a placeholder the team can change
  const validCoaches = ['Dan', 'Grace', 'Gaz', 'Ash'];
  let coach = (data.coach || '').trim();
  if (!validCoaches.includes(coach)) coach = 'Dan';

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

    // 7. Build the new challenger in the EXACT shape the app expects
    const challenger = {
      id: 'op' + Date.now() + Math.random().toString(36).slice(2, 6),
      name,
      booked: null,
      day0: null,
      firstSessionDone: false,
      coach,
      personal: '',
      extraDays: 0,
      pausedDays: 0,
      pausedAt: null,
      signedUp: false,
      outcome: null,
      completed: [],
      doneMeta: {},
      checks: {},
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

    return resp(200, { ok: true, created: name, coach });
  } catch (e) {
    return resp(500, { error: String(e.message || e) });
  }
};

function authHeaders() {
  return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
}
function resp(status, body) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
