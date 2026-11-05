/**
 * teamup-new-client.js — Netlify serverless function
 *
 * Receives a webhook from GHL when someone pays (the "6WC - Paid" workflow), and makes sure
 * they have a TeamUp customer profile. TeamUp emails them an invitation to claim it, which is
 * how they get a login to book sessions.
 *
 * IT NEVER ADDS A MEMBERSHIP. Coaches add the £0 6 Week Challenge membership at the Intro,
 * because when it starts depends on the Intro. Ash's decision, 5 Nov 2026.
 *
 * Safe to repeat: someone already on TeamUp with this email is left alone, so a second webhook
 * (or a returning customer) gets no second profile and no second invitation.
 *
 * Send dry_run: true to look the person up and report what would happen, changing nothing.
 *
 * ENVIRONMENT VARIABLES (Netlify → Site settings → Environment variables):
 *   TEAMUP_TOKEN    the M2M token from TeamUp → Settings → Integrations → API Integration
 *   WEBHOOK_SECRET  the same secret new-challenger.js uses
 *
 * GHL posts to:
 *   https://bodysculpt-onboarding.netlify.app/.netlify/functions/teamup-new-client?secret=WEBHOOK_SECRET
 */

const API = 'https://goteamup.com/api/v2';
const TOKEN = (process.env.TEAMUP_TOKEN || '').trim();
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return resp(405, { error: 'Method not allowed' });

  const provided = (event.queryStringParameters && event.queryStringParameters.secret)
    || event.headers['x-webhook-secret'];
  if (!WEBHOOK_SECRET || provided !== WEBHOOK_SECRET) {
    console.log('REJECT: secret missing or mismatched');
    return resp(401, { error: 'Unauthorized' });
  }

  if (!TOKEN) {
    console.log('REJECT: TEAMUP_TOKEN not set');
    return resp(503, { error: 'TeamUp API not configured yet' });
  }

  let data = {};
  try {
    const ct = (event.headers['content-type'] || '').toLowerCase();
    data = ct.includes('application/json')
      ? JSON.parse(event.body || '{}')
      : Object.fromEntries(new URLSearchParams(event.body || ''));
  } catch (e) {
    return resp(400, { error: 'Could not parse body' });
  }

  const firstName = String(data.first_name || data.firstName || data.firstname || '').trim();
  const lastName  = String(data.last_name  || data.lastName  || data.lastname  || '').trim();
  const email = String(data.email || data.Email || '').trim().toLowerCase();
  const dryRun = data.dry_run === true || data.dry_run === 'true';
  if (!email || !firstName) {
    console.log('REJECT: need email and first name. Keys=' + Object.keys(data).join(','));
    return resp(400, { error: 'Need email and first name', keysReceived: Object.keys(data) });
  }

  try {
    const existing = await findCustomerByEmail(email);
    if (existing) {
      console.log(`SKIP: ${email} already on TeamUp as ${existing.id}`);
      return resp(200, { ok: true, skipped: 'already_on_teamup', customerID: existing.id });
    }
    if (dryRun) return resp(200, { ok: true, dryRun: true, wouldCreate: true });

    // TeamUp insists on a last name, and a GHL contact doesn't always have one.
    const created = await tu('/customers', {
      method: 'POST',
      body: { first_name: firstName, last_name: lastName || '-', email },
    });
    console.log(`DONE: ${email} customerID=${created.id}`);
    return resp(200, { ok: true, created: true, customerID: created.id });
  } catch (e) {
    console.log('ERROR: ' + e.message);
    return resp(502, { error: e.message });
  }
};

/* `query` is a free-text match on name and email, so the exact match is ours to make: a search
   for jo@x.com can also return joanna@x.com. */
async function findCustomerByEmail(email) {
  const r = await tu('/customers?query=' + encodeURIComponent(email) + '&page_size=100');
  return (r.results || []).find(c => String(c.email || '').trim().toLowerCase() === email) || null;
}

/* TeamUp's M2M guide says "Token <token>" and its API reference says "Bearer <token>", so a
   refusal on one gets a single try with the other. */
async function tu(path, opts = {}) {
  let res = await call(path, opts, 'Bearer');
  if (res.status === 401) res = await call(path, opts, 'Token');
  const text = await res.text();
  if (!res.ok) throw new Error(`${opts.method || 'GET'} ${path.split('?')[0]} ${res.status}: ${text.slice(0, 300)} (token length ${TOKEN.length})`);
  return text ? JSON.parse(text) : {};
}

function call(path, opts, prefix) {
  return fetch(API + path, {
    method: opts.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      Authorization: prefix + ' ' + TOKEN,
      'TeamUp-Request-Mode': 'provider',
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
}

function resp(status, body) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
