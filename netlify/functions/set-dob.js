/**
 * set-dob.js — Netlify serverless function
 *
 * Sets an EXISTING challenger's date of birth from an incoming webhook (Ontraport via
 * Zapier). It never creates anybody: if the name doesn't match someone already on the
 * roster, it says so and changes nothing. Creating challengers is new-challenger.js's job.
 *
 * Matching: by name — trimmed, case-insensitive, repeated spaces collapsed — falling back
 * to email when one is sent and the name finds nothing.
 *
 * ENVIRONMENT VARIABLES (Netlify → Site settings → Environment variables):
 *   SUPABASE_URL          your project URL (https://xxxx.supabase.co)
 *   SUPABASE_SERVICE_KEY  the Supabase SECRET key (server-only, never in the browser)
 *   WEBHOOK_SECRET        the same shared secret new-challenger.js uses
 *   DOB_DATE_ORDER        optional, 'DMY' (default) or 'MDY' — only consulted for an
 *                         ambiguous all-numeric date like 04/05/1990. Warrington is in the
 *                         UK, so the default reads that as 4 May. Send ISO (1990-05-04)
 *                         from the Zap and this never has to guess.
 *
 * Zapier posts to:
 *   https://<your-site>.netlify.app/.netlify/functions/set-dob?secret=WEBHOOK_SECRET
 * with a JSON or form body containing a name (or firstname + lastname), an optional email,
 * and the date of birth in any of the usual field names (dob, date_of_birth, birthday, …).
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const DATE_ORDER = String(process.env.DOB_DATE_ORDER || 'DMY').trim().toUpperCase();
const ROW_KEY = 'roster';

const MONTHS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];

/* Names as people actually type them: "  Sarah   Doyle " and "sarah doyle" are one person. */
function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
}

/* Is this a real calendar date, and a plausible birthday? */
function validParts(y, m, d) {
  if (!(y >= 1900 && y <= new Date().getUTCFullYear())) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  const p = (n) => String(n).padStart(2, '0');
  return `${y}-${p(m)}-${p(d)}`;
}

/**
 * Turn whatever arrived into "YYYY-MM-DD", or null.
 * Returns { iso, how } so the log can say how it read an ambiguous one.
 * Handles: ISO (with or without a time), d/m/y and m/d/y with / . or -, and month names.
 */
