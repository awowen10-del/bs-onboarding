/**
 * catchup.js — Netlify function behind the monthly catch-up booking page (/catch-up).
 *
 * Members get a monthly email with a link to /catch-up?c=<GHL contact id>. They pick:
 *   - In the gym with Dan, or on Zoom with Ash
 *   - a day and a time from the fixed slots below
 *
 * GET  ?c=<contactId>      -> { first, slots:[{date,time,dan,ash}] }  (free or not, never anyone's name)
 * POST {c|name+email, who, date, time, note}
 *      -> checks the slot is real, in the next 3 weeks, not blocked and not taken
 *      -> adds it to the tracker's Supabase row 'catchup-bookings'
 *      -> GHL: contact note, a task for Ash on Zoom ones (send the link), and a confirmation email
 *
 * Coaches block slots in the tracker's Catch-ups tab (row 'catchup-blocks'). This function only reads it.
 *
 * Env: GHL_TOKEN, GHL_LOCATION_ID, SUPABASE_URL, SUPABASE_SERVICE_KEY, CANCEL_TASK_USER (Ash)
 */
const GHL = 'https://services.leadconnectorhq.com';
const LOCATION = process.env.GHL_LOCATION_ID || 'I88mpb966qBRVCCDbEx5';
const ASH_USER = process.env.CANCEL_TASK_USER || 'JDb3t1lKcxPLjclX2WXd';
const BOOK_KEY = 'catchup-bookings';
const BLOCK_KEY = 'catchup-blocks';
const TZ = 'Europe/London';
const DAYS_AHEAD = 21;

/* The fixed slots. 1 = Monday ... 5 = Friday. Hours are 24h, Warrington time.
   Keep in step with CU_SLOTS in index.html (a test checks they match). */
const SLOTS = { 1: [16, 17, 18, 19, 20], 3: [16, 17, 18, 19, 20], 5: [6, 7, 8, 9, 10] };
const WHO = {
  dan: { coach: 'Dan', where: 'in the gym', label: 'In the gym with Dan' },
  ash: { coach: 'Ash', where: 'on Zoom', label: 'On Zoom with Ash' },
};

const hh = (h) => String(h).padStart(2, '0') + ':00';
const clean = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f]+/g, ' ').trim().slice(0, max);

