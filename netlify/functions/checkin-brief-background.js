/**
 * checkin-brief-background.js — Netlify background function (up to 15 minutes)
 *
 * What's worth talking about on a challenger's weekly check-in. Ash, 26 Nov 2026: "At one
 * glance, inside of their card, we should be able to see how many sessions they attended the
 * previous week, how compliant they were inside of Trainerize (did they hit their food etc?)
 * and anything worth mentioning in Slack from the coaches' daily report. And then a
 * recommended written reply / voice note to send."
 *
 * For every challenger on the journey (clock running, or in their free weeks) it reads:
 *   TeamUp      training sessions ATTENDED in the week the check-in is about (see checkInWeek),
 *               since they started, and what they have booked for this week (attended only, same
 *               rule as the Attendance tab)
 *   Trainerize  food logged each day against their calorie and protein targets, workouts and
 *               cardio ticked off in the app, body stats, when they last opened the app
 *   Slack       lines in the 6 Week Challenge part (new trialists + 6WC updates) of the coaches’ Post-Shift Checklist posts (#general) that name them, for shifts in that same week
 * then Claude writes the few things worth raising, a message to send and a voice note to record,
 * in the Bodysculpt check-in voice. Nothing is sent anywhere: the coach reads it, tweaks it, sends it.
 *
 * Writes ONE row, 'checkin-briefs' {at, briefs:{challengerId: brief}}, which the tracker shows
 * inside each check-in card on Today's moves.
 *
 * Started by checkin-brief-daily.js every morning (netlify.toml), or:
 *   POST with header x-webhook-secret            every challenger
 *   POST {"id": "<challenger id>"} (no secret)   one challenger, the tracker's Refresh button.
 *        Only for someone on the journey, and not more than once every 10 minutes each.
 *
 * ENV: TEAMUP_TOKEN, TRAINERIZE_GROUP_ID, TRAINERIZE_API_ACCESS, SLACK_USER_TOKEN, ANTHROPIC_API_KEY,
 *      SUPABASE_URL, SUPABASE_SERVICE_KEY, WEBHOOK_SECRET
 */

const TU = 'https://goteamup.com/api/v2';
const TU_PROVIDER = process.env.TEAMUP_PROVIDER_ID || '1653275';
const TZ = 'https://api.trainerize.com/v03/';
const GENERAL_CHANNEL = 'C05H1U54JKU';   // #general, where the Post-Shift Checklist posts land
const ROW = 'checkin-briefs';
const DAY = 86400000;
const SLACK_DAYS = 16;     // far enough back to hold the whole of last week, plus a late post or two
const REFRESH_GAP = 10 * 60000;
const NOT_TRAINING = /intro|review|workshop|quiz|goal setting|cold water|games|social|consult|assessment/i;   // same as attendance-sync

const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const env = (k) => String(process.env[k] || '').trim();
const isTraining = (t) => !!t && !NOT_TRAINING.test(t);

/* ---------- who: the same day count as the tracker (currentDay / clockStart in index.html) ---------- */
function midnight(ms) { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); }

/* ---------- THE WEEK a check-in is about ----------
   One fixed week, Monday to Sunday: the last FULL one. Ash, 27 Nov 2026: check-ins are done on
   a Monday or a Tuesday and are about the week just gone, so everything on the brief — sessions,
   food, the coaches' notes — has to come from that one week and nothing either side of it. It
   used to be "the last seven days", which slid with the day you looked: a note from the Thursday
   before last could turn up again in this week's brief after it had already been covered, and
   "2 sessions in 7 days" meant a different seven days on a Friday than on a Monday.

   Days are Warrington's, not the server's (which runs on UTC): a Sunday 11.30pm in June is
   still Sunday. londonYmd turns any moment into the gym's calendar date; the week is two of
   those dates and everything is compared to them as text, so no clock change can move it. Pure. */
