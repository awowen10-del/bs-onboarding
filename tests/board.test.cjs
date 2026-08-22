// The onboarding Today's moves BOARD — the day's touchpoints laid out as columns instead of
// one long stack.
//
// It is a board in APPEARANCE only, and that is the whole point of this file. Nothing here
// drags, and the layout has never been allowed to touch a single thing about what is due: the
// same journey logic decides which touchpoints appear, the same grace window keeps them
// there, and the same two buttons resolve them.
//
// The columns are the SIX WEEKS now, with the intro sessions ahead of them, where they used to
// be the three channels — texts, postcards, moments in the room. A touchpoint's column comes
// from the day it fires and nothing else (week 1 is days 1–7, week 2 is days 8–14, …), so the
// regrouping is a re-read of numbers that were already there. Not one day moved to do it, and
// the ids underneath are the ids they always were: 'wk2' is the Week 1 check-in.
//
// So these tests are split in two. The first half is the board's SHAPE — seven named columns
// in a fixed order, each with its heading and count, empty ones still standing, including the
// week nothing has been written for yet. The second half is everything that must NOT have
// changed: the cards' content, their buttons, the OVERDUE flag, the banner and the toggle
// above the board, and the retention tracker, which was left on its stacked layout on purpose.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { boot, daysFromToday } = require("./lib/env.cjs");

const HTML = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

// a live challenger, n days into their journey
const live = (id, name, day) => ({
  id, name, coach: "Grace",
  day0: daysFromToday(-day), booked: daysFromToday(-day), firstSessionDone: true,
  completed: ["intro"], doneMeta: {}, checks: {}, missed: [],
  outcome: null, signedUp: false, extraDays: 0, pausedDays: 0, pausedAt: null,
});
// somebody whose intro has not been run yet — the one card the intro column holds
const preStart = (id, name) => ({
  id, name, coach: "Grace", booked: daysFromToday(2),
  completed: [], doneMeta: {}, checks: {}, missed: [],
  outcome: null, signedUp: false, extraDays: 0, pausedDays: 0, pausedAt: null,
});

