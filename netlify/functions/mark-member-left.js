/**
 * mark-member-left.js — Netlify serverless function
 *
 * Marks an EXISTING member as having left, from an incoming webhook (Ontraport via Zapier,
 * fired by the cancelled-member tag). It is the one thing that sets `left` on a member
 * record — the flag the app already reads in hasLeft(), which keeps a member who has gone
 * off the retention Today's moves, out of its counts, and out of the routine birthday list
 * while leaving them on the Birthdays tab under Left, where sending a card is a decision
 * rather than a task.
 *
 * It has exactly one job and does exactly one thing. It never creates anybody, never touches
 * the challenger roster, and never writes any field other than `left`. If nobody matches, it
 * says so and changes nothing.
 *
 * Matching: by EMAIL — trimmed, case-insensitive — with a name as a fallback only when no
 * email was sent, and never as a tiebreak against one. Email is the reliable key: two members
 * called Sarah Jones is an ordinary thing for a gym to have, and cancelling the wrong one is
 * not a mistake anybody would notice quickly.
 *
 * A NO-MATCH IS A 200. Zapier auto-pauses a Zap that keeps erroring, and an ex-member who was
 * never on the tracker is not an error — it is the ordinary case of somebody who cancelled
 * before this build existed. It is logged loudly and reported as `no_match` so the run is
 * findable in the Zap history without the Zap turning itself off.
 *
 * ENVIRONMENT VARIABLES (Netlify → Site settings → Environment variables):
 *   SUPABASE_URL          your project URL (https://xxxx.supabase.co)
 *   SUPABASE_SERVICE_KEY  the Supabase SECRET key (server-only, never in the browser)
 *   WEBHOOK_SECRET        the same shared secret new-challenger.js and set-dob.js use
 *
 * Zapier posts to:
 *   https://<your-site>.netlify.app/.netlify/functions/mark-member-left?secret=WEBHOOK_SECRET
 * with a JSON or form body containing an email (and, optionally, a name).
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

/* The MEMBER list, not the roster. set-dob.js and new-challenger.js work on 'roster'; this
   one only ever reads and writes 'retention', which is why it cannot touch a challenger. */
const ROW_KEY = 'retention';

/* The same normalisation set-dob.js uses, so "  Sarah@Example.COM " and "sarah@example.com"
   are one address, and "  Sarah   Doyle " and "sarah doyle" are one person. */
function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Find the one member this webhook is about.
 *
 * Email first and email hardest. A name is accepted only when no email arrived at all, and
 * an ambiguous name — two members who share one — matches NOBODY rather than guessing: the
 * cost of guessing here is cancelling a member who is still paying us, and nothing about the
 * payload can tell the two apart. set-dob.js does guess in that spot, and it is right to,
 * because the worst it can do is put a date of birth on the wrong Sarah.
 *
 * Returns { member, matches, by } so an ambiguous hit can be logged and reported.
 */
function findMember(roster, email, name) {
  const list = Array.isArray(roster) ? roster : [];
  const e = norm(email);
  if (e) {
    const byEmail = list.filter((m) => m && m.email && norm(m.email) === e);
    if (byEmail.length) return { member: byEmail[0], matches: byEmail.length, by: 'email' };
    return { member: null, matches: 0, by: 'none' };
  }
  const n = norm(name);
  if (!n) return { member: null, matches: 0, by: 'none' };
  const byName = list.filter((m) => m && norm(m.name) === n);
  if (byName.length === 1) return { member: byName[0], matches: 1, by: 'name' };
  return { member: null, matches: byName.length, by: byName.length ? 'ambiguous-name' : 'none' };
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

  // 4. Parse the body — JSON or form-encoded, same as the other two functions
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

  // 5. The two things we care about, from the field names these tools use
  const email = String(data.email || data.contact_email || data.Email || '').trim();
  const first = data.firstname || data.first_name || data.firstName || '';
  const last  = data.lastname  || data.last_name  || data.lastName  || '';
  const name = String(data.name || `${first} ${last}`).trim();

  if (!email && !name) {
    console.log('REJECT: no email or name in payload. Keys=' + Object.keys(data).join(','));
    return resp(400, { error: 'No email or name in payload', keysReceived: Object.keys(data) });
  }
  console.log('RECEIVED: cancellation for email="' + email + '" name="' + name + '"');

  try {
    // 6. Read the current MEMBER list
    const getRes = await fetch(
      `${SUPABASE_URL}/rest/v1/bodysculpt?key=eq.${ROW_KEY}&select=value`,
      { headers: authHeaders() }
    );
    if (!getRes.ok) throw new Error(`read failed: ${getRes.status}`);
    const rows = await getRes.json();
    const roster = (rows[0] && Array.isArray(rows[0].value)) ? rows[0].value : [];

    // 7. Find them. No match => change nothing, create nothing, and say so calmly.
    const hit = findMember(roster, email, name);
    if (!hit.member) {
      const why = hit.by === 'ambiguous-name'
        ? hit.matches + ' members share the name "' + name + '" and no email was sent, so '
          + 'there is no way to tell which one cancelled'
        : 'nobody on the member list has that email' + (name ? ' or name' : '');
      console.log('NO MATCH: ' + why + '. Member list has ' + roster.length
        + ' people. Nothing created, nothing changed.');
      return resp(200, {
        ok: true, matched: false, result: 'no_match',
        email: email || null, name: name || null, memberCount: roster.length,
        reason: hit.by === 'ambiguous-name' ? 'ambiguous_name' : 'not_found',
        note: 'No member matched. Nothing was created or changed. If they cancelled before '
          + 'they were ever on the tracker, this is the expected outcome.'
      });
    }
    if (hit.matches > 1) {
      console.log('AMBIGUOUS: ' + hit.matches + ' members share the email "' + email
        + '" — marking id=' + hit.member.id + '. Check this one by hand.');
    }

    // 8. Already left? Don't write. Marking somebody left twice is a no-op success, not an
    //    error and not a pointless sync to every open device.
    if (hit.member.left === true) {
      console.log('UNCHANGED: "' + hit.member.name + '" (id=' + hit.member.id
        + ') was already marked left');
      return resp(200, {
        ok: true, matched: true, result: 'unchanged',
        name: hit.member.name, id: hit.member.id, left: true, matchedBy: hit.by
      });
    }

    /* 9. The only write this function makes, and the only field it touches. Everything else
          on the record — their name, their coach, their notes, their date of birth, their
          journey, their attendance — is left exactly as it was, because a membership ending
          is not a reason to lose any of it. */
    hit.member.left = true;

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
      + hit.by + ') marked left. They keep their record and their birthday; they stop '
      + 'raising work.');
    return resp(200, {
      ok: true, matched: true, result: 'updated',
      name: hit.member.name, id: hit.member.id, left: true,
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
exports.__test = { findMember, norm };