const londonYmd = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
const addYmd = (day, n) => ymd(Date.parse(day + 'T12:00:00Z') + n * DAY);
function checkInWeek(now = Date.now()) {
  const today = londonYmd(now);
  const dow = (new Date(today + 'T12:00:00Z').getUTCDay() + 6) % 7;     // Monday 0 … Sunday 6
  const thisMonday = addYmd(today, -dow);
  return { from: addYmd(thisMonday, -7), to: addYmd(thisMonday, -1), thisMonday, thisSunday: addYmd(thisMonday, 6) };
}
const inWeek = (day, wk) => !!day && day >= wk.from && day <= wk.to;
function weekWords(wk) {
  const d = (x, o) => new Date(x + 'T12:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC', ...o });
  return 'Monday ' + d(wk.from, { day: 'numeric', month: 'long' }) + ' to Sunday ' + d(wk.to, { day: 'numeric', month: 'long' });
}
function onJourney(m, now = Date.now()) {
  if (!m || !m.firstSessionDone || !m.day0) return false;
  if (m.outcome === 'left' || m.left === true || m.pausedAt) return false;
  const t0 = midnight(now);
  const start = (m.sixStart && m.sixStart > m.day0) ? m.sixStart : m.day0;
  if (t0 < start) return true;                                  // free weeks, training before the six weeks
  const day = Math.floor((t0 - start) / DAY) - (m.pausedDays || 0);
  return day <= 42 + (m.extraDays || 0) + 1;                    // through the week 6 check-in, plus a day's grace
}
function journeyDay(m, now = Date.now()) {
  const t0 = midnight(now);
  const start = (m.sixStart && m.sixStart > m.day0) ? m.sixStart : m.day0;
  if (t0 < start) return { free: true, day: Math.floor((t0 - m.day0) / DAY) };
  return { free: false, day: Math.max(0, Math.floor((t0 - start) / DAY) - (m.pausedDays || 0)) };
}

/* ---------- I/O ---------- */
async function json(url, opts) {
  const res = await fetch(url, opts); const text = await res.text();
  if (!res.ok) { const e = new Error(`${url.split('?')[0]} ${res.status}: ${text.slice(0, 200)}`); e.status = res.status; throw e; }
  return text ? JSON.parse(text) : {};
}
async function readRow(key) {
  const k = env('SUPABASE_SERVICE_KEY');
  const rows = await json(`${env('SUPABASE_URL')}/rest/v1/bodysculpt?key=eq.${key}&select=value`, { headers: { apikey: k, Authorization: 'Bearer ' + k } });
  return rows[0] && rows[0].value;
}
async function writeRow(key, value) {
  const k = env('SUPABASE_SERVICE_KEY');
  await json(`${env('SUPABASE_URL')}/rest/v1/bodysculpt`, { method: 'POST',
    headers: { apikey: k, Authorization: 'Bearer ' + k, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ key, value, updated_at: new Date().toISOString() }) });
}

let tuPrefix = 'Bearer';
async function tu(path) {
  for (let attempt = 0; attempt < 5; attempt++) {
    await sleep(260);   // under TeamUp's 250 a minute
    try {
      return await json(path.startsWith('http') ? path : `${TU}/${path}`, { headers: {
        Accept: 'application/json', Authorization: `${tuPrefix} ${env('TEAMUP_TOKEN')}`,
        'Teamup-Provider-ID': TU_PROVIDER, 'Teamup-Request-Mode': 'provider' } });
    } catch (e) {
      if (e.status === 401 && tuPrefix === 'Bearer') { tuPrefix = 'Token'; continue; }
      if (e.status === 429 || e.status >= 500) { await sleep(2000 * (attempt + 1)); continue; }
      throw e;
    }
  }
  throw new Error('TeamUp kept refusing: ' + path.split('?')[0]);
}
async function tuAll(path) {
  const out = []; let url = path;
  for (let p = 0; p < 30 && url; p++) { const j = await tu(url); out.push(...(j.results || [])); url = j.next || null; }
  return out;
}
async function tz(method, body) {
  const token = env('TRAINERIZE_API_TOKEN') || env('TRAINERIZE_API_ACCESS');
  return json(TZ + method, { method: 'POST', headers: { 'Content-Type': 'application/json',
    Authorization: 'Basic ' + Buffer.from(`${env('TRAINERIZE_GROUP_ID')}:${token}`).toString('base64') }, body: JSON.stringify(body) });
}
async function slackGet(method, params) {
  const r = await fetch('https://slack.com/api/' + method + '?' + new URLSearchParams(params), { headers: { Authorization: 'Bearer ' + env('SLACK_USER_TOKEN') } });
  const d = await r.json().catch(() => ({}));
  if (!d.ok) throw new Error('Slack ' + method + ': ' + (d.error || r.status));
  return d;
}