function parseDob(raw) {
  let s = String(raw == null ? '' : raw).trim();
  if (!s) return null;
  s = s.replace(/^["']|["']$/g, '').trim();

  // ISO, optionally carrying a time: 1990-04-23, 1990-04-23T00:00:00Z
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(s);
  if (m) {
    const iso = validParts(+m[1], +m[2], +m[3]);
    return iso ? { iso, how: 'iso' } : null;
  }

  // All-numeric with separators: 23/04/1990, 04.23.1990, 23-04-1990
  m = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/.exec(s);
  if (m) {
    const a = +m[1], b = +m[2], y = +m[3];
    let day, mon, how;
    if (a > 12 && b <= 12) { day = a; mon = b; how = 'day-first (unambiguous)'; }
    else if (b > 12 && a <= 12) { mon = a; day = b; how = 'month-first (unambiguous)'; }
    else if (DATE_ORDER === 'MDY') { mon = a; day = b; how = 'ambiguous, read as MDY'; }
    else { day = a; mon = b; how = 'ambiguous, read as DMY'; }
    const iso = validParts(y, mon, day);
    return iso ? { iso, how } : null;
  }

  // Year first, all numeric: 1990/04/23
  m = /^(\d{4})[\/.](\d{1,2})[\/.](\d{1,2})$/.exec(s);
  if (m) {
    const iso = validParts(+m[1], +m[2], +m[3]);
    return iso ? { iso, how: 'year-first' } : null;
  }

  // With a month name: 23 April 1990, April 23 1990, 23-Apr-1990, "April 23, 1990"
  const cleaned = s.replace(/,/g, ' ').replace(/[\-\/.]/g, ' ').replace(/\s+/g, ' ').trim();
  const words = cleaned.split(' ');
  if (words.length === 3) {
    const idx = words.findIndex((w) => MONTHS.indexOf(w.slice(0, 3).toLowerCase()) !== -1 && /[a-z]/i.test(w));
    if (idx !== -1) {
      const mon = MONTHS.indexOf(words[idx].slice(0, 3).toLowerCase()) + 1;
      const rest = words.filter((_, i) => i !== idx).map((w) => parseInt(w.replace(/\D/g, ''), 10));
      if (rest.every((n) => !isNaN(n))) {
        // the 4-digit one is the year, whichever side it sat on
        const y = rest.find((n) => n > 31);
        const day = rest.find((n) => n <= 31);
        if (y != null && day != null) {
          const iso = validParts(y, mon, day);
          return iso ? { iso, how: 'month name' } : null;
        }
      }
    }
  }
  return null;
}

/**
 * Find the one person this webhook is about.
 * Name first; email only as a fallback, or to break a tie between people sharing a name.
 * Returns { member, matches, by } — matches is how many candidates the name/email found,
 * so an ambiguous hit can be logged and reported rather than hidden.
 */
function findMatch(roster, name, email) {
  const list = Array.isArray(roster) ? roster : [];
  const byName = name ? list.filter((m) => norm(m.name) === norm(name)) : [];
  const byEmail = email ? list.filter((m) => m.email && norm(m.email) === norm(email)) : [];

  let pool = byName, by = 'name';
  if (pool.length > 1 && byEmail.length) {
    const both = pool.filter((m) => byEmail.indexOf(m) !== -1);
    if (both.length) { pool = both; by = 'name+email'; }
  }
  if (!pool.length && byEmail.length) { pool = byEmail; by = 'email'; }
  if (!pool.length) return { member: null, matches: 0, by: 'none' };

  let member = pool[0];
  if (pool.length > 1) {
    // Two people really do share a name. Prefer the one still missing a dob; failing that
    // the most recently added, which is the one a webhook is most likely to be about.
    const noDob = pool.filter((m) => !m.dob);
    member = noDob.length === 1 ? noDob[0] : pool[pool.length - 1];
  }
  return { member, matches: pool.length, by };
}

exports.handler = async (event) => {
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

  // 4. Parse the body — JSON or form-encoded, same as new-challenger.js
  let data = {};
  try {
    const ct = (event.headers['content-type'] || '').toLowerCase();
    if (ct.includes('application/json')) {
      data = JSON.parse(event.body || '{}');
    } else {
      data = Object.fromEntries(new URLSearchParams(event.body || ''));
    }
  } catch (e) {
    console.log('REJECT: could not parse body. Raw body=' + (event.body || '').slice(0, 300));
    return resp(400, { error: 'Could not parse body' });
  }
  console.log('PAYLOAD received: ' + JSON.stringify(data).slice(0, 400));

  // 5. Pull out the three things we care about, from the field names these tools use
  const first = data.firstname || data.first_name || data.firstName || '';
  const last  = data.lastname  || data.last_name  || data.lastName  || '';
  const name = String(data.name || `${first} ${last}`).trim();
  const email = String(data.email || data.contact_email || data.Email || '').trim();
  const rawDob = data.dob || data.DOB || data.dateofbirth || data.date_of_birth
    || data.dateOfBirth || data.birthday || data.birthdate || data.birth_date || data.born || '';

  if (!name && !email) {
    console.log('REJECT: no name or email in payload. Keys=' + Object.keys(data).join(','));
    return resp(400, { error: 'No name or email in payload', keysReceived: Object.keys(data) });
  }
  const parsed = parseDob(rawDob);
  if (!parsed) {
    console.log('REJECT: could not read a date of birth from ' + JSON.stringify(rawDob)
      + ' for name="' + name + '"');
    return resp(400, {
      error: 'Could not read a date of birth',
      received: String(rawDob).slice(0, 60),
      hint: 'Send it as YYYY-MM-DD (e.g. 1990-04-23) and it is never ambiguous.',
      keysReceived: Object.keys(data)
    });
  }
  console.log('RECEIVED: name="' + name + '" email="' + email + '" dob="' + rawDob
    + '" -> ' + parsed.iso + ' (' + parsed.how + ')');

  try {
    // 6. Read the current roster row
    const getRes = await fetch(
      `${SUPABASE_URL}/rest/v1/bodysculpt?key=eq.${ROW_KEY}&select=value`,
      { headers: authHeaders() }
    );
    if (!getRes.ok) throw new Error(`read failed: ${getRes.status}`);
    const rows = await getRes.json();
    const roster = (rows[0] && Array.isArray(rows[0].value)) ? rows[0].value : [];

    // 7. Find them. No match => change nothing, and say so.
    const hit = findMatch(roster, name, email);
    if (!hit.member) {
      console.log('NO MATCH: nobody on the roster is called "' + name + '"'
        + (email ? ' (or has email ' + email + ')' : '')
        + '. Roster has ' + roster.length + ' people. Nothing created, nothing changed.');
      return resp(200, {
        ok: true, matched: false, result: 'no_match',
        name, email: email || null, dob: parsed.iso, rosterSize: roster.length,
        note: 'No challenger with that name was found. Nothing was created or changed.'
      });
    }
    if (hit.matches > 1) {
      console.log('AMBIGUOUS: ' + hit.matches + ' challengers matched "' + name
        + '" — updating id=' + hit.member.id + '. Check this one by hand.');
    }

    // 8. Already right? Don't write — it would only fire a pointless sync to every device.
    if (hit.member.dob === parsed.iso) {
      console.log('UNCHANGED: "' + hit.member.name + '" already had dob ' + parsed.iso);
      return resp(200, {
        ok: true, matched: true, result: 'unchanged',
        name: hit.member.name, dob: parsed.iso, matchedBy: hit.by, matches: hit.matches
      });
    }

    const previous = hit.member.dob || null;
    hit.member.dob = parsed.iso;

    // 9. Write the roster back (upsert the single row)
    const putRes = await fetch(
      `${SUPABASE_URL}/rest/v1/bodysculpt?on_conflict=key`,
      {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({ key: ROW_KEY, value: roster, updated_at: new Date().toISOString() })
      }
    );
    if (!putRes.ok) throw new Error(`write failed: ${putRes.status} ${await putRes.text()}`);

    console.log('UPDATED: "' + hit.member.name + '" (id=' + hit.member.id + ', matched by '
      + hit.by + ') dob ' + JSON.stringify(previous) + ' -> ' + parsed.iso);
    return resp(200, {
      ok: true, matched: true, result: 'updated',
      name: hit.member.name, id: hit.member.id, dob: parsed.iso, previous,
      matchedBy: hit.by, matches: hit.matches
    });
  } catch (e) {
    console.log('ERROR during read/write: ' + String(e.message || e));
    return resp(500, { error: String(e.message || e) });
  }
};

function authHeaders() {
  return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
}
function resp(status, body) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

// exposed for the test suite; Netlify only ever looks at `handler`
exports.__test = { parseDob, findMatch, norm, validParts };