// the board, and each column inside it, sliced out of the rendered Today's moves
function board(app) {
  const html = app.html("todayList");
  const i = html.indexOf('<div class="board">');
  return i === -1 ? "" : html.slice(i);
}
function columns(app) {
  const parts = board(app).split('<div class="board-col" data-col="');
  return parts.slice(1).map((p) => ({ id: p.slice(0, p.indexOf('"')), html: p }));
}
const column = (app, id) => (columns(app).find((c) => c.id === id) || { html: "" }).html;
const countBadge = (colHtml) => {
  const m = /<span class="gcount">(\d+)<\/span>/.exec(colHtml);
  return m ? Number(m[1]) : null;
};
const cardIds = (colHtml) => (colHtml.match(/id="act-[^"]+"/g) || []).map((s) => s.slice(4, -1));

/* ---------- 1: seven columns — the intros, then the six weeks ----------
   The intro sessions that have to be run, and then the challenge itself, one lane per week. It
   is a fixed reading order, not anything computed off the data, so the board is the same shape
   every morning — which is the whole reason a coach can scan it rather than read it. */
const WEEK_COLS = ["intro", "week1", "week2", "week3", "week4", "week5", "week6"];
{
  const app = boot({ members: [preStart("p", "Ned New"), live("a", "Sam Live", 8)] });
  assert.deepStrictEqual(columns(app).map((c) => c.id), WEEK_COLS,
    "seven columns, in a fixed order — the board's structure is not data-dependent");

  const titles = (board(app).match(/<span class="board-col-title">([^<]*)<\/span>/g) || [])
    .map((s) => s.replace(/<[^>]*>/g, ""));
  assert.deepStrictEqual(titles, [
    "Intro sessions to run",
    "Week 1", "Week 2", "Week 3", "Week 4", "Week 5", "Week 6",
  ], "…and they are named for the weeks of the challenge, not for the kind of job");

  // the channel columns are gone, headings and all
  for (const old of ["Texts & Trainerize check-ins", "Postcards, boxes & cards",
                     "Moments in the room"]) {
    assert.ok(!board(app).includes(old), "the channel column is gone: " + old);
  }

  // and the order really is fixed: an emptier day does not reshuffle it, and nor does a busy one
  const quiet = boot({ members: [live("c", "Katie Leicester", 1)] });
  assert.deepStrictEqual(columns(quiet).map((c) => c.id), WEEK_COLS,
    "…with six of the seven lanes empty, they are still in the same places");
  const busy = boot({ members: [preStart("p", "Ned New"), live("a", "Sam", 8),
    live("b", "Dee", 15), live("c", "Ell", 22), live("d", "Fay", 29), live("e", "Gus", 36)] });
  assert.deepStrictEqual(columns(busy).map((c) => c.id), WEEK_COLS,
    "…and with every lane in use, the same seven in the same order");
}

/* ---------- 2: a card lands in the week its DAY puts it in ----------
   This is the layout's only real job, and the rule is arithmetic on a number the touchpoint
   already carried: week = ceil(day / 7). Days 1–7 are week 1, 8–14 week 2, and so on. */
{
  // day 8, so everything from the first week is due and still inside its grace window
  const app = boot({ members: [preStart("p", "Ned New"), live("a", "Sam Live", 8)] });

  assert.deepStrictEqual(cardIds(column(app, "intro")), ["act-p-intro"],
    "the intro is the intro column's, and only its — it is before day zero, not in a week");
  assert.deepStrictEqual(cardIds(column(app, "week1")), ["act-a-d1_text", "act-a-wk2"],
    "the day-1 text and the day-7 check-in are week 1, in journey-day order inside the column");
  for (const empty of ["week2", "week3", "week4", "week5", "week6"]) {
    assert.deepStrictEqual(cardIds(column(app, empty)), [], empty + " holds nothing yet");
  }

  // the later check-ins land a week earlier than their old names suggested, because the name
  // was the thing that was out by one: the day-14 check-in closes week 2
  const spread = boot({ members: [
    live("b", "Dee Deep", 15), live("c", "Ell Late", 22),
    live("d", "Fay Far", 29), live("e", "Gus Gone", 36),
  ] });
  assert.deepStrictEqual(cardIds(column(spread, "week2")), ["act-b-wk3"], "day 14 → week 2");
  assert.deepStrictEqual(cardIds(column(spread, "week3")), ["act-c-wk4"], "day 21 → week 3");
  assert.deepStrictEqual(cardIds(column(spread, "week4")), ["act-d-wk5"], "day 28 → week 4");
  assert.deepStrictEqual(cardIds(column(spread, "week5")), ["act-e-wk6"], "day 35 → week 5");

  // the rule is the function, not a table somebody has to keep in step
  const J = app.ctx.__t.JOURNEY;
  const weekOf = (id) => app.ctx.journeyWeek(J.find((it) => it.id === id));
  assert.strictEqual(
    JSON.stringify(J.filter((it) => it.phase !== "intro").map((it) => [it.id, it.day, weekOf(it.id)])),
    JSON.stringify([["d1_text", 1, 1], ["wk2", 7, 1], ["wk3", 14, 2],
                    ["wk4", 21, 3], ["wk5", 28, 4], ["wk6", 35, 5]]),
    "every touchpoint's week is ceil(day/7) — and every day is exactly what it always was");
  assert.strictEqual(app.ctx.journeyWeek(J.find((it) => it.id === "intro")), 0,
    "the intro has no week");
  // nothing can fall off the board at either end
  assert.strictEqual(app.ctx.journeyWeek({ day: 0, phase: "journey" }), 1, "day 0 reads as week 1");
  assert.strictEqual(app.ctx.journeyWeek({ day: 99, phase: "journey" }), 6, "…and day 99 as week 6");

  // and no card is in two places at once
  const all = columns(app).flatMap((c) => cardIds(c.html));
  assert.strictEqual(new Set(all).size, all.length, "every due card appears exactly once");
}

/* ---------- 3: every column carries a count, and it counts its own cards ---------- */
{
  const app = boot({
    members: [preStart("p", "Ned New"), live("a", "Sam Live", 8), live("b", "Dean Major", 15)],
  });
  for (const c of columns(app)) {
    assert.strictEqual(countBadge(c.html), cardIds(c.html).length,
      c.id + ": the badge counts the cards actually in the column");
  }
  // and the tab badge is still the whole day, not one column of it
  const total = columns(app).reduce((n, c) => n + cardIds(c.html).length, 0);
  assert.strictEqual(app.el("todayCount").textContent, String(total),
    "the tab badge is the sum of the board — the layout did not change what is counted");
}

/* ---------- 4: an empty column stands there and says so ----------
   A board that drops a column on a quiet day stops reading as a board, and the coach loses the
   one thing the layout is for: seeing at a glance which weeks are handled and which are not.

   Week 6 is the interesting one. It has no touchpoint in JOURNEY at all — the end-of-challenge
   review that will live there has not been written — so it says something slightly different
   from a week that simply has nothing due today, and it says it every day. */
{
  const app = boot({ members: [live("c", "Katie Leicester", 1)] });   // a day-1 text, nothing else
  assert.strictEqual(columns(app).length, 7, "all seven columns are still on the board");
  assert.strictEqual(countBadge(column(app, "week1")), 1, "the one due card is in week 1");
  for (const id of ["intro", "week2", "week3", "week4", "week5", "week6"]) {
    assert.strictEqual(countBadge(column(app, id)), 0, id + ": nothing due");
    assert.ok(/<div class="board-empty">/.test(column(app, id)),
      id + ": an empty column shows its quiet state rather than collapsing");
  }
  assert.ok(!/board-empty/.test(column(app, "week1")), "…and a column with work in it does not");

  // a quiet week and an unwritten week do not say the same thing
  for (const id of ["intro", "week2", "week3", "week4", "week5"]) {
    assert.ok(/<div class="board-empty">Nothing here today<\/div>/.test(column(app, id)),
      id + ": a lane with touchpoints in it is merely quiet today");
  }
  assert.ok(/<div class="board-empty">Nothing here yet<\/div>/.test(column(app, "week6")),
    "week 6 has nothing in the journey to be quiet about — it says “yet”");

  // and that is read off JOURNEY, not written down, so the day a touchpoint is added to week 6
  // the column starts speaking like every other
  const J = app.ctx.__t.JOURNEY;
  assert.ok(!J.some((it) => app.ctx.journeyWeek(it) === 6),
    "sanity: nothing in the journey falls in week 6 today");
  assert.strictEqual(app.ctx.weekHasTouchpoints(6), false, "…which is what the column asks");
  for (const w of [1, 2, 3, 4, 5]) {
    assert.strictEqual(app.ctx.weekHasTouchpoints(w), true, "week " + w + " has work defined");
  }
}

/* ---------- 5: a completely clear day is still "All caught up", not an empty board ----------
   The empty-column state is for a column with nothing in it. A day with nothing in it at all
   already had an answer, and it is a better one than seven empty wells. */
{
  const app = boot({ members: [] });
  assert.ok(app.html("todayList").includes("All caught up"), "the clear-day message is unchanged");
  assert.strictEqual(board(app), "", "…and no board is drawn behind it");
}

/* ---------- 6: what a card carries ----------
   Everything the card is for, and nothing it is not. The channel CHIP is gone and stays gone —
   it was telling a team that knows a postcard from a text something they knew — but the channel
   is still on the card as its class, because that is what colours the stripe down its left
   edge. The columns no longer say it, which makes the stripe the only place it is said. */
{
  const app = boot({ members: [live("a", "Sam Live", 8)] });
  const card = /<div class="action digital" id="act-a-wk2"[\s\S]*?(?=<div class="action|<\/div><\/div>|$)/
    .exec(column(app, "week1"))[0];

  assert.ok(/<span class="status-day">Day 8<\/span>/.test(card), "the day label is on the card");
  assert.ok(/<span class="nm">Sam Live<\/span>/.test(card), "…as is the challenger's name");
  assert.ok(/<span class="ttl">Week 1 check-in<\/span>/.test(card),
    "…and the touchpoint's title, which is what the day-7 check-in is called now");
  assert.ok(!/Start of Week 2 check-in/.test(board(app)),
    "…the old name is nowhere on the board");
  assert.ok(/toggleDone\('a','wk2',true\)/.test(card), "Done is still wired to the real handler");
  assert.ok(/markMissed\('a','wk2'\)/.test(card), "…and Missed to its own");
  assert.ok(/toggleExpand\('a','wk2'\)/.test(card), "…and the card still expands");
  assert.ok(/class="chev"/.test(card), "…the expand chevron is still there to expand it with");
  assert.ok(/class="notes-btn/.test(card), "…and it still carries the notes icon");

  // the chip is gone from every card on the board, not just this one
  assert.ok(!/class="ch /.test(board(app)),
    "no card spells its channel out in a chip any more");
  for (const word of ["Digital", "Physical", "In person"]) {
    assert.ok(!board(app).includes(">" + word + "<"),
      "…so “" + word + "” is not printed on the board at all");
  }
  // …but the class that colours the left edge stays
  assert.ok(/<div class="action digital" id="act-a-wk2"/.test(card),
    "the channel still rides on the card's own class, which is what draws its colour stripe");
}

/* ---------- 6b: the pre-start day label says what it means ----------
   "Pre-start" was shorthand only the tracker used. The card now says the thing a coach would
   say out loud. */
{
  const app = boot({ members: [preStart("p", "Ned New")] });
  const card = column(app, "intro");
  assert.ok(/<span class="status-day">Not started yet<\/span>/.test(card),
    "an intro card's day label reads “Not started yet”");
  assert.ok(!/Pre-start/.test(app.html("todayList")), "…and “Pre-start” is gone from Today");
  // nothing to be late for before the clock starts, so it never picks up the red half
  assert.ok(!/status-sep|overdue/.test(card), "…and an unstarted card carries no overdue half");

  // a dated touchpoint still counts days as it always did
  const dated = boot({ members: [live("a", "Sam Live", 8)] });
  assert.ok(/<span class="status-day">Day 8<\/span>/.test(column(dated, "week1")),
    "the relabel did not touch the dated cards");
}

/* ---------- 6c: the day label lives in the status line, and only there ----------
   It used to be a pill beside the touchpoint title, with Overdue up in the corner — two places
   to look to answer one question. The pill is gone and the day has moved up to join it. */
{
  const app = boot({ members: [live("a", "Sam Live", 8), preStart("p", "Ned New")] });
  const brd = board(app);

  // the day is inside the corner status line…
  assert.ok(/<span class="card-status">\s*<span class="status-day">Day 8<\/span>/.test(brd),
    "the day label opens the card's status line");
  // …and the old pill beside the title is gone from every card on the board
  assert.ok(!/<span class="day">/.test(brd),
    "no board card still carries the day pill next to its title");
  const bodyOf = (id) => /<div class="who">([\s\S]*?)<\/div>/.exec(
    new RegExp('id="' + id + '"[\\s\\S]*').exec(brd)[0])[1];
  for (const id of ["act-a-wk2", "act-p-intro"]) {
    assert.ok(!/Day |Not started yet/.test(bodyOf(id)),
      id + ": the name-and-title block says nothing about the day any more");
  }

  // the pill class itself is untouched — the standing rows above the board still use it, and
  // this change had no business reaching them
  const standing = boot({ members: [{ ...preStart("w", "Priya R"), completed: ["intro"] }] });
  const above = standing.html("todayList");
  const before = above.slice(0, above.indexOf('<div class="board">'));
  assert.ok(/Waiting on a first session/.test(before), "sanity: the waiting row is rendered");
  assert.ok(/<span class="day">/.test(before),
    "the waiting-to-start row above the board keeps its own day pill");
  assert.ok(!/status-day/.test(before), "…and none of the status-line treatment leaked into it");
}

/* ---------- 7: OVERDUE, in the card's corner ----------
   Spotting the late one inside its column is the reason to look at the board at all. The flag
   used to sit in the run of chips beside the day label, where it read as one more pill; it now
   lives in the card's top rail with the chevron, as the only red on the card.

   Two things are asserted, and the second is the one that matters: that it moved, and that it
   still only appears on cards that are actually late. */
{
  // day 8 with nothing marked: the day-1 text and the day-7 pair are all past their day
  const app = boot({ members: [live("a", "Sam Live", 8), live("c", "Katie Leicester", 1)] });
  const slice = (col, id) =>
    new RegExp('<div class="action [a-z]+" id="' + id + '"[\\s\\S]*?(?=<div class="action|$)')
      .exec(column(app, col))[0];

  const late = slice("week1", "act-a-d1_text");
  assert.ok(/<span class="overdue-flag">Overdue<\/span>/.test(late),
    "a touchpoint whose day has passed is flagged inside its column");
  // the whole status line, in one piece: day, hairline, Overdue — in that order
  assert.ok(/<span class="card-status">\s*<span class="status-day">Day 8<\/span>\s*<span class="status-sep"[^>]*><\/span><span class="overdue-flag">Overdue<\/span>\s*<\/span>/.test(late),
    "the late card's status line reads day, then a divider, then Overdue — one line, one order");
  assert.ok(late.indexOf("card-status") < late.indexOf('class="who"'),
    "…in the top rail, above the name, rather than beside the title");

  const onTime = slice("week1", "act-c-d1_text");
  assert.ok(!/overdue/.test(onTime), "a touchpoint due today carries no flag at all");
  assert.ok(!/status-sep/.test(onTime),
    "…and no divider either — on time, the status line is just the day on its own");
  assert.ok(/<span class="card-status">\s*<span class="status-day">Day 1<\/span>\s*<\/span>/.test(onTime),
    "…which is exactly what it shows");
  assert.ok(/class="card-top"/.test(onTime),
    "…and it keeps the rail, so the corner is in the same place on every card");

  // the flag counts exactly the late cards on the board and nothing else, and every flag is
  // paired with exactly one divider — no divider ever appears on its own
  const brd = board(app);
  const flags = (brd.match(/overdue-flag/g) || []).length;
  const seps = (brd.match(/status-sep/g) || []).length;
  assert.strictEqual(flags, 2, "two of the three due cards are past their day, and two are flagged");
  assert.strictEqual(seps, flags, "one divider per flag — the divider never shows without it");
  // …and every card has a status line, late or not
  assert.strictEqual((brd.match(/card-status/g) || []).length, 3,
    "all three due cards carry a status line");
}

/* ---------- 8: marking a card still works, and only moves that card ----------
   The board is a layout. Done and Missed are the same two handlers writing the same two lists,
   keyed by the same ids they always were — the rename above this line changed what a card is
   CALLED and nothing about what marking it does. */
{
  // Sam has the whole of week 1 due; Dee is a week further on, so the board survives Sam's
  // lane being cleared and the empty state can be seen where it belongs
  const app = boot({ members: [live("a", "Sam Live", 8), live("b", "Dee Deep", 15)] });
  const before = columns(app).reduce((n, c) => n + cardIds(c.html).length, 0);
  assert.strictEqual(countBadge(column(app, "week1")), 2, "two cards in week 1 to start with");

  app.ctx.toggleDone("a", "wk2", true);
  assert.ok(!column(app, "week1").includes("act-a-wk2"), "the card leaves its column when done");
  assert.strictEqual(countBadge(column(app, "week1")), 1, "…and its column's count comes down");
  assert.ok(column(app, "week1").includes("act-a-d1_text"),
    "…while the other card in the same lane is untouched");
  assert.ok(column(app, "week2").includes("act-b-wk3"), "…and so are the other lanes");
  assert.ok((app.find("a").completed || []).includes("wk2"),
    "and it is 'wk2' that was ticked — the id is what Done writes, whatever the card is called");

  app.ctx.markMissed("a", "d1_text");
  assert.deepStrictEqual(cardIds(column(app, "week1")), [], "Missed clears its card too");
  assert.ok(/<div class="board-empty">Nothing here today<\/div>/.test(column(app, "week1")),
    "…and the emptied lane holds its place rather than vanishing");
  assert.strictEqual(columns(app).length, 7, "…so the board is still seven lanes wide");

  const after = columns(app).reduce((n, c) => n + cardIds(c.html).length, 0);
  assert.strictEqual(after, before - 2, "exactly the two cards that were resolved are gone");
}

/* ---------- 9: the standing rows still sit ABOVE the board ----------
   Follow-ups and "waiting on a first session" are not touchpoints and have no channel, so
   they are not board work. They keep their stacked rows at the top of the screen, where they
   were and where they are easy to find. */
{
  const leaver = {
    id: "fin", name: "Kelly Finished", coach: "Grace", day0: daysFromToday(-60),
    booked: daysFromToday(-60), firstSessionDone: true, completed: ["intro"], doneMeta: {},
    checks: {}, missed: [], outcome: "left", signedUp: false, extraDays: 0, pausedDays: 0,
    pausedAt: null, followUpOn: daysFromToday(0), followUpStatus: "pending",
  };
  const waiting = { ...preStart("w", "Priya Raghunathan"), completed: ["intro"] };
  const app = boot({ members: [leaver, waiting, live("a", "Sam Live", 8)] });
  const today = app.html("todayList");

  assert.ok(today.includes("Follow-ups to make"), "the follow-up group is still rendered");
  assert.ok(today.includes("Waiting on a first session"), "…as is the waiting-to-start group");
  assert.ok(today.indexOf("Follow-ups to make") < today.indexOf('<div class="board">'),
    "follow-ups lead the screen");
  assert.ok(today.indexOf("Waiting on a first session") < today.indexOf('<div class="board">'),
    "…and the waiting rows sit between them and the board");

  // neither is a card in a column
  assert.ok(!board(app).includes("act-fin-followup"), "a follow-up is not board work");
  assert.ok(!board(app).includes("act-w-startclock"), "…and neither is a waiting-to-start row");
}

/* ---------- 10: the banner is the date, and the sub-view toggle is unchanged ---------- */
{
  const app = boot({ members: [live("a", "Sam Live", 8)] });
  assert.ok(/It’s <strong>/.test(app.html("todayBanner")), "the date banner still reads the day");
  // the headcount moved out of the banner and into the masthead corner — it is stated once
  assert.ok(!/on the journey/.test(app.html("todayBanner")), "the banner no longer quotes a headcount");
  assert.ok(!/challenger/.test(app.html("todayBanner")), "…nothing of the sentence is left behind");
  assert.strictEqual(app.el("liveCount").textContent, "1", "and the corner is the one that counts");

  // the toggle is static markup above the board, and "Whole journey" is a different screen
  const view = /<section class="view" id="view-today"[\s\S]*?<\/section>/.exec(HTML)[0];
  assert.ok(/setTodayView\('moves'\)/.test(view) && /setTodayView\('table'\)/.test(view),
    "both halves of the Today's moves / Whole journey toggle are still there");
  assert.ok(view.indexOf("viewtoggle") < view.indexOf('id="todayMoves"'),
    "…and the toggle is still above the moves it switches to");

  app.ctx.setTodayView("table");
  assert.ok(/<table/.test(app.html("todayTable")), "Whole journey is still the table it was");
  assert.ok(!/board-col/.test(app.html("todayTable")), "…and the board did not leak into it");
}

/* ---------- 11: nothing drags ----------
   The board looks like a board and that is where the resemblance is meant to stop. Cards are
   arranged by the journey, so a coach dragging one somewhere would either be lying to
   themselves or silently rewriting what is due. */
{
  assert.ok(!/\bdraggable\b/i.test(HTML), "no element is made draggable");
  assert.ok(!/on(dragstart|dragover|dragend|drop|dragenter|dragleave)/i.test(HTML),
    "no drag or drop handler anywhere on the page");
  assert.ok(!/addEventListener\((['"])(dragstart|dragover|drop|dragend)\1/.test(HTML),
    "…and none wired up in script either");
}

/* ---------- 12: the retention tracker was left alone ----------
   Its Today's moves is the same screen for a different roster, and it was explicitly not part
   of this change. Asserted because "while I'm in here" is exactly how it would drift. */
{
  const member = {
    id: "m1", name: "Rita Member", coach: "Grace", joined: daysFromToday(-30),
    completed: [], doneMeta: {}, checks: {}, missed: [], notes: "", attendance: {},
  };
  const app = boot({ retention: [member] });
  const ret = app.html("retTodayList");
  assert.ok(ret.includes("Day 30 check-in"), "sanity: the member has a touchpoint due");
  assert.ok(!/board-col|class="board"/.test(ret), "retention's Today has no board");
  assert.ok(/<div class="group-label">/.test(ret), "…it is still the stacked group layout");
}

console.log("board.test.cjs: OK");