/* ---------- TeamUp: sessions ---------- */
async function teamupCustomer(m) {
  const em = norm(m.email);
  if (em) {
    const r = await tu(`customers?query=${encodeURIComponent(em)}&page_size=5&fields=id,email,first_name,last_name`).catch(() => ({}));
    const c = (r.results || []).find((x) => norm(x.email) === em);
    if (c) return c;
  }
  const r = await tu(`customers?query=${encodeURIComponent(String(m.name || '').trim())}&page_size=10&fields=id,email,first_name,last_name`).catch(() => ({}));
  const full = (r.results || []).filter((x) => norm([x.first_name, x.last_name].join(' ')).replace(/\s+/g, ' ') === norm(m.name).replace(/\s+/g, ' '));
  return full.length === 1 ? full[0] : null;   // two people with the same name: don't guess
}
/* Attended training sessions, oldest first. Pure. */
function trainingSessions(rows) {
  return (rows || []).filter((a) => a && a.event && isTraining(a.event.offering_type && a.event.offering_type.name))
    .map((a) => ({ at: a.event.starts_at, type: a.event.offering_type.name }))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
}
async function sessionsFor(m, now) {
  const c = await teamupCustomer(m);
  if (!c) return { found: false };
  const fields = '&expand=event,event.offering_type&fields=status,event.starts_at,event.offering_type.name&page_size=100';
  const all = trainingSessions(await tuAll(`attendances?customer=${c.id}&status=attended&event_starts_at_gte=${ymd(m.day0 - DAY)}T00:00:00Z&event_starts_at_lte=${new Date(now).toISOString()}${fields}`));
  // "lastWeek" is the week the check-in is about, Monday to Sunday (checkInWeek), by the gym's dates
  const wk = checkInWeek(now);
  const lastWeek = all.filter((s) => inWeek(londonYmd(new Date(s.at).getTime()), wk));
  // …and "booked" is what they have down for the rest of THIS week, up to Sunday night
  const booked = trainingSessions(await tuAll(`attendances?customer=${c.id}&status=plans_to_attend&event_starts_at_gte=${new Date(now).toISOString()}&event_starts_at_lte=${wk.thisSunday}T23:59:59Z${fields}`).catch(() => []));
  return { found: true, lastWeek: lastWeek.length, lastWeekList: lastWeek.map((s) => s.at), total: all.length,
    days: [...new Set(all.map((s) => String(s.at).slice(0, 10)))],
    last: all.length ? all[all.length - 1].at : null, booked: booked.length, bookedList: booked.map((s) => s.at) };
}

/* ---------- Trainerize: the app ---------- */
async function trainerizeUser(m) {
  const em = norm(m.email);
  if (em) {
    const f = await tz('user/find', { searchTerm: em, view: 'allClient', start: 0, count: 5 }).catch(() => ({}));
    const u = (f.users || []).find((x) => norm(x.email) === em);
    if (u) return u;
  }
  const f = await tz('user/find', { searchTerm: String(m.name || '').trim(), view: 'allClient', start: 0, count: 10 }).catch(() => ({}));
  const hits = (f.users || []).filter((x) => norm([x.firstName, x.lastName].join(' ')).replace(/\s+/g, ' ') === norm(m.name).replace(/\s+/g, ' '));
  return hits.length ? hits.sort((a, b) => b.id - a.id)[0] : null;   // newest account if there are two
}
/* The week's food, against their targets. A day under a third of the calorie target is a
   half-logged day (a snack and nothing else), counted apart so it doesn't flatter the average. Pure. */
