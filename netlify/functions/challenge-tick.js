/**
 * challenge-tick.js — Netlify serverless function, run once a morning by challenge-tick-daily.js
 *
 * The tracker owns the clock. Each challenger's day number comes from the roster, using the same
 * sum as currentDay() in index.html, so a moved date, an Undo or a pause all move the emails too.
 * This function only tells GHL what is due, by adding a tag. Each tag starts its own email
 * workflow in GHL, so the wording stays in GHL where Ash can see it.
 *
 *   '6wc day N'         the email for day N is due. Only the latest stays on the contact: the
 *                       one before comes off, and the one left is the record of how far they got.
 *   'members'           added by GHL's "Membership - Paid" workflow when they pay for a membership
 *                       (read here, never added). With outcome 'stayed' on the tracker, it means
 *                       they've JOINED: the sign-up emails (days 37, 39, 41) stop, the coaching
 *                       emails carry on to the end of their six weeks.
 *   '6wc joined'        they've joined (paid, or a coach marked them stayed on). The Day 28 and 35
 *                       emails check it in GHL to leave out the "have a look at our memberships" line.
 *   'member start'      their membership has started. This is what starts the members automation in
 *                       GHL. A challenger gets it when their challenge ends (or on the start date a coach
 *                       typed). Anyone else with 'members' gets it the next morning (see startSweep).
 *   '6wc finished'      their six weeks are up.
 *   '6wc lapsed'        a week after finishing, with no membership: Trainerize is deactivated.
 *   'email list'        added with '6wc lapsed': Ash's list for regular offers and content.
 *   '6wc guide ...'     that guide has been sent to them in a Trainerize message, so it's never sent twice.
 *
 *   '6wc guide failed'  a guide couldn't be added. The tag starts a text to Ash in GHL.
 *   '6wc guide held'    a weekly guide was due but the client may be waiting on a reply in their
 *                       Trainerize chat, so nothing was posted (see safeToPost). It's tried again
 *                       every morning until the chat is clear, then the tag comes off.
 *   '6wc no alcohol'    a coach ticked "Doesn't drink" on the tracker (or the tag was put on by hand).
 *                       They never get the Alcohol guide: not on Trainerize, and the Week 2 email in
 *                       GHL checks the tag and sends the copy without it.
 *
 * The guides go on as soon as a coach presses Done on the Intro (guides-now-background.js). The
 * morning run catches anyone that missed, and adds them before the email, as the email tells
 * people they're there. If one fails, that person gets no email and the next morning carries on
 * from the guide it stopped at.
 *
 * The first email goes the morning after a coach presses Done on their Intro. The rest run from
 * the start date.
 *
 * Skipped: Intro not done, paused or left. Joined people skip only the sign-up emails.
 *
 * Someone whose membership payment came in DURING their challenge is written to the 'challenge-flags' row so the tracker gives the coach a task
 * to move their next payment in GHL. Only this job writes that row.
 *
 * SAFE BY DEFAULT. Nothing is written unless CHALLENGE_LIVE=1 and the request is not a dry run.
 * Nobody whose clock started before CHALLENGE_FROM (YYYY-MM-DD) is touched, so people already
 * part way through don't get a run of old emails.
 *
 * ENVIRONMENT VARIABLES: SUPABASE_URL, SUPABASE_SERVICE_KEY, WEBHOOK_SECRET, GHL_TOKEN,
 * TRAINERIZE_GROUP_ID, TRAINERIZE_API_ACCESS, CHALLENGE_LIVE, CHALLENGE_FROM
 */

