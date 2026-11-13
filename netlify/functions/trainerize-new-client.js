/**
 * trainerize-new-client.js — Netlify serverless function
 *
 * Receives a webhook from GHL when someone pays (the "6WC - Paid" workflow), and in Trainerize:
 *   1. adds them as a client (or finds them, if their email is already there),
 *   2. assigns them to the coach "Bodysculpt Support",
 *   3. adds them to the group "Important Announcements",
 *   4. adds them to the current training block (block-program.json) from the block's first Sunday,
 *      so they land on the same week as everyone else. Skipped if they're already on it or the block has ended.
 * Each step is safe to repeat, so a second webhook for the same person changes nothing.
 *
 * Send dry_run: true to check the token and look the person up, changing nothing.
 *
 * ENVIRONMENT VARIABLES (Netlify → Site settings → Environment variables):
 *   TRAINERIZE_GROUP_ID    the Group ID Trainerize sends with the API token
 *   TRAINERIZE_API_ACCESS  the API token (TRAINERIZE_API_TOKEN also works)
 *   WEBHOOK_SECRET         the same secret new-challenger.js uses
 *   TRAINERIZE_TRAINER_ID  optional: skip the lookup of "Bodysculpt Support" by name
 *   TRAINERIZE_USERGROUP_ID optional: skip the lookup of "Important Announcements" by name
 *
 * GHL posts to:
 *   https://bodysculpt-onboarding.netlify.app/.netlify/functions/trainerize-new-client?secret=WEBHOOK_SECRET
 */

const API = 'https://api.trainerize.com/v03';
const TZ_GROUP_ID = process.env.TRAINERIZE_GROUP_ID;
const TZ_TOKEN = process.env.TRAINERIZE_API_TOKEN || process.env.TRAINERIZE_API_ACCESS;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const COACH_NAME = 'Bodysculpt Support';
const USERGROUP_NAME = 'Important Announcements';
const BLOCK = require('./block-program.json');

exports.handler = async (event) => {
  // 1. Only accept POST
  if (event.httpMethod !== 'POST') {
    return resp(405, { error: 'Method not allowed' });
  }

  // 2. Check the shared secret (query string ?secret=... or x-webhook-secret header)
  const provided = (event.queryStringParameters && event.queryStringParameters.secret)
    || event.headers['x-webhook-secret'];
  if (!WEBHOOK_SECRET || provided !== WEBHOOK_SECRET) {
    console.log('REJECT: secret missing or mismatched');
    return resp(401, { error: 'Unauthorized' });
  }

  // 3. Make sure Trainerize is configured (the token comes from Trainerize support)
  if (!TZ_GROUP_ID || !TZ_TOKEN) {
    console.log('REJECT: TRAINERIZE_GROUP_ID / TRAINERIZE_API_TOKEN not set yet');
    return resp(503, {
      error: 'Trainerize API not configured yet',
      missing: [!TZ_GROUP_ID && 'TRAINERIZE_GROUP_ID', !TZ_TOKEN && 'TRAINERIZE_API_TOKEN'].filter(Boolean),
    });
  }

  // 4. Parse the payload. GHL's webhook sends JSON with first_name / last_name / email.
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
    const trainerID = await findTrainerID();
    const userGroupID = await findUserGroupID();

    // 5. Find or add the client
    let userID = await findClientByEmail(email);
    if (dryRun) return resp(200, { ok: true, dryRun: true, trainerID, userGroupID, existingClient: userID || null, block: await blockCheck(userID) });
    let created = false;
    if (!userID) {
      const added = await tz('/user/add', {
        user: { firstName, lastName, email, type: 'client' },
        trainerID,
        sendMail: true,   // Trainerize's own invite email, so they can log in to the app
      });
      userID = added.userID;
      created = true;
      if (!userID) throw new Error('user/add returned no userID: ' + JSON.stringify(added).slice(0, 300));
    }

    // 6. Coach and group. Both are fine to repeat for someone already set up.
    await tz('/user/switchTrainer', { userID, trainerID });
    await tz('/userGroup/addUser', { id: userGroupID, userID });

    // 7. Current training block. Never fails the whole set-up: the weekly check catches anyone missed.
    let block;
    try { block = await addToBlock(userID); } catch (e) { block = 'error: ' + e.message; }

    console.log(`DONE: ${email} userID=${userID} created=${created} block=${block}`);
    return resp(200, { ok: true, userID, created, block });
  } catch (e) {
    console.log('ERROR: ' + e.message);
    return resp(502, { error: e.message });
  }
};

// What would happen with the block, without changing anything (used by dry runs).
async function blockCheck(userID) {
  if (!BLOCK.programID) return 'no block set';
  if (new Date().toISOString().slice(0, 10) > BLOCK.endDate) return `block ${BLOCK.name} ended ${BLOCK.endDate}, would skip`;
  if (!userID) return `new client, would add to ${BLOCK.name} from ${BLOCK.startDate}`;
  const r = await tz('/program/getUserProgramList', { userID });
  return (r.programs || []).some(p => p.id === BLOCK.programID) ? `already on ${BLOCK.name}` : `would add to ${BLOCK.name} from ${BLOCK.startDate}`;
}

async function addToBlock(userID) {
  if (!BLOCK.programID) return 'no block set';
  if (new Date().toISOString().slice(0, 10) > BLOCK.endDate) return `block ended ${BLOCK.endDate}, skipped`;
  const r = await tz('/program/getUserProgramList', { userID });
  if ((r.programs || []).some(p => p.id === BLOCK.programID)) return 'already on block';
  // The program's field is "id"; "programID" returns a misleading 403.
  const a = await tz('/program/addUser', { id: BLOCK.programID, userID, startDate: BLOCK.startDate, subscribeType: 'addon' });
  return `added from ${BLOCK.startDate}: ${a.message || JSON.stringify(a).slice(0, 80)}`;
}

async function findClientByEmail(email) {
  const r = await tz('/user/find', { searchTerm: email, view: 'allClient', start: 0, count: 10 });
  const match = (r.users || []).find(u => String(u.email || '').toLowerCase() === email);
  return match ? (match.id || match.userID) : null;
}

async function findTrainerID() {
  if (process.env.TRAINERIZE_TRAINER_ID) return Number(process.env.TRAINERIZE_TRAINER_ID);
  const r = await tz('/user/getTrainerList', { view: 'all', start: 0, count: 100 });
  const t = (r.users || []).find(t => `${t.firstName} ${t.lastName}`.trim() === COACH_NAME);
  if (!t) throw new Error(`Coach "${COACH_NAME}" not found in Trainerize`);
  return t.id;
}

async function findUserGroupID() {
  if (process.env.TRAINERIZE_USERGROUP_ID) return Number(process.env.TRAINERIZE_USERGROUP_ID);
  const r = await tz('/userGroup/getList', { view: 'all', start: 0, count: 200 });
  const g = (r.userGroups || []).find(g => String(g.name).trim() === USERGROUP_NAME);
  if (!g) throw new Error(`Group "${USERGROUP_NAME}" not found in Trainerize`);
  return g.id;
}

async function tz(path, body) {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Basic ' + Buffer.from(`${TZ_GROUP_ID}:${TZ_TOKEN}`).toString('base64'),
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

function resp(status, body) {
  return { statusCode: status, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