function foodWeek(days, goal) {
  const cal = goal && goal.caloricGoal ? Number(goal.caloricGoal) : null;
  const pro = goal && goal.proteinGrams ? Number(goal.proteinGrams) : null;
  const dev = goal && goal.nutritionDeviation ? Number(goal.nutritionDeviation) / 100 : 0.1;
  const logged = (days || []).filter((d) => d && Number(d.calories) > 0);
  const full = cal ? logged.filter((d) => Number(d.calories) >= cal / 3) : logged;
  const avg = (xs, k) => xs.length ? Math.round(xs.reduce((s, d) => s + Number(d[k] || 0), 0) / xs.length) : null;
  return {
    daysLogged: logged.length, fullDays: full.length, partDays: logged.length - full.length,
    calGoal: cal, avgCal: avg(full, 'calories'),
    onCalDays: cal ? full.filter((d) => Math.abs(Number(d.calories) - cal) <= cal * dev).length : null,
    overCalDays: cal ? full.filter((d) => Number(d.calories) > cal * (1 + dev)).length : null,
    proGoal: pro, avgPro: avg(full, 'proteinGrams'),
    proHitDays: pro ? full.filter((d) => Number(d.proteinGrams) >= pro * 0.9).length : null,
    source: (logged[0] && logged[0].source) || (goal && goal.trackingType) || null,
  };
}
async function appFor(m, now) {
  const u = await trainerizeUser(m);
  if (!u) return { found: false };
  const { from, to } = checkInWeek(now);          // food and app workouts for that same Monday to Sunday
  const [n, g, cal] = await Promise.all([
    tz('dailyNutrition/getList', { userID: u.id, startDate: from, endDate: to }).catch(() => ({})),
    tz('goal/getList', { userID: u.id, achieved: false, start: 0, count: 10 }).catch(() => ({})),
    tz('calendar/getList', { userID: u.id, startDate: from, endDate: to, unitWeight: 'kg' }).catch(() => ({})),
  ]);
  const goal = (g.goals || []).find((x) => x.type === 'nutritionGoal') || null;
  const items = (cal.calendar || []).flatMap((d) => (d.items || []).map((i) => ({ ...i, date: d.date })));
  const count = (type, st) => items.filter((i) => (type instanceof RegExp ? type.test(i.type) : i.type === type) && (!st || i.status === st)).length;
  return {
    found: true, id: u.id, lastIn: u.latestSignedIn || null,
    food: foodWeek(n.nutrition || [], goal),
    workoutsDone: count(/^workout/, 'tracked'), workoutsMissed: count(/^workout/, 'scheduled'),
    cardioDone: count('cardio', 'tracked'),
    bodyStats: count('bodyStat', 'tracked') > 0, bodyStatsMissed: count('bodyStat', 'scheduled') > 0,
  };
}

/* ---------- Slack: the coaches' Post-Shift Checklist posts (same reading as the welcome card) ---------- */
/* Only the 6 Week Challenge part of the checklist is read. The other sections ("Any post-session
   updates on members?", "Anyone at risk?"...) are about every member, so a first name there is
   easily someone else. The challenge part is the "Any 6 Week Challenge updates?" question (Ash is
   adding it to the form, 26 Nov 2026) plus "Any new trialists on their first week?", which is
   week 1 of the challenge. A line is a section heading when it opens with one of the form's
   questions. Pure. */