const MS_DAY = 86400000;
const EMAIL_DAYS = [0, 2, 7, 14, 21, 28, 35, 37, 39, 41];
const SIGN_UP_DAYS = [37, 39, 41];   // the "join here" emails: nobody who has joined gets these
const LAPSE_AFTER = 7;
const GHL = 'https://services.leadconnectorhq.com';
const LOCATION = process.env.GHL_LOCATION_ID || 'I88mpb966qBRVCCDbEx5';
const TZ_API = 'https://api.trainerize.com/v03';
const GUIDE_FAILED = '6wc guide failed';
const GUIDE_HELD = '6wc guide held';
const NO_ALCOHOL = '6wc no alcohol';
const ALCOHOL = '6wc guide alcohol';
const GUIDES = [
  { tag: '6wc guide welcome', name: 'Bodysculpt Welcome Guide.pdf', path: 'guides/Bodysculpt-Welcome-Guide.pdf' },
  { tag: '6wc guide nutracheck', name: 'Bodysculpt Nutracheck Guide.pdf', path: 'guides/Bodysculpt-Nutracheck-Guide.pdf' },
  { tag: '6wc guide myfitnesspal', name: 'Bodysculpt MyFitnessPal Guide.pdf', path: 'guides/Bodysculpt-MyFitnessPal-Guide.pdf' },
];
/* The weekly nutrition guides, posted on Trainerize from Bodysculpt Support with the PDF in the chat. They go on
   Thursdays (Dan's check-ins run Monday to Wednesday), Alcohol on the Friday of week 2 so it lands
   before the weekend. Week = the challenge week from the tracker's clock. A Thursday or Friday run
   sends anything due and not yet sent, so someone who missed one catches up. The words are Ash's,
   from his 6WC Nutrition Guides page. The same guide is attached to that week's email. */
const THU = 4, FRI = 5;
const weekly = (key, label, week, day, video, text) => ({
  tag: '6wc guide ' + key, label, week, day, video, text,
  name: `Bodysculpt ${label}.pdf`, path: `guides/Bodysculpt-${label.replace(/ /g, '-')}.pdf`,
});
const WEEKLY = [
  weekly('nutrition basics', 'Nutrition Basics', 1, THU, 'https://vimeo.com/991551296', (n, l) => `Hi ${n}, hope the legs are recovering 😬 Food is the part that makes the biggest difference to your results, and it's also the part most people overcomplicate, so we keep it to three simple rules. The guide attached walks you through them, and if you'd rather watch, the video's here: ${l}\n\nWhich of the three do you think you'll find hardest?`),
  weekly('calories', 'Calories', 1, THU, 'https://vimeo.com/991551409', (n, l) => `Hi ${n}, now you've started tracking you've probably got a number on the Nutrition tab staring back at you, so this guide explains what it means and why we've set yours where it is. The video's here if you'd rather watch: ${l}\n\nIf you've ever felt like you eat well but still can't shift the weight, this one will make a lot of sense. How are you getting on with the tracking so far?`),
  weekly('protein', 'Protein', 2, THU, 'https://vimeo.com/427320328', (n, l) => `Hi ${n}, protein is the target most people find hardest to hit in the first couple of weeks, and it's the one that keeps you full and protects your muscle while you lose fat, so I've attached a guide on it. The video's here: ${l}\n\nIf you're getting hungry between meals or coming in well under your number, give it a read. What's your go-to protein at the minute? Mine's Greek yoghurt, and the amount I get through is borderline worrying 🤣`),
  weekly('meal planning', 'Meal Planning', 2, THU, 'https://vimeo.com/427320963', (n, l) => `Hi ${n}, one more for this week. Planning your week makes hitting your targets so much easier, and it doesn't mean losing your whole Sunday to Tupperware. The guide attached has six simple steps, and the video's here: ${l}\n\nIf the busy days are where things fall apart, or you're getting to tea time with loads of protein still to hit, this one will help. Which day of the week is usually your hardest?`),
  weekly('alcohol', 'Alcohol', 2, FRI, 'https://vimeo.com/427323509', (n, l) => `Hi ${n}, with the weekend coming up, here's one on alcohol. You don't need to give it up to get results on the challenge, you just need to plan for it, and the guide shows you which drinks to pick and how to fit them into your week. The video's here: ${l}\n\nGot anything on this weekend? 😊`),
  weekly('neat', 'NEAT', 3, THU, 'https://vimeo.com/991551602', (n, l) => `Hi ${n}, this week's guide is about steps. The time you spend outside the gym burns far more calories than your sessions do, so moving a bit more means you can eat a bit more and still lose fat. The guide's attached, and the video's here: ${l}\n\nIf your calories feel a bit tight, or you sit down for most of the day, it's worth a read. Roughly how many steps are you getting at the minute?`),
  weekly('food environments', 'Food Environments', 3, THU, 'https://vimeo.com/392984248', (n, l) => `Hi ${n}, willpower tends to run out by the end of the day, so it's much easier to set your kitchen and your desk up so the good choice is the easy one. That's what this guide covers, and the video's here: ${l}\n\nIf the evenings or the biscuit tin at work are where you tend to slip, this one's for you. Where's your danger zone, the kitchen or work? 🤣`),
  weekly('under reporting', 'Under Reporting', 4, THU, 'https://vimeo.com/991554964', (n, l) => `Hi ${n}, around now a lot of people feel like they're doing everything right but the scales have slowed down, and it's nearly always the little bits that don't get logged, like the splash of milk or the kids' leftovers. This guide goes through it, and the video's here: ${l}\n\nIf you've ever said "I don't eat that much", you're in very good company. How's the tracking been this week?`),
  weekly('calorie density', 'Calorie Density', 5, THU, 'https://vimeo.com/992070680', (n, l) => `Hi ${n}, by now your calories might be feeling a bit tighter, and choosing foods that fill you up for fewer calories makes a big difference. That's calorie density, and this guide shows you how to do it. The video's here: ${l}\n\nIf you're hungry a lot of the time, give this one a read. Which meal leaves you the hungriest?`),
  weekly('habits', 'Habits', 6, THU, 'https://vimeo.com/389514381', (n, l) => `Hi ${n}, with the challenge coming to an end, here's one on habits, because the plan is to keep your results long after the six weeks. The guide shows you how to build small habits that stick, and the video's here: ${l}\n\nIf you're worried about slipping back into old ways when the challenge finishes, have a read, and if you can see yourself staying with us long term, we'd love to keep helping. Which habit from the last six weeks are you keeping? 💪🏻`),
];
/* Which weekly guides go today: Thursday sends the Thursday ones, Friday sends anything still due.
   Not on day 0 (they've just had the three welcome guides), and not after the six weeks.
   Someone with a held guide is tried every morning, for what was due at the last Friday run. */
