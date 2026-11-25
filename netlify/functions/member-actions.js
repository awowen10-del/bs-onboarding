/**
 * member-actions.js — Netlify function
 *
 * Does what a coach asked for on a member's profile in the tracker: mark as left, pause (30 or
 * 60 days), or resume early. The tracker writes the request into the 'member-actions' row and
 * then calls this; this only ever acts on requests in that row, for people on the members list
 * the morning sync wrote. Nothing here moves money: payments are checked and put in a GHL task
 * for Ash.
 *
 *   LEFT    GHL: add 'cancelled member' (the "Membership - Cancelled" workflow then takes 'member'
 *           off and stops the member journey). TeamUp: ends their £0 membership today, so they can't
 *           book. Trainerize: switched off.
 *   PAUSE   GHL: add 'pause 30 days' / 'pause 60 days' (the existing pause workflow adds 'paused',
 *           waits, takes it off). TeamUp: a hold on their £0 membership for the same dates.
 *   RESUME  GHL: out of both pause workflows, 'paused' and the pause tags off. TeamUp: hold ended today.
 *
 *   A TeamUp membership with a price (7 on 25 Nov 2026: Founders £69, Joint £124.50, £99) is billed
 *   by TeamUp, so it is never changed here: the task says so and Ash does it.
 *
 * ENV: GHL_TOKEN, GHL_LOCATION_ID, TEAMUP_TOKEN, TRAINERIZE_GROUP_ID, TRAINERIZE_API_ACCESS,
 *      SUPABASE_URL, SUPABASE_SERVICE_KEY, CANCEL_TASK_USER (Ash)
 */
const GHL = 'https://services.leadconnectorhq.com';
const LOCATION = process.env.GHL_LOCATION_ID || 'I88mpb966qBRVCCDbEx5';
const ASH_USER = process.env.CANCEL_TASK_USER || 'JDb3t1lKcxPLjclX2WXd';
const TU = 'https://goteamup.com/api/v2';
const TU_PROVIDER = process.env.TEAMUP_PROVIDER_ID || '1653275';
const TZ_API = 'https://api.trainerize.com/v03';
const ROW = 'member-actions';
const PAUSE_WORKFLOWS = ['96a71c4c-0ad1-4d7d-9634-f6916f3e7b49', '0f7a182f-a281-4d85-941e-6d606acc5dee'];
const DAY = 86400000;
const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
const uk = (d) => d.split('-').reverse().join('/');

async function json(url, opts) {
  const res = await fetch(url, opts); const text = await res.text();
  if (!res.ok) { const e = new Error(`${url.split('?')[0].replace(/^https:\/\/[^/]+/, '')} ${res.status}: ${text.slice(0, 160)}`); e.status = res.status; throw e; }
  return text ? JSON.parse(text) : {};
}
const ghlH = () => ({ Authorization: 'Bearer ' + (process.env.GHL_TOKEN || '').trim(), Version: '2021-07-28', 'Content-Type': 'application/json', Accept: 'application/json' });
const ghl = (path, method = 'GET', body) => json(GHL + path, { method, headers: ghlH(), body: body ? JSON.stringify(body) : undefined });
let tuPrefix = 'Bearer';
async function tu(path, method = 'GET', body) {
  for (let i = 0; i < 2; i++) {
    try {
      return await json(TU + '/' + path, { method, body: body ? JSON.stringify(body) : undefined, headers: {
        Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `${tuPrefix} ${(process.env.TEAMUP_TOKEN || '').trim()}`,
        'Teamup-Provider-ID': TU_PROVIDER, 'Teamup-Request-Mode': 'provider' } });
    } catch (e) { if (e.status === 401 && tuPrefix === 'Bearer') { tuPrefix = 'Token'; continue; } throw e; }
  }
}
const tzH = () => ({ 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from(`${process.env.TRAINERIZE_GROUP_ID}:${process.env.TRAINERIZE_API_TOKEN || process.env.TRAINERIZE_API_ACCESS}`).toString('base64') });
async function sb(key, value) {
  const k = process.env.SUPABASE_SERVICE_KEY, base = `${process.env.SUPABASE_URL}/rest/v1/bodysculpt`;
  if (value === undefined) {
    const rows = await json(`${base}?key=eq.${key}&select=value`, { headers: { apikey: k, Authorization: 'Bearer ' + k } });
    return rows[0] && rows[0].value;
  }
  await json(base, { method: 'POST', headers: { apikey: k, Authorization: 'Bearer ' + k, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }) });
}