const CHALLENGE_HEADS = /^(any (new )?(6|six)[- ]?(week|wk)s?[- ]?(challenge|challengers)\b|any 6wc\b|any new trialists)/i;
const OTHER_HEADS = /^(everyone ticked|anyone at risk|any wow|is trainerize|anything the late team|onboarding checklist|any post[- ]?session|hoovered|post[- ]?shift checklist)/i;
function sectionOf(l) {
  if (CHALLENGE_HEADS.test(l)) return 'challenge';
  if (OTHER_HEADS.test(l)) return 'other';
  return '';
}
/* The day a checklist is ABOUT. A late shift is often written up the next morning ("Thu 26 Nov,
   11:50, Wednesday - Late"), so the post's own date would put Wednesday night's notes on Thursday
   — and a Sunday shift written up on Monday into the wrong week altogether. The form names the
   shift, so that is the day used: the most recent such weekday on or before the day it was
   posted. No shift named (an old post, a test) falls back to the day it was posted. Pure. */
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
function shiftDay(text, postedMs) {
  const posted = londonYmd(postedMs);
  const m = /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\s*[-–]\s*(early|late|mid|am|pm)\b/i.exec(String(text || ''));
  if (!m) return posted;
  const want = WEEKDAYS.indexOf(m[1].toLowerCase());
  const back = (new Date(posted + 'T12:00:00Z').getUTCDay() - want + 7) % 7;
  return addYmd(posted, -back);
}
const unescapeSlack = (t) => String(t || '').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&');
function checklistLines(messages) {
  const out = [];
  for (const m of messages || []) {
    const parts = [m.text || ''];
    for (const b of m.blocks || []) {
      if (b.text && b.text.text) parts.push(b.text.text);
      for (const e of b.elements || []) if (e && e.text) parts.push(e.text);
    }
    const all = parts.join('\n');
    if (!/post[- ]?shift checklist/i.test(all)) continue;
    const coach = (all.match(/\*([^*\n]+)\*\s+•/) || [])[1] || '';
    const day = shiftDay(all, Number(m.ts) * 1000);
    let section = '';
    for (const line of all.split('\n')) {
      const l = unescapeSlack(line).replace(/^>\s?/, '').replace(/^>\s?/, '').replace(/:[a-z_]+:/g, '').replace(/[*_]/g, '').replace(/<@[A-Z0-9]+\|([^>]+)>/g, '@$1').trim();
      if (!l) continue;
      const head = sectionOf(l);
      if (head) { section = head; continue; }
      if (section === 'challenge') out.push({ day, coach: coach.trim(), text: l });
    }
  }
  return out;
}
/* A note that only uses a first name ("Emma - 30kg squat") could be another Emma. Keep it when
   this person trained that day or the day before (a late shift is often posted the next morning),
   or when we can't tell because they weren't found on TeamUp. Full-name notes always stay. Pure. */
function plausible(mentions, days) {
  if (!days) return mentions.map((x) => ({ ...x, check: !x.full }));
  const set = new Set(days);
  return mentions.filter((x) => x.full || set.has(x.day) || set.has(ymd(new Date(x.day + 'T12:00:00Z').getTime() - DAY)));
}

/* Lines that name this person: full name, or first name as a whole word, unless the line is
   plainly about another person with the same first name ("Emma G" when ours is Emma Dalby). Pure. */