function weeklyDue(m, tags, t0, day) {
  if (!m.firstSessionDone || !m.day0 || day === null || day >= totalDays(m)) return [];
  const wd = new Date(t0).getUTCDay();
  let asOf = day, friday = wd === FRI;
  if (wd !== THU && wd !== FRI) {
    if (!tags.includes(GUIDE_HELD)) return [];
    asOf = day - ((wd - FRI + 7) % 7); friday = true;
  }
  if (asOf < 1) return [];
  const week = Math.min(6, Math.floor(asOf / 7) + 1);
  return WEEKLY.filter((g) => !tags.includes(g.tag) && g.week <= week && (friday || g.day === THU)
    && !(g.tag === ALCOHOL && tags.includes(NO_ALCOHOL)));
}

/* Is it safe to drop an automated post into this chat, or might the client be waiting on a reply?
   Trainerize won't let this job read the messages. All it gives is: how many messages each side
   hasn't opened, when the last message was sent, and its first line. So:
     hold  the coaches have a message they haven't opened
     send  nothing has been said since our own last post
     send  the client has a coach message they haven't opened (so a coach spoke last)
     hold  can't tell who spoke last, and the last message is a question from the last 3 days
     hold  can't tell who spoke last, and it was in the last 24 hours
     send  otherwise
   Pure, so it can be tested. Times are in ms. */
const HOLD_RECENT = MS_DAY, HOLD_QUESTION = 3 * MS_DAY, OWN_POST_SLACK = 5 * 60000;
function safeToPost({ last, excerpt, coachUnread, clientUnread, lastPost, now }) {
  if (coachUnread > 0) return { ok: false, why: 'a message from them has not been opened' };
  if (!last) return { ok: true };
  if (lastPost && last <= lastPost + OWN_POST_SLACK) return { ok: true };
  if (clientUnread > 0) return { ok: true };
  const age = now - last;
  if (/\?/.test(excerpt || '') && age < HOLD_QUESTION) return { ok: false, why: 'the last message in the chat is a question' };
  if (age < HOLD_RECENT) return { ok: false, why: 'the chat has been active in the last day' };
  return { ok: true };
}

const norm = (s) => String(s == null ? '' : s).trim().toLowerCase();

