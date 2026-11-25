/**
 * trainerize-message.js — Netlify serverless function
 *
 * Sends one Trainerize message, from the Bodysculpt Support account, to the client whose
 * email GHL sends. Built for GHL workflows (first use: the members automation on 'member start'),
 * so the wording lives in the GHL workflow, where Ash can edit it, not here.
 *
 * GHL Custom Webhook, POST, JSON body:
 *   { "email": "{{contact.email}}", "contact_id": "{{contact.id}}", "message": "Hi {{contact.first_name}} ..." }
 *   header x-webhook-secret: WEBHOOK_SECRET   (or ?secret=WEBHOOK_SECRET on the URL)
 * Send "dry_run": true to look the person up and send nothing.
 *
 * Not on Trainerize (or a different email there) is not an error: it answers 200 sent:false and,
 * when contact_id is given, leaves a note on the GHL contact so the team can send it by hand.
 *
 * ENVIRONMENT VARIABLES: TRAINERIZE_GROUP_ID, TRAINERIZE_API_ACCESS (or TRAINERIZE_API_TOKEN),
 * WEBHOOK_SECRET, GHL_TOKEN (for the note).
 */

const TZ_API = 'https://api.trainerize.com/v03';
const GHL = 'https://services.leadconnectorhq.com';
const SENDER_TZ = 2920561; // Bodysculpt Support, so every coach sees the replies

const resp = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();

function tzHeaders() {
  const token = process.env.TRAINERIZE_API_TOKEN || process.env.TRAINERIZE_API_ACCESS;
  return { 'Content-Type': 'application/json',
    Authorization: 'Basic ' + Buffer.from(`${process.env.TRAINERIZE_GROUP_ID}:${token}`).toString('base64') };
}
async function tz(path, body) {
  const r = await fetch(TZ_API + path, { method: 'POST', headers: tzHeaders(), body: JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) throw new Error(`Trainerize ${path} ${r.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}
async function ghlNote(contactId, body) {
  if (!contactId || !process.env.GHL_TOKEN) return;
  await fetch(`${GHL}/contacts/${contactId}/notes`, { method: 'POST', body: JSON.stringify({ body }),
    headers: { Authorization: 'Bearer ' + process.env.GHL_TOKEN.trim(), Version: '2021-07-28', 'Content-Type': 'application/json' } })
    .catch(() => {});
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return resp(405, { error: 'Method not allowed' });
  const headers = event.headers || {};
  const provided = (event.queryStringParameters && event.queryStringParameters.secret) || headers['x-webhook-secret'];
  if (!process.env.WEBHOOK_SECRET || provided !== process.env.WEBHOOK_SECRET) return resp(401, { error: 'Unauthorized' });

  let data;
  try {
    const ct = norm(headers['content-type']);
    data = ct.includes('application/json') || !ct ? JSON.parse(event.body || '{}') : Object.fromEntries(new URLSearchParams(event.body || ''));
  } catch (e) { return resp(400, { error: 'Could not parse body' }); }

  const email = norm(data.email);
  const message = String(data.message || '').replace(/\r\n/g, '\n').trim();
  const contactId = String(data.contact_id || data.contactId || '').trim();
  const dryRun = data.dry_run === true || data.dry_run === 'true';
  if (!email || !message) return resp(400, { error: 'Need email and message', keysReceived: Object.keys(data) });

  try {
    const found = await tz('/user/find', { searchTerm: email, view: 'allClient', start: 0, count: 10 });
    const u = (found.users || []).find((x) => norm(x.email) === email);
    if (!u) {
      if (!dryRun) await ghlNote(contactId, `Trainerize message NOT sent: no Trainerize client with ${email}. Send it by hand:\n\n${message}`);
      return resp(200, { ok: true, sent: false, reason: 'not on Trainerize' });
    }
    if (dryRun) return resp(200, { ok: true, dryRun: true, userID: u.id });
    const r = await tz('/message/send', { userID: SENDER_TZ, recipients: [u.id], body: message,
      threadType: 'mainThread', type: 'text', subject: 'Main', conversationType: 'single' });
    if (!(r.threadIDs && r.threadIDs[0])) throw new Error('not sent: ' + JSON.stringify(r).slice(0, 200));
    return resp(200, { ok: true, sent: true, userID: u.id });
  } catch (e) {
    console.error(e.message);
    return resp(502, { error: e.message });
  }
};