function mentionsOf(lines, first, last) {
  const f = String(first || '').trim(), l = String(last || '').trim();
  if (f.length < 2) return [];
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const fullRe = l ? new RegExp('\\b' + esc(f) + '\\s+' + esc(l) + '\\b', 'i') : null;
  const firstRe = new RegExp('\\b' + esc(f) + '\\b', 'i');
  const someoneElse = (t) => {
    if (!l) return false;
    const re = new RegExp('\\b' + esc(f) + '\\s+([A-Za-z][a-z]*\\.?)', 'g'); let mm, other = false, ours = false;
    while ((mm = re.exec(t))) {
      const nx = mm[1].replace('.', '');
      if (l.toLowerCase().startsWith(nx.toLowerCase())) ours = true;
      else if (nx.length === 1 || (/^[A-Z][a-z]+$/.test(nx) && !/^(And|Was|Is|Has|Had|Did|Done|Came|Back|Said|Smashed|Loved|Loving|Got|Hit|Was|Went)$/.test(nx))) other = true;
    }
    return other && !ours;
  };
  /* Coaches write "Niambh - done well ... chatted with Charlotte". That line is about Niambh, so
     it is not Charlotte's. When a line opens with who it's about ("Name - ", "Name: ",
     "Sarah, Clare & Emma - "), this person must be in that opening part. */
  const aboutSomeoneElse = (t) => {
    const mm = String(t).match(/^([^:\n]{1,45}?)\s*(?:\s-\s|-\s|\s-|:|–|—)/);
    return !!mm && !firstRe.test(mm[1]) && !/^@?(ash|dan|gaz|grace|everyone|all|team)\b/i.test(mm[1].trim());   // "Ash - Tash asked..." is a note TO a coach
  };
  const seen = new Set();
  return (lines || []).filter((x) => firstRe.test(x.text) && !/^(Post-Shift Checklist|Anyone at risk|Any )/i.test(x.text) && !someoneElse(x.text) && !aboutSomeoneElse(x.text))
    .map((x) => ({ ...x, full: !!(fullRe && fullRe.test(x.text)) }))
    .filter((x) => { const k = x.text.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => b.day.localeCompare(a.day))
    .slice(0, 8);
}
async function readShiftPosts(now) {
  const oldest = String(Math.floor(now / 1000 - SLACK_DAYS * 86400));
  const msgs = []; let cursor = '';
  for (let i = 0; i < 10; i++) {
    const d = await slackGet('conversations.history', { channel: GENERAL_CHANNEL, oldest, limit: '200', ...(cursor ? { cursor } : {}) });
    msgs.push(...(d.messages || []));
    cursor = d.response_metadata && d.response_metadata.next_cursor;
    if (!d.has_more || !cursor) break;
  }
  return checklistLines(msgs);
}

/* ---------- Claude: what to raise, and the message ---------- */
const VOICE = `You write weekly check-ins for Bodysculpt, a small personal-training gym in Warrington, UK, run by Ash.
A challenger is on a 6 Week Challenge. Their coach sends this check-in on Trainerize, as a written message or a voice note.

How Bodysculpt check-ins sound (learned from Ash's own edits):
- Open with "Hi [first name], hope you're OK" (or a close variation) and a check on them as a person before any praise. Don't mention the weekend or the time of day: the coach may send it any day, any time.
- Short paragraphs, a blank line between each point. Warm, human, British, spoken. Joined with "and" and "so", not punchy fragments.
- Give one NAMED win, something specific and true from the data or the coaches' notes (a lift, a session count, logging food every day).
- Soft, humble advice: "maybe try...?", "easier said than done, I know". Questions that leave them in charge ("How did you find...?", "Shall we...?"). A question in most paragraphs.
- If food logging was patchy, be kind about it and make it easy (one or two go-to breakfasts and lunches, rinse and repeat; are you hungry or bored?). Never tell them off. Never mention body weight or how they look.
- If they've had pain or a niggle, ask how it is and say we can adapt their sessions.
- If they're quiet on sessions, ask what's getting in the way and whether a different time would help. No guilt.
- End with an open door or a bit of encouragement, in your own words for this person. Use 💪🏻 not 💪. At most one or two emojis in the message.
- Every number and note is from ONE fixed week, Monday to Sunday, named in the facts as theWeek. The coach sends this early the week after, so call it "last week". Never "this week", "the last seven days" or a date range.
- Pick the two or three things that matter most from that week and leave the rest. Don't cover every number.
- Each check-in must sound written for this one person. Avoid the stock lines "easier said than done", "rinse and repeat", "just shout" and "you've got this" unless one truly fits, and never more than one of them.
- No sign-off and no name at the end, and don't say who it's from: the coach sends it from their own account.
- Never say which week or day of the challenge it is (the coach may send it a day or two late).
- UK spelling. No dashes of any kind. No "not X, it's Y". No corporate words (journey, crush, smash it, incredible, amazing work). No hashtags.
- Never invent anything: no made-up memories, products, numbers or personal facts. Use only what's in the data and notes. If a coach note only uses their first name and might be someone else, leave it out of the message.
- Don't quote the data like a report ("you logged 4 of 7 days, averaging 1,612 kcal"). Say it like a person ("you logged most days last week, which is brilliant").`;

async function writeBrief(m, facts) {
  if (!env('ANTHROPIC_API_KEY')) throw new Error('ANTHROPIC_API_KEY not set');
  const first = String(m.name || '').trim().split(/\s+/)[0];
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': env('ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'claude-sonnet-5-5', max_tokens: 6000, output_config: { effort: 'low' },
      system: VOICE + `

Reply with JSON only, no other text:
{"points": ["2 to 4 short things worth talking about on this check-in, each under 15 words, for the coach's eyes, most important first"],
 "message": "the written check-in to send, 70 to 140 words, addressed to ${first}",
 "voice": "what to say on a 30 to 45 second voice note, written exactly as it would be spoken (no emojis, numbers as you'd say them, e.g. 45 kilos), 60 to 100 words, addressed to ${first}. Not a copy of the message: looser and chattier"}`,
      messages: [{ role: 'user', content: JSON.stringify(facts, null, 1) }],
    }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Claude ' + r.status + ': ' + JSON.stringify(d).slice(0, 200));
  const text = String(((d.content || []).find((b) => b && b.type === 'text') || {}).text || '');
  const j = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  const clean = (s) => String(s || '').replace(/\s*[—–]\s*/g, ', ').trim();
  const noEmoji = (s) => s.replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F3FB}-\u{1F3FF}\u{FE0F}]/gu, '').replace(/ +([.,!?])/g, '$1').replace(/ {2,}/g, ' ').trim();
  return { points: (j.points || []).map(clean).slice(0, 4), message: clean(j.message), voice: noEmoji(clean(j.voice)) };
}