/* Today's date in Warrington as YYYY-MM-DD. */
function londonDay(now) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
}
function addDays(day, n) {
  const d = new Date(day + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const weekday = (day) => new Date(day + 'T12:00:00Z').getUTCDay();

/* Every slot from tomorrow for the next 3 weeks. */
function allSlots(now) {
  const today = londonDay(now), out = [];
  for (let i = 1; i <= DAYS_AHEAD; i++) {
    const day = addDays(today, i);
    (SLOTS[weekday(day)] || []).forEach((h) => out.push({ date: day, time: hh(h) }));
  }
  return out;
}

/* 'Mon 7 Dec, 6pm' */
function niceWhen(date, time) {
  const d = new Date(date + 'T12:00:00Z');
  const day = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const h = Number(time.slice(0, 2));
  return `${day} at ${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`;
}

const live = (b) => b && b.status !== 'cancelled';
function taken(bookings, blocks, date, time, who) {
  const key = date + 'T' + time;
  const bl = (blocks && blocks[key]) || {};
  if (bl[who]) return true;
  return (bookings || []).some((b) => live(b) && b.date === date && b.time === time && b.who === who);
}
function freeSlots(now, bookings, blocks) {
  return allSlots(now).map((s) => ({ ...s, dan: !taken(bookings, blocks, s.date, s.time, 'dan'), ash: !taken(bookings, blocks, s.date, s.time, 'ash') }));
}

/* ---- Supabase (service key, server side only) ---- */
async function sb(key, value) {
  const k = process.env.SUPABASE_SERVICE_KEY, base = `${process.env.SUPABASE_URL}/rest/v1/bodysculpt`;
  const h = { apikey: k, Authorization: 'Bearer ' + k, 'Content-Type': 'application/json' };
  if (value === undefined) {
    const res = await fetch(`${base}?key=eq.${encodeURIComponent(key)}&select=value`, { headers: h });
    if (!res.ok) throw new Error('supabase read ' + res.status);
    const rows = await res.json();
    return rows[0] && rows[0].value;
  }
  const res = await fetch(base, { method: 'POST', headers: { ...h, Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }) });
  if (!res.ok) throw new Error('supabase write ' + res.status);
}
async function readState() {
  const [bk, bl] = await Promise.all([sb(BOOK_KEY), sb(BLOCK_KEY)]);
  return { bookings: (bk && Array.isArray(bk.bookings)) ? bk.bookings : [], blocks: (bl && bl.blocks) || {} };
}

/* ---- GHL ---- */
const gh = () => ({ Authorization: 'Bearer ' + (process.env.GHL_TOKEN || '').trim(), Version: '2021-07-28', 'Content-Type': 'application/json', Accept: 'application/json' });
async function ghl(path, method, body) {
  const res = await fetch(GHL + path, { method: method || 'GET', headers: gh(), body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}
async function contactById(id) {
  if (!/^[A-Za-z0-9]{10,40}$/.test(id || '')) return null;
  try {
    const r = await ghl(`/contacts/${id}`);
    const c = r.contact || r;
    return c && c.id ? { id: c.id, first: clean(c.firstName, 60), last: clean(c.lastName, 60), email: clean(c.email, 120).toLowerCase() } : null;
  } catch (e) { return null; }
}

function emailHtml(first, b) {
  const w = WHO[b.who];
  const how = b.who === 'ash'
    ? "Ash will send you the Zoom link before we chat."
    : "Just come to the gym, Dan will meet you there.";
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:17px;line-height:1.55;color:#161616;max-width:600px">
<p>Hi ${first || 'there'},</p>
<p>You're booked in for your catch-up with ${w.coach} on <b>${niceWhen(b.date, b.time)}</b>, ${w.where}.</p>
<p>${how}</p>
<p>Have a think about anything you want to talk about: how the month's gone, a goal, an event coming up, training, food, an injury. Anything at all.</p>
<p>If you can't make it any more, just reply to this email and we'll find another time.</p>
<p>See you then,<br>The Bodysculpt Team</p></div>`;
}

async function tellGhl(contactId, first, b, now) {
  const w = WHO[b.who];
  const when = niceWhen(b.date, b.time);
  const done = { note: false, task: false, email: false };
  await ghl(`/contacts/${contactId}/notes`, 'POST', { body: `Booked a monthly catch-up: ${when}, ${w.where} with ${w.coach}.${b.note ? ' Wants to talk about: ' + b.note : ''}` })
    .then(() => { done.note = true; }).catch((e) => console.error('note', e.message));
  if (b.who === 'ash') {
    await ghl(`/contacts/${contactId}/tasks`, 'POST', {
      title: `Zoom catch-up: ${b.name}, ${when}`,
      body: `${b.name} booked a Zoom catch-up with you for ${when}.\nSend them the Zoom link before then.${b.note ? '\nThey want to talk about: ' + b.note : ''}`,
      dueDate: new Date(Math.min(Date.parse(b.date + 'T' + b.time + ':00Z'), now + 48 * 3600 * 1000)).toISOString(),
      completed: false, assignedTo: ASH_USER,
    }).then(() => { done.task = true; }).catch((e) => console.error('task', e.message));
  }
  await ghl('/conversations/messages', 'POST', {
    type: 'Email', contactId, subject: `You're booked in: ${when}`, html: emailHtml(first, b),
  }).then(() => { done.email = true; }).catch((e) => { console.error('email', e.message); done.emailError = String(e.message).replace(/^\S+ /, '').slice(0, 160); });
  return done;
}

function readBody(event) {
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');
  try { return JSON.parse(raw); } catch (e) { return Object.fromEntries(new URLSearchParams(raw)); }
}

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const reply = (code, obj) => ({ statusCode: code, headers: cors, body: JSON.stringify(obj) });

exports.handler = async (event) => {
  const now = Date.now();
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors };
  try {
    if (event.httpMethod === 'GET') {
      const q = event.queryStringParameters || {};
      const [state, person] = await Promise.all([readState(), q.c ? contactById(q.c) : null]);
      return reply(200, { first: person ? person.first : '', known: !!person, slots: freeSlots(now, state.bookings, state.blocks) });
    }
    if (event.httpMethod !== 'POST') return reply(405, { error: 'GET or POST' });

    const f = readBody(event);
    const who = f.who === 'dan' || f.who === 'ash' ? f.who : null;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(f.date || '') ? f.date : null;
    const time = /^\d{2}:00$/.test(f.time || '') ? f.time : null;
    const note = clean(f.note, 600);
    if (!who || !date || !time) return reply(400, { error: 'Pick who, a day and a time.' });
    if (!allSlots(now).some((s) => s.date === date && s.time === time)) return reply(400, { error: "That time isn't one we offer." });

    let person = f.c ? await contactById(f.c) : null;
    if (!person) {
      const first = clean(f.firstName, 60), last = clean(f.lastName, 60), email = clean(f.email, 120).toLowerCase();
      if (!first || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply(400, { error: 'Add your name and email.' });
      const up = await ghl('/contacts/upsert', 'POST', { locationId: LOCATION, email, firstName: first, lastName: last });
      const id = (up.contact && up.contact.id) || up.id;
      if (!id) throw new Error('no contact id from upsert');
      person = { id, first, last, email };
    }

    const state = await readState();
    if (taken(state.bookings, state.blocks, date, time, who)) return reply(409, { error: 'Someone has just taken that time. Pick another one.', slots: freeSlots(now, state.bookings, state.blocks) });

    const booking = {
      id: 'cu' + now.toString(36) + Math.random().toString(36).slice(2, 6),
      contactId: person.id, name: [person.first, person.last].filter(Boolean).join(' '), email: person.email,
      who, date, time, note, createdAt: new Date(now).toISOString(), status: 'booked', seen: null,
    };
    // keep the row small: drop anything finished more than 60 days ago
    const cutoff = addDays(londonDay(now), -60);
    const bookings = state.bookings.filter((b) => b.date >= cutoff).concat(booking);
    await sb(BOOK_KEY, { bookings });

    const ghlDone = await tellGhl(person.id, person.first, booking, now);
    return reply(200, { ok: true, booking: { who, date, time, when: niceWhen(date, time), label: WHO[who].label }, ghl: ghlDone });
  } catch (e) {
    console.error(e);
    return reply(502, { error: "Something went wrong on our side. Try again, or reply to the email and we'll book you in." });
  }
};

exports._test = { SLOTS, allSlots, freeSlots, taken, niceWhen, londonDay };
