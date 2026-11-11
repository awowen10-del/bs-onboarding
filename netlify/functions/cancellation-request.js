/**
 * cancellation-request.js — Netlify function
 *
 * The membership cancellation page (bodysculptwarrington.com/cancellation) posts its form here.
 * In GHL it: finds or creates the contact, tags them 'cancellation request', saves their rating
 * and comments as a note, and gives Ash a task to decide. The decision is a tag Ash (or Dan) adds:
 *   'cancel approved'      30-day notice: one more payment, then a month of training
 *   'cancel approved now'  no more payments
 *   'cancel declined'      nothing changes
 * GHL workflows on those tags send the confirmation email and add 'lapsed member' a week later.
 *
 * Env: GHL_TOKEN (and optionally GHL_LOCATION_ID, CANCEL_TASK_USER).
 */
const GHL = 'https://services.leadconnectorhq.com';
const LOCATION = process.env.GHL_LOCATION_ID || 'I88mpb966qBRVCCDbEx5';
const ASH_USER = process.env.CANCEL_TASK_USER || 'JDb3t1lKcxPLjclX2WXd';
const TAG = 'cancellation request';

const headers = () => ({
  Authorization: 'Bearer ' + (process.env.GHL_TOKEN || '').trim(),
  Version: '2021-07-28', 'Content-Type': 'application/json', Accept: 'application/json',
});
async function ghl(path, method, body) {
  const res = await fetch(GHL + path, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, max);

/* Pulls the form fields out of the request, whichever way the page sent them. */
function readForm(event) {
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');
  let f = {};
  try { f = JSON.parse(raw); } catch (e) { f = Object.fromEntries(new URLSearchParams(raw)); }
  const rating = parseInt(f.rating, 10);
  return {
    firstName: clean(f.firstName, 60),
    lastName: clean(f.lastName, 60),
    email: clean(f.email, 120).toLowerCase(),
    rating: rating >= 1 && rating <= 10 ? rating : null,
    comments: String(f.comments == null ? '' : f.comments).trim().slice(0, 2000),
    agreed: f.agreedTerms === 'yes',
    requestDate: /^\d{4}-\d{2}-\d{2}$/.test(f.requestDate || '') ? f.requestDate : new Date().toISOString().slice(0, 10),
  };
}

function taskBody(r) {
  return [
    `Cancellation request from ${r.firstName} ${r.lastName} (${r.email}), sent ${r.requestDate}.`,
    `Rating: ${r.rating ? r.rating + '/10' : 'not given'}`,
    `Comments: ${r.comments || 'none'}`,
    '',
    'Decide, then add ONE of these tags to this contact:',
    "- cancel approved: 30-day notice. One more payment goes out as normal, then they can train for a month. Cancel their subscription after that final payment.",
    '- cancel approved now: no further payments. Cancel their subscription now.',
    '- cancel declined: nothing changes. Talk to them first.',
    "Both 'approved' tags send them the confirmation email and add 'lapsed member' a week later.",
    'Then mark this task done.',
  ].join('\n');
}

async function handle(r, now) {
  const up = await ghl('/contacts/upsert', 'POST', { locationId: LOCATION, email: r.email, firstName: r.firstName, lastName: r.lastName });
  const id = (up.contact && up.contact.id) || up.id;
  if (!id) throw new Error('no contact id from upsert');
  await ghl(`/contacts/${id}/notes`, 'POST', { body: `Cancellation request (${r.requestDate}). Rating: ${r.rating ? r.rating + '/10' : 'not given'}. Comments: ${r.comments || 'none'}. Agreed to the 30-day notice and terms: yes.` });
  await ghl(`/contacts/${id}/tasks`, 'POST', {
    title: `Cancellation request: ${r.firstName} ${r.lastName}`,
    body: taskBody(r),
    dueDate: new Date(now + 24 * 3600 * 1000).toISOString(),
    completed: false,
    assignedTo: ASH_USER,
  });
  await ghl(`/contacts/${id}/tags`, 'POST', { tags: [TAG] });   // last, so the alert workflow only fires once the rest is in place
  return id;
}

exports.handler = async (event) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: 'POST only' };
  const r = readForm(event);
  if (!r.firstName || !r.lastName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email) || !r.agreed) {
    return { statusCode: 400, headers: cors, body: 'Missing details' };
  }
  try {
    const id = await handle(r, Date.now());
    console.log('CANCELLATION REQUEST', id);
    return { statusCode: 200, headers: cors, body: 'ok' };
  } catch (e) {
    console.error('CANCELLATION REQUEST FAILED', e.message);
    return { statusCode: 502, headers: cors, body: 'Could not save' };
  }
};
exports.readForm = readForm;
exports.taskBody = taskBody;
