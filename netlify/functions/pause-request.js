/**
 * pause-request.js — Netlify function
 *
 * The membership pause page (bodysculptwarrington.com/pause) posts its form here.
 * In GHL it: finds or creates the contact, tags them 'pause request', saves the length they asked
 * for as a note, and gives Ash a task. Ash moves their next payment back, then adds ONE tag:
 *   'pause 30 days' / 'pause 60 days'  GHL workflows add 'paused', and take it off when the pause ends
 *   'pause declined'                   nothing changes
 *
 * Env: GHL_TOKEN (and optionally GHL_LOCATION_ID, CANCEL_TASK_USER).
 */
const GHL = 'https://services.leadconnectorhq.com';
const LOCATION = process.env.GHL_LOCATION_ID || 'I88mpb966qBRVCCDbEx5';
const ASH_USER = process.env.CANCEL_TASK_USER || 'JDb3t1lKcxPLjclX2WXd';
const TAG = 'pause request';

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

function readForm(event) {
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');
  let f = {};
  try { f = JSON.parse(raw); } catch (e) { f = Object.fromEntries(new URLSearchParams(raw)); }
  return {
    firstName: clean(f.firstName, 60),
    lastName: clean(f.lastName, 60),
    email: clean(f.email, 120).toLowerCase(),
    days: f.pauseLength === '30' || f.pauseLength === '60' ? Number(f.pauseLength) : null,
    comments: String(f.comments == null ? '' : f.comments).trim().slice(0, 2000),
    agreed: f.agreedTerms === 'yes',
    requestDate: /^\d{4}-\d{2}-\d{2}$/.test(f.requestDate || '') ? f.requestDate : new Date().toISOString().slice(0, 10),
  };
}

function taskBody(r) {
  return [
    `Pause request from ${r.firstName} ${r.lastName} (${r.email}), sent ${r.requestDate}.`,
    `Asked for: ${r.days} days`,
    `Comments: ${r.comments || 'none'}`,
    '',
    'Check they can pause (monthly membership, no more than 60 days paused this year, at least 30 days before their next payment).',
    `If yes: move their next payment back ${r.days} days, then add ONE of these tags to this contact:`,
    "- pause 30 days or pause 60 days: adds 'paused', and takes it off again when the pause ends.",
    '- pause declined: nothing changes. Let them know why.',
    'Then mark this task done.',
  ].join('\n');
}

async function handle(r, now) {
  const up = await ghl('/contacts/upsert', 'POST', { locationId: LOCATION, email: r.email, firstName: r.firstName, lastName: r.lastName });
  const id = (up.contact && up.contact.id) || up.id;
  if (!id) throw new Error('no contact id from upsert');
  await ghl(`/contacts/${id}/notes`, 'POST', { body: `Pause request (${r.requestDate}): ${r.days} days. Comments: ${r.comments || 'none'}. Agreed they can't cancel during a pause: yes.` });
  await ghl(`/contacts/${id}/tasks`, 'POST', {
    title: `Pause request (${r.days} days): ${r.firstName} ${r.lastName}`,
    body: taskBody(r),
    dueDate: new Date(now + 24 * 3600 * 1000).toISOString(),
    completed: false,
    assignedTo: ASH_USER,
  });
  await ghl(`/contacts/${id}/tags`, 'POST', { tags: [TAG] });
  return id;
}

exports.handler = async (event) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: 'POST only' };
  const r = readForm(event);
  if (!r.firstName || !r.lastName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email) || !r.days || !r.agreed) {
    return { statusCode: 400, headers: cors, body: 'Missing details' };
  }
  try {
    const id = await handle(r, Date.now());
    console.log('PAUSE REQUEST', id);
    return { statusCode: 200, headers: cors, body: 'ok' };
  } catch (e) {
    console.error('PAUSE REQUEST FAILED', e.message);
    return { statusCode: 502, headers: cors, body: 'Could not save' };
  }
};
exports.readForm = readForm;
exports.taskBody = taskBody;