/* Their live TeamUp memberships, split into the ones we may touch (£0) and the ones TeamUp bills. */
async function teamupMemberships(tid) {
  if (!tid) return { free: [], billed: [] };
  const r = await tu(`customer_memberships?customer=${tid}&status=active,hold&membership_type=recurring&expand=membership&fields=id,status,billed_price,active_hold,membership.name`);
  const all = r.results || [];
  return { free: all.filter((m) => !(m.billed_price && m.billed_price.decimal > 0)), billed: all.filter((m) => m.billed_price && m.billed_price.decimal > 0) };
}
/* Where their money comes from, as far as GHL can see. */
async function paymentLines(contactId) {
  const r = await ghl(`/payments/subscriptions?altId=${LOCATION}&altType=location&contactId=${contactId}`).catch(() => ({}));
  const live = (r.data || []).filter((x) => ['active', 'trialing', 'past_due', 'scheduled'].includes(norm(x.status)));
  if (!live.length) return ['No GHL subscription. If they still pay, it is through Ontraport/Stripe: check there.'];
  return live.map((x) => `GHL subscription: ${(x.recurringProduct && x.recurringProduct.product && x.recurringProduct.product.name) || x.entitySourceName} £${x.amount} (${x.status}). Payments > Subscriptions.`);
}

/* Pure: what each request means, for the task and the tracker. */
function describe(a) {
  if (a.type === 'left') return { title: `Left: ${a.name}`, tag: 'cancelled member' };
  if (a.type === 'pause') return { title: `Paused ${a.days} days: ${a.name}`, tag: `pause ${a.days} days` };
  if (a.type === 'resume') return { title: `Back from pause: ${a.name}` };
  return null;
}
/* Safety: only fresh requests, and a daily cap, so a slip (or someone who shouldn't) can't run
   through the whole list. Every action also lands as a task on Ash. */
const DAILY_CAP = { left: 5, pause: 10, resume: 10 };
function validRequest(a, members, items, now = Date.now()) {
  if (!a || !['left', 'pause', 'resume'].includes(a.type)) return 'unknown action';
  if (!a.at || now - Date.parse(a.at) > 15 * 60000) return 'request too old, please try again';
  const today = ymd(now);
  const doneToday = (items || []).filter((x) => x.type === a.type && x.status === 'done' && (x.doneAt || '').slice(0, 10) === today).length;
  if (doneToday >= DAILY_CAP[a.type]) return `daily limit reached (${DAILY_CAP[a.type]} a day): ask Ash`;
  if (a.type === 'pause' && ![30, 60].includes(+a.days)) return 'pause must be 30 or 60 days';
  if (!members.some((m) => m.id === a.ghlId)) return 'not on the members list';
  return null;
}