/* What each week's check-in is for, from the tracker's touchpoints (index.html, wk2..wk6). Pure. */
function weekJob(jd) {
  if (jd.free) return 'A check-in during their free weeks: reference their effort and attendance, give a named win, remind them they can ask for help before they struggle.';
  const wk = Math.min(6, Math.floor(jd.day / 7) + 1);
  if (wk <= 1) return 'Their first week: make them feel looked after, give a named win from their first sessions, and make it easy to tell us about any pain or worries.';
  if (wk === 2) return 'Week 2 check-in: reference their effort and attendance, give a named win, set ONE focus for the week, remind them they can ask for help before they struggle.';
  if (wk === 3) return 'Week 3 check-in: they are settling in. Give a named win and set one focus. The coach finishes the VOICE NOTE with a set line of their own about building a routine they can keep after the six weeks, so end the voice note just before that: no sign-off, and don\'t say that line yourself.';
  if (wk === 6) return 'Week 6, the last check-in of the six weeks: celebrate how far they have come with a named win, and set up a chat about where next from a place of genuine care (no selling).';
  return 'Week ' + wk + ' check-in: reference their effort, give a named win, set one focus for the week.';
}

/* What Claude is told, in plain words. Pure. */
function factsFor(m, jd, sessions, app, mentions, wk = checkInWeek()) {
  const f = { name: m.name, coach: m.coach || 'their coach', theWeek: weekWords(wk) + ' (last week)',
    where: jd.free ? `Training in their free weeks before the six weeks start, ${jd.day} days in` : `${jd.day} days into the six weeks`,
    thisCheckIn: weekJob(jd), writtenOn: new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/London' }),
    personal: m.personal || undefined, trackerNotes: m.notes || undefined };
  f.sessions = sessions.found
    ? { attendedInTheWeek: sessions.lastWeek, sinceTheyStarted: sessions.total, lastSession: sessions.last ? String(sessions.last).slice(0, 10) : 'none yet', bookedForTheRestOfThisWeek: sessions.booked }
    : 'Not found on TeamUp, so no session count';
  if (app.found) {
    const fd = app.food;
    f.trainerize = {
      lastOpenedApp: app.lastIn,
      food: fd.daysLogged ? {
        daysLoggedOf7: fd.daysLogged, halfLoggedDays: fd.partDays || undefined,
        calorieTarget: fd.calGoal, averageCaloriesOnFullDays: fd.avgCal, daysWithinTarget: fd.onCalDays, daysOverTarget: fd.overCalDays,
        proteinTargetGrams: fd.proGoal, averageProteinGrams: fd.avgPro, daysProteinHit: fd.proHitDays,
      } : 'No food logged in the week',
      appWorkoutsTicked: app.workoutsDone, appWorkoutsLeftUnticked: app.workoutsMissed || undefined,
      cardioTicked: app.cardioDone || undefined,
      bodyStats: app.bodyStats ? 'logged in the week' : app.bodyStatsMissed ? 'due in the week, not logged' : undefined,
    };
  } else f.trainerize = 'Not found on Trainerize';
  f.coachesShiftNotes = mentions.length ? mentions.map((x) => `[${x.day}, ${x.coach || 'coach'}${x.check ? ', first name only, may be someone else' : ''}] ${x.text}`) : 'Nothing in the coaches’ shift notes for the week';
  return f;
}