/* Midnight today in Warrington, as the tracker's today0() sees it. */
function today0(now = new Date()) {
  const d = new Date(now.toLocaleString('en-GB', { timeZone: 'Europe/London', hour12: false }).replace(/(\d+)\/(\d+)\/(\d+),.*/, '$3-$2-$1') + 'T00:00:00Z');
  return d.getTime();
}
/* Stored dates are local midnights, so round to the nearest day when comparing with UTC.
   The clock runs from day0 once it's started, or from the booked first session until then.
   Null means no date yet; a date still to come gives a negative day. */
function currentDay(m, t0) {
  const start = m.day0 || m.booked;
  if (!start) return null;
  let e = Math.round((t0 - start) / MS_DAY);
  e -= m.pausedDays || 0;
  if (m.pausedAt) e -= Math.round((t0 - m.pausedAt) / MS_DAY);
  return e;
}
const introDone = (m) => (m.completed || []).includes('intro') || !!m.firstSessionDone;
const totalDays = (m) => 42 + (m.extraDays || 0);

/* What this person is due today. Pure, so it can be tested without the outside world. */
function plan(m, tags, t0, fromMs) {
  if (!norm(m.email) || m.outcome === 'left' || m.pausedAt) return { skip: 'not eligible' };
  if (!introDone(m)) return { skip: 'intro not done' };
  const day = currentDay(m, t0);
  const start = m.day0 || m.booked;
  if (fromMs && start && start < fromMs - MS_DAY / 2) return { skip: 'started before launch' };
  const has = (t) => tags.includes(t);
  const paid = has('members') || has('member');
  const joined = paid || m.outcome === 'stayed';
  const add = [];
  let lapse = false;
  const remove = [];
  if (joined && !has('6wc joined')) add.push('6wc joined');   // first, so it's on before that day's email
  if (m.noAlcohol && !has(NO_ALCOHOL)) add.push(NO_ALCOHOL);   // the same: on before the Week 2 email
  {
    const sent = tags.map((t) => /^6wc day (\d+)$/.exec(t)).filter(Boolean).map((x) => Number(x[1]));
    const last = sent.length ? Math.max(...sent) : -1;
    const days = joined ? EMAIL_DAYS.filter((d) => !SIGN_UP_DAYS.includes(d)) : EMAIL_DAYS;
    const due = days.find((d) => d > last && (d === 0 || (day !== null && day >= d)));   // Day 0 goes on the Intro being done; the next unsent, one a day
    if (due !== undefined) {
      add.push('6wc day ' + due);
      sent.forEach((d) => remove.push('6wc day ' + d));
    }
  }
  const running = !!m.firstSessionDone && !!m.day0;
  const ended = running && day >= totalDays(m);
  if (ended && !has('6wc finished')) add.push('6wc finished');
  /* Membership starts the day the challenge ends, or on the date a coach typed on the tracker. */
  const startDue = m.memberStart ? t0 >= m.memberStart - MS_DAY / 2 : ended;
  if (joined && startDue && !has('member start')) add.push('member start');
  /* A membership payment came in before their challenge ended, so the coach needs to move their
     next payment. Whether or not a coach has also tapped Stayed on. Someone a coach signs up has
     their first payment on the end date, so they never show here. */
  const paidMidChallenge = paid && !ended;
  if (running && !joined && day >= totalDays(m) + LAPSE_AFTER && !has('6wc lapsed')) { add.push('6wc lapsed'); if (!has('email list')) add.push('email list'); lapse = true; }
  return { day, add, remove, lapse, paidMidChallenge, guides: GUIDES.filter((g) => !has(g.tag)), weekly: weeklyDue(m, m.noAlcohol ? [...tags, NO_ALCOHOL] : tags, t0, day) };
}