async function doOne(a, member) {
  const lines = [], today = Date.now();
  const d = describe(a);
  const contact = (await ghl(`/contacts/${a.ghlId}`)).contact || {};
  const { free, billed } = await teamupMemberships(member.tid);

  if (a.type === 'left') {
    await ghl(`/contacts/${a.ghlId}/tags`, 'POST', { tags: [d.tag] });
    lines.push("GHL: 'cancelled member' added, so 'member' comes off and the member journey stops.");
    for (const m of free) { await tu(`customer_memberships/${m.id}/cancel`, 'POST', { forced_expiration_date: ymd(today) }); }
    if (free.length) lines.push(`TeamUp: ${free.map((m) => m.membership.name).join(', ')} ended today, so they can't book.`);
    if (contact.email) {
      const f = await json(TZ_API + '/user/find', { method: 'POST', headers: tzH(), body: JSON.stringify({ searchTerm: contact.email, view: 'allClient', start: 0, count: 10 }) }).catch(() => ({}));
      const u = (f.users || []).find((x) => norm(x.email) === norm(contact.email));
      if (u) { await json(TZ_API + '/user/setStatus', { method: 'POST', headers: tzH(), body: JSON.stringify({ userID: u.id, accountStatus: 'deactivated' }) }); lines.push('Trainerize: switched off.'); }
      else lines.push('Trainerize: not found with their GHL email, nothing switched off.');
    }
  } else if (a.type === 'pause') {
    const end = ymd(today + a.days * DAY);
    await ghl(`/contacts/${a.ghlId}/tags`, 'POST', { tags: [d.tag] });
    lines.push(`GHL: '${d.tag}' added, so the pause workflow runs as usual (back on ${uk(end)}).`);
    if (free.length) {
      await tu('customer_memberships/bulk_create_holds', 'PUT', { customermembership_ids: free.map((m) => m.id), hold_type: 'finite', start_date: ymd(today), end_date: end, disable_prorates: true, extend_expirations: false });
      lines.push(`TeamUp: on hold until ${uk(end)}.`);
    }
    a.until = end;
  } else if (a.type === 'resume') {
    for (const wf of PAUSE_WORKFLOWS) await ghl(`/contacts/${a.ghlId}/workflow/${wf}`, 'DELETE').catch(() => {});
    await ghl(`/contacts/${a.ghlId}/tags`, 'DELETE', { tags: ['paused', 'pause 30 days', 'pause 60 days'] });
    lines.push("GHL: taken out of the pause workflow, 'paused' off.");
    const held = free.filter((m) => m.active_hold || m.status === 'hold');
    if (held.length) { await tu('customer_memberships/bulk_edit_holds', 'PUT', { customermembership_ids: held.map((m) => m.id), end_immediately: true }); lines.push('TeamUp: hold ended today.'); }
  }
  if (billed.length) lines.push(`TeamUp bills them directly (${billed.map((m) => `${m.membership.name} ${m.billed_price.string}`).join(', ')}), so that was NOT changed: do it in TeamUp.`);
  const money = await paymentLines(a.ghlId);
  const ask = a.type === 'left' ? 'Stop any payment that is still running.' : a.type === 'pause' ? `Move their next payment on by ${a.days} days.` : 'Move their next payment back if it was moved for the pause.';
  const body = [`Done from the tracker by ${a.by || 'a coach'} on ${uk(ymd(today))}.`, ...lines, '', 'PAYMENT: ' + ask, ...money].join('\n');
  await ghl(`/contacts/${a.ghlId}/tasks`, 'POST', { title: `${d.title} – check payment`, body, dueDate: new Date(today + DAY).toISOString(), completed: false, assignedTo: ASH_USER });
  await ghl(`/contacts/${a.ghlId}/notes`, 'POST', { body: `${d.title} (tracker, ${a.by || 'coach'}).\n${lines.join('\n')}` }).catch(() => {});
  return lines;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'POST only' };
  const row = (await sb(ROW)) || { items: [] };
  const members = ((await sb('attendance-teamup')) || {}).members || [];
  const queued = (row.items || []).filter((a) => a.status === 'queued').slice(0, 10);
  for (const a of queued) {
    const bad = validRequest(a, members, row.items);
    if (bad) { a.status = 'failed'; a.result = [bad]; continue; }
    try { a.result = await doOne(a, members.find((m) => m.id === a.ghlId)); a.status = 'done'; }
    catch (e) { a.status = 'failed'; a.result = ['Something went wrong: ' + e.message]; }
    a.doneAt = new Date().toISOString();
  }
  if (queued.length) {
    // re-read and merge, so a request added while we worked is kept
    const now = (await sb(ROW)) || { items: [] };
    const byId = Object.fromEntries(queued.map((a) => [a.id, a]));
    now.items = (now.items || []).map((a) => byId[a.id] || a).slice(-500);
    await sb(ROW, now);
  }
  return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ processed: queued.map(({ id, status, result, until }) => ({ id, status, result, until })) }) };
};
exports.describe = describe;
exports.validRequest = validRequest;