async function briefFor(m, lines, now) {
  const [first, ...rest] = String(m.name || '').trim().split(/\s+/);
  const jd = journeyDay(m, now);
  const wk = checkInWeek(now);
  const out = { name: m.name, at: new Date(now).toISOString(), period: { from: wk.from, to: wk.to }, free: jd.free, day: jd.day, errors: [] };
  const [sessions, app] = await Promise.all([
    sessionsFor(m, now).catch((e) => { out.errors.push('TeamUp: ' + e.message.slice(0, 120)); return { found: false, error: true }; }),
    appFor(m, now).catch((e) => { out.errors.push('Trainerize: ' + e.message.slice(0, 120)); return { found: false, error: true }; }),
  ]);
  // only what the coaches wrote about shifts IN that week: last week's notes were last week's check-in
  const mentions = lines ? plausible(mentionsOf(lines.filter((x) => inWeek(x.day, wk)), first, rest.join(' ')), sessions.found ? sessions.days : null) : [];
  const { days, ...sessionsKept } = sessions;
  Object.assign(out, { sessions: sessionsKept, app, slack: mentions.map(({ day, coach, text, full, check }) => ({ day, coach, text, full, check: !!check })) });
  try { Object.assign(out, await writeBrief(m, factsFor(m, jd, sessions, app, mentions, wk))); }
  catch (e) { out.errors.push('Message: ' + e.message.slice(0, 160)); }
  return out;
}

async function run({ only = null, now = Date.now() } = {}) {
  const roster = (await readRow('roster')) || [];
  const people = (Array.isArray(roster) ? roster : []).filter((m) => onJourney(m, now) && (!only || m.id === only));
  const before = (await readRow(ROW)) || { briefs: {} };
  if (only && before.briefs && before.briefs[only] && now - new Date(before.briefs[only].at).getTime() < REFRESH_GAP) return { skipped: 'fresh' };
  let lines = null, slackError = null;
  try { lines = await readShiftPosts(now); } catch (e) { slackError = e.message; console.log('CHECKIN-BRIEF: Slack not read: ' + e.message); }
  const made = {};
  for (const m of people) {
    made[m.id] = await briefFor(m, lines, now);
    if (slackError) made[m.id].errors.push('Slack: ' + slackError.slice(0, 120));
  }
  // read again before writing, so a Refresh for one person can't wipe a morning run that finished meanwhile
  const fresh = (await readRow(ROW)) || { briefs: {} };
  const briefs = only ? { ...(fresh.briefs || {}), ...made } : made;
  await writeRow(ROW, { at: new Date(now).toISOString(), briefs });
  console.log(`CHECKIN-BRIEF: ${Object.keys(made).length} made${only ? ' (' + only + ')' : ''}`);
  return { made: Object.keys(made).length };
}

exports.handler = async (event) => {
  const h = event.headers || {};
  let body = {}; try { body = JSON.parse(event.body || '{}'); } catch (e) { /* empty */ }
  const secretOk = env('WEBHOOK_SECRET') && h['x-webhook-secret'] === env('WEBHOOK_SECRET');
  if (!secretOk && !(body.id && typeof body.id === 'string' && body.id.length < 60)) return { statusCode: 401, body: 'Unauthorized' };
  try { await run({ only: secretOk && !body.id ? null : body.id }); }
  catch (e) { console.error('CHECKIN-BRIEF failed: ' + e.message); }
  return { statusCode: 202 };
};
exports.run = run;
exports._test = { onJourney, journeyDay, trainingSessions, foodWeek, checklistLines, mentionsOf, plausible, weekJob, factsFor, checkInWeek, shiftDay, weekWords };