async function json(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  if (!res.ok) throw new Error(`${url.split('?')[0]} ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}
const ghlHeaders = () => ({
  Authorization: 'Bearer ' + (process.env.GHL_TOKEN || '').trim(),
  Version: '2021-07-28', 'Content-Type': 'application/json', Accept: 'application/json',
});
async function findContact(email) {
  const q = `${GHL}/contacts/?locationId=${encodeURIComponent(LOCATION)}&query=${encodeURIComponent(email)}&limit=20`;
  const r = await json(q, { headers: ghlHeaders() });
  return (r.contacts || []).find((c) => norm(c.email) === norm(email)) || null;
}
/* Everyone in GHL with a tag. GHL pages its search at 100. */
async function contactsWithTag(tag) {
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const r = await json(`${GHL}/contacts/search`, { method: 'POST', headers: ghlHeaders(), body: JSON.stringify({ locationId: LOCATION, page, pageLimit: 100, filters: [{ field: 'tags', operator: 'contains', value: [tag] }] }) });
    const got = r.contacts || [];
    out.push(...got);
    if (got.length < 100) break;
  }
  return out;
}
/* Someone has paid for a membership ('members'). Should their membership start now?
   'wait' while they're still on a challenge on the tracker (their end date adds it instead, in
   plan()), 'start' for anyone else: they joined straight off the website, or their challenge is over. */
function startDecision(c, m, t0) {
  const tags = (c.tags || []).map(norm);
  if (tags.includes('member start')) return 'done';
  if (!m || m.outcome === 'left') return 'start';
  if (m.memberStart) return t0 >= m.memberStart - MS_DAY / 2 ? 'start' : 'wait';
  if (!m.firstSessionDone || !m.day0 || m.pausedAt) return 'wait';
  const day = currentDay(m, t0);
  return day >= totalDays(m) ? 'start' : 'wait';
}
async function addTags(id, tags) {
  return json(`${GHL}/contacts/${id}/tags`, { method: 'POST', headers: ghlHeaders(), body: JSON.stringify({ tags }) });
}
async function removeTags(id, tags) {
  return json(`${GHL}/contacts/${id}/tags`, { method: 'DELETE', headers: ghlHeaders(), body: JSON.stringify({ tags }) });
}
function tzAuth() {
  const token = process.env.TRAINERIZE_API_TOKEN || process.env.TRAINERIZE_API_ACCESS;
  return 'Basic ' + Buffer.from(`${process.env.TRAINERIZE_GROUP_ID}:${token}`).toString('base64');
}
const tzHeaders = () => ({ 'Content-Type': 'application/json', Authorization: tzAuth() });
async function findTrainerize(email) {
  const r = await json(TZ_API + '/user/find', { method: 'POST', headers: tzHeaders(), body: JSON.stringify({ searchTerm: email, view: 'allClient', start: 0, count: 10 }) });
  return (r.users || []).find((x) => norm(x.email) === norm(email)) || null;
}
async function deactivateTrainerize(email) {
  const u = await findTrainerize(email);
  if (!u) return 'not on Trainerize';
  await json(TZ_API + '/user/setStatus', { method: 'POST', headers: tzHeaders(), body: JSON.stringify({ userID: u.id, accountStatus: 'deactivated' }) });
  return 'deactivated';
}
/* The guides go to the client as a Trainerize message from Bodysculpt Support, with the PDFs attached in that chat.
   (Profile attachments are coach-only: clients can't see them.) */
/* Sent from the Bodysculpt Support account (not Ash), so every coach sees the replies. */
const SENDER_TZ = 2920561;
const guidesText = (first) => `Hi ${first || 'there'}, here are your Bodysculpt guides \u{1F60A} The Welcome Guide walks you through your six weeks, and there's one each for Nutracheck and MyFitnessPal to help with your food tracking. Save them somewhere handy, and if anything's unclear just give us a shout.\n\nAsh`;
async function sendGuidesMessage(u, text = guidesText(u.firstName)) {
  const r = await json(TZ_API + '/message/send', { method: 'POST', headers: tzHeaders(), body: JSON.stringify({
    userID: SENDER_TZ, recipients: [u.id], body: text, threadType: 'mainThread', type: 'text', subject: 'Main', conversationType: 'single' }) });
  const thread = r.threadIDs && r.threadIDs[0];
  if (!thread) throw new Error(`guides message not sent: ${JSON.stringify(r).slice(0, 200)}`);
  return thread;
}
/* Posts one guide PDF into that chat. The PDFs are served by this site. */
async function uploadGuide(threadID, guide) {
  const pdf = await fetch(`${process.env.URL}/${guide.path}`);
  if (!pdf.ok) throw new Error(`${guide.path} ${pdf.status}`);
  const form = new FormData();
  form.append('data', JSON.stringify({ attachTo: threadID, attachType: 'messageAttachment', notes: '', userID: SENDER_TZ }));
  form.append('file0', new Blob([await pdf.arrayBuffer()], { type: 'application/pdf' }), guide.name);
  const r = await json(TZ_API + '/file/upload', { method: 'POST', headers: { Authorization: tzAuth() }, body: form });
  if (!r.id && !r.messageID) throw new Error(`${guide.name} not added: ${JSON.stringify(r).slice(0, 200)}`);
}
/* Trainerize times are UTC, like "2026-11-13 08:01:10". */
const tzTime = (t) => (t ? Date.parse(String(t).replace(' ', 'T') + 'Z') : 0);
const tzThreads = async (userID, start, count) => (await json(TZ_API + '/message/getThreads', { method: 'POST', headers: tzHeaders(),
  body: JSON.stringify({ userID, view: 'inbox', start, count }) })).threads || [];
/* What this job can see of the client's chat with the coaches: see safeToPost. The coaches' inbox
   is newest first, so the search stops once it's past this chat's last message. */
async function chatState(u) {
  const mine = (await tzThreads(u.id, 0, 30)).filter((t) => t.threadType === 'mainThread')
    .sort((a, b) => tzTime(b.lastSentTime) - tzTime(a.lastSentTime))[0];
  if (!mine) return { last: 0 };
  const last = tzTime(mine.lastSentTime);
  let coachUnread = 0;
  for (let start = 0; start < 1000; start += 100) {
    const page = await tzThreads(SENDER_TZ, start, 100);
    const t = page.find((x) => x.threadID === mine.threadID);
    if (t) { coachUnread = t.totalUnreadMessages || (t.unread ? 1 : 0); break; }
    if (page.length < 100 || tzTime(page[page.length - 1].lastSentTime) < last) break;
  }
  return { last, excerpt: mine.excerpt || '', clientUnread: mine.totalUnreadMessages || 0, coachUnread };
}
/* When this job last posted in each client's chat, by Trainerize ID, so its own posts never look
   like the client talking. Kept in the 'guide-posts' row. */
const POSTS_KEY = 'guide-posts';
async function readRow(k) {
  const key = process.env.SUPABASE_SERVICE_KEY;
  const rows = await json(`${process.env.SUPABASE_URL}/rest/v1/bodysculpt?key=eq.${k}&select=value`, { headers: { apikey: key, Authorization: 'Bearer ' + key } });
  const v = rows[0] && rows[0].value;
  return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
}
async function writeRow(k, value) {
  const key = process.env.SUPABASE_SERVICE_KEY;
  await json(`${process.env.SUPABASE_URL}/rest/v1/bodysculpt`, {
    method: 'POST',
    headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ key: k, value, updated_at: new Date().toISOString() }),
  });
}
/* Never fails a send: the worst a missed note does is hold the next guide for a day. */
async function notePost(u) {
  try { const posts = await readRow(POSTS_KEY); posts[u.id] = Date.now(); await writeRow(POSTS_KEY, posts); } catch (e) { console.log('NOTE POST ' + e.message); }
}
/* Guides first: the tag goes on after each one, so a failure part way picks up where it stopped. */
async function addGuides(email, contact, guides) {
  if (!guides.length) return;
  const failedBefore = (contact.tags || []).map(norm).includes(GUIDE_FAILED);
  try {
    const u = await findTrainerize(email);
    if (!u) throw new Error('not on Trainerize, so no guides or email today');
    const thread = await sendGuidesMessage(u);
    for (const g of guides) {
      await uploadGuide(thread, g);
      await addTags(contact.id, [g.tag]);
    }
    await notePost(u);
    if (failedBefore) await removeTags(contact.id, [GUIDE_FAILED]);
  } catch (e) {
    if (!failedBefore) await addTags(contact.id, [GUIDE_FAILED]).catch(() => {});   // one text, not one a day
    throw e;
  }
}
/* Weekly guides: the message for that guide, then its PDF in the same chat, then the tag.
   One message per guide, in order, so a failure part way picks up at the next run.
   Nothing is posted over a client who may be waiting on a reply: the guide is held, tagged, and
   tried again each morning. Returns why it was held, or null if the guides went. */
async function addWeekly(email, contact, list) {
  if (!list.length) return null;
  const tags = (contact.tags || []).map(norm);
  const failedBefore = tags.includes(GUIDE_FAILED);
  let held = null;
  try {
    const u = await findTrainerize(email);
    if (!u) throw new Error('not on Trainerize, so no weekly guide');
    const chat = await chatState(u);
    const lastPost = (await readRow(POSTS_KEY))[u.id] || 0;
    const safe = safeToPost({ ...chat, lastPost, now: Date.now() });
    if (!safe.ok) held = safe.why;
    else {
      for (const g of list) {
        const thread = await sendGuidesMessage(u, g.text(u.firstName || 'there', g.video));
        await uploadGuide(thread, g);
        await addTags(contact.id, [g.tag]);
        await notePost(u);
      }
    }
    if (failedBefore) await removeTags(contact.id, [GUIDE_FAILED]);
  } catch (e) {
    if (!failedBefore) await addTags(contact.id, [GUIDE_FAILED]).catch(() => {});
    throw e;
  }
  if (held && !tags.includes(GUIDE_HELD)) await addTags(contact.id, [GUIDE_HELD]);
  if (!held && tags.includes(GUIDE_HELD)) await removeTags(contact.id, [GUIDE_HELD]);
  return held;
}
/* A test run of one weekly guide on one person: sends it and sets no tags. */
async function testWeekly(email, label) {
  const g = WEEKLY.find((x) => norm(x.label) === norm(label));
  if (!g) throw new Error('no weekly guide called ' + label);
  const u = await findTrainerize(email);
  if (!u) throw new Error('not on Trainerize');
  const thread = await sendGuidesMessage(u, g.text(u.firstName || 'there', g.video));
  await uploadGuide(thread, g);
  return { userID: u.id, threadID: thread, sent: g.label };
}
/* A coach has just pressed Done on this person's Intro. Anyone can call this, as all it can ever
   do is what the morning run would have done anyway: the roster and the tags decide. */
async function guidesNow(id) {
  if (process.env.CHALLENGE_LIVE !== '1') return 'not live';
  const fromMs = process.env.CHALLENGE_FROM ? Date.parse(process.env.CHALLENGE_FROM + 'T00:00:00Z') : null;
  const t0 = today0();
  const m = (await roster()).find((x) => x.id === id);
  if (!m) return 'not on the roster';
  const pre = plan(m, [], t0, fromMs);
  if (pre.skip) return pre.skip;
  const c = await findContact(m.email);
  if (!c) throw new Error(`no GHL contact for ${m.name}`);
  const p = plan(m, (c.tags || []).map(norm), t0, fromMs);
  await addGuides(m.email, c, p.guides);
  return `${p.guides.length} added`;
}
/* A test run on one person: adds all the guides and sets no tags. */
async function testGuides(email) {
  const u = await findTrainerize(email);
  if (!u) throw new Error('not on Trainerize');
  const thread = await sendGuidesMessage(u);
  for (const g of GUIDES) await uploadGuide(thread, g);
  return { userID: u.id, threadID: thread, added: GUIDES.length };
}
async function roster() {
  const url = `${process.env.SUPABASE_URL}/rest/v1/bodysculpt?key=eq.roster&select=value`;
  const key = process.env.SUPABASE_SERVICE_KEY;
  const rows = await json(url, { headers: { apikey: key, Authorization: 'Bearer ' + key } });
  return (rows[0] && Array.isArray(rows[0].value)) ? rows[0].value : [];
}

const FLAGS_KEY = 'challenge-flags';
async function readFlags() {
  const url = `${process.env.SUPABASE_URL}/rest/v1/bodysculpt?key=eq.${FLAGS_KEY}&select=value`;
  const key = process.env.SUPABASE_SERVICE_KEY;
  const rows = await json(url, { headers: { apikey: key, Authorization: 'Bearer ' + key } });
  const v = rows[0] && rows[0].value;
  return (v && typeof v === 'object' && !Array.isArray(v)) ? v : {};
}
async function writeFlags(value) {
  const key = process.env.SUPABASE_SERVICE_KEY;
  await json(`${process.env.SUPABASE_URL}/rest/v1/bodysculpt`, {
    method: 'POST',
    headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ key: FLAGS_KEY, value, updated_at: new Date().toISOString() }),
  });
}

async function run({ dryRun }) {
  const live = process.env.CHALLENGE_LIVE === '1' && !dryRun;
  const fromMs = process.env.CHALLENGE_FROM ? Date.parse(process.env.CHALLENGE_FROM + 'T00:00:00Z') : null;
  const t0 = today0();
  const report = { live, checked: 0, actions: [], errors: [], flagged: [], held: [] };
  const flags = await readFlags();
  let flagsChanged = false;
  for (const m of await roster()) {
    const pre = plan(m, [], t0, fromMs);
    if (pre.skip) continue;
    report.checked++;
    try {
      const c = await findContact(m.email);
      if (!c) { report.errors.push(`no GHL contact for ${m.name}`); continue; }
      const p = plan(m, (c.tags || []).map(norm), t0, fromMs);
      if (p.paidMidChallenge && !(flags[m.id] && flags[m.id].paid)) {
        flags[m.id] = { paid: true, seen: new Date(t0).toISOString().slice(0, 10) };
        flagsChanged = true;
        report.flagged.push(m.name);
      }
      if (!p.add.length && !p.guides.length && !p.weekly.length) continue;
      if (live) {
        await addGuides(m.email, c, p.guides);
        /* A weekly guide that fails never holds up the email: it's retried at the next run. */
        try {
          const why = await addWeekly(m.email, c, p.weekly);
          if (why) report.held.push(`${m.name}: ${why}`);
        } catch (e) { report.errors.push(`${m.name} weekly guide: ${e.message}`); }
        if (p.lapse) await deactivateTrainerize(m.email);
        if (p.add.length) await addTags(c.id, p.add);
        if (p.remove.length) await removeTags(c.id, p.remove);
      }
      report.actions.push({ name: m.name, day: p.day, add: p.add, guides: p.guides.map((g) => g.tag), weekly: p.weekly.map((g) => g.tag) });
    } catch (e) {
      report.errors.push(`${m.name}: ${e.message}`);
    }
  }
  if (live && flagsChanged) await writeFlags(flags);
  /* startSweep: 'member start' for everyone who has paid and isn't waiting on a challenge. */
  report.started = []; report.waiting = [];
  try {
    const list = await roster();
    for (const c of await contactsWithTag('members')) {
      const m = list.find((x) => norm(x.email) && norm(x.email) === norm(c.email));
      const d = startDecision(c, m, t0);
      const who = [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email;
      if (d === 'wait') report.waiting.push(who);
      if (d !== 'start') continue;
      if (live) await addTags(c.id, ['member start']);
      report.started.push(who);
    }
  } catch (e) {
    report.errors.push('start sweep: ' + e.message);
  }
  console.log('TICK ' + JSON.stringify(report));
  return report;
}

exports.handler = async (event) => {
  const provided = (event.queryStringParameters && event.queryStringParameters.secret) || event.headers['x-webhook-secret'];
  if (!process.env.WEBHOOK_SECRET || provided !== process.env.WEBHOOK_SECRET) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
  }
  const dryRun = (event.queryStringParameters || {}).dry_run !== '0';
  try {
    // ?check=<email>: confirm the GHL token works and show that contact's 6WC tags. Reads only.
    const check = (event.queryStringParameters || {}).check;
    if (check) {
      const c = await findContact(check);
      return { statusCode: 200, body: JSON.stringify({ found: !!c, tags: c ? (c.tags || []).filter((t) => /6wc|member/i.test(t)) : [] }) };
    }
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(await run({ dryRun })) };
  } catch (e) {
    console.log('ERROR ' + e.message);
    return { statusCode: 502, body: JSON.stringify({ error: e.message }) };
  }
};
exports.run = run;
exports.plan = plan;
exports.testGuides = testGuides;
exports.testWeekly = testWeekly;
exports.WEEKLY = WEEKLY;
exports.safeToPost = safeToPost;
exports.chatState = chatState;
exports.guidesNow = guidesNow;
exports.currentDay = currentDay;
exports.startDecision = startDecision;
