// The onboarding Today's moves BOARD — the day's touchpoints laid out as columns instead of
// one long stack.
//
// It is a board in APPEARANCE only, and that is the whole point of this file. Nothing here
// drags, and the layout change was not allowed to touch a single thing about what is due:
// the same journey logic decides which touchpoints appear, the same grace window keeps them
// there, and the same two buttons resolve them. A column is the old group heading turned on
// its side, and nothing more.
//
// So these tests are split in two. The first half is the board's SHAPE — three named columns
// in a fixed order, each with its heading and count, empty ones still standing. The second
// half is everything that must NOT have changed: the cards' content, their buttons, the
// OVERDUE flag, the banner and the toggle above the board, and the retention tracker, which
// was left on its stacked layout on purpose.
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

/* ---------- 1: three columns, in the order the day is worked ----------
   Intros first because they are the appointments, then the things that get posted, then the
   things that get typed. The order is the shape of the board and is asserted as such. */
{
  const app = boot({ members: [preStart("p", "Ned New"), live("a", "Sam Live", 8)] });
  const ids = columns(app).map((c) => c.id);
  assert.deepStrictEqual(ids, ["intro", "physical", "digital"],
    "three columns, in a fixed order — the board's structure is not data-dependent");

  const titles = (board(app).match(/<span class="board-col-title">([^<]*)<\/span>/g) || [])
    .map((s) => s.replace(/<[^>]*>/g, ""));
  assert.deepStrictEqual(titles, [
    "Intro sessions to run",
    "Postcards, boxes & cards",
    "Texts & Trainerize check-ins",
  ], "each column keeps the heading its stacked group used to carry");
}

/* ---------- 2: a card lands in the column its channel says it should ----------
   This is the layout's only real job. The journey logic already knew what kind of touchpoint
   each item was; the board just reads it. */
{
  // day 8: the week-2 postcard (physical) and two texts (digital) are all due
  const app = boot({ members: [preStart("p", "Ned New"), live("a", "Sam Live", 8)] });

  assert.deepStrictEqual(cardIds(column(app, "intro")), ["act-p-intro"],
    "the intro is the intro column's, and only its");
  assert.deepStrictEqual(cardIds(column(app, "physical")), ["act-a-d3_postcard"],
    "the handwritten postcard is a physical touch");
  assert.deepStrictEqual(cardIds(column(app, "digital")), ["act-a-d1_text", "act-a-wk2"],
    "the text and the check-in are digital, and stay in journey-day order inside the column");

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
   A board that drops a column on a quiet day stops reading as a board, and the coach loses
   the one thing the layout is for: seeing at a glance that the posting is done and the
   texting is not. */
{
  const app = boot({ members: [live("c", "Katie Leicester", 1)] });   // a day-1 text, nothing else
  assert.strictEqual(columns(app).length, 3, "all three columns are still on the board");
  assert.strictEqual(countBadge(column(app, "intro")), 0);
  assert.strictEqual(countBadge(column(app, "physical")), 0);
  for (const id of ["intro", "physical"]) {
    assert.ok(/<div class="board-empty">Nothing here today<\/div>/.test(column(app, id)),
      id + ": an empty column shows its quiet state rather than collapsing");
  }
  assert.ok(!/board-empty/.test(column(app, "digital")), "…and a column with work in it does not");
}

/* ---------- 5: a completely clear day is still "All caught up", not an empty board ----------
   The empty-column state is for a column with nothing in it. A day with nothing in it at all
   already had an answer, and it is a better one than three empty wells. */
{
  const app = boot({ members: [] });
  assert.ok(app.html("todayList").includes("All caught up"), "the clear-day message is unchanged");
  assert.strictEqual(board(app), "", "…and no board is drawn behind it");
}

/* ---------- 6: the cards themselves are untouched ----------
   Same id, same channel tag, same day label, same Done and Missed wired to the same handlers.
   The card was rearranged by CSS, not rebuilt. */
{
  const app = boot({ members: [live("a", "Sam Live", 8)] });
  const card = /<div class="action digital" id="act-a-wk2"[\s\S]*?(?=<div class="action|<\/div><\/div>|$)/
    .exec(column(app, "digital"))[0];

  assert.ok(/<span class="ch digital">Digital<\/span>/.test(card), "the channel tag is on the card");
  assert.ok(/<span class="day">Day 8<\/span>/.test(card), "…as is the day label");
  assert.ok(/<span class="nm">Sam Live<\/span>/.test(card), "…and the challenger's name");
  assert.ok(/Start of Week 2 check-in/.test(card), "…and the touchpoint's title");
  assert.ok(/toggleDone\('a','wk2',true\)/.test(card), "Done is still wired to the real handler");
  assert.ok(/markMissed\('a','wk2'\)/.test(card), "…and Missed to its own");
  assert.ok(/toggleExpand\('a','wk2'\)/.test(card), "…and the card still expands");
  assert.ok(/class="notes-btn/.test(card), "…and still carries the notes icon");
}

/* ---------- 7: OVERDUE survives the reflow ----------
   Spotting the late one inside its column is the reason to look at the board at all, so the
   flag has to be on the card and not somewhere the new arrangement quietly dropped it. */
{
  // day 8 with nothing marked: the day-1 text and the day-7 pair are all past their day
  const app = boot({ members: [live("a", "Sam Live", 8), live("c", "Katie Leicester", 1)] });
  const late = /<div class="action digital" id="act-a-d1_text"[\s\S]*?(?=<div class="action|$)/
    .exec(column(app, "digital"))[0];
  assert.ok(/<span class="overdue">Overdue<\/span>/.test(late),
    "a touchpoint whose day has passed is flagged inside its column");

  const onTime = /<div class="action digital" id="act-c-d1_text"[\s\S]*?(?=<div class="action|$)/
    .exec(column(app, "digital"))[0];
  assert.ok(!/class="overdue"/.test(onTime), "…and one that is due today is not");

  assert.ok(/class="overdue"/.test(column(app, "physical")), "the late postcard is flagged too");
}

/* ---------- 8: marking a card still works, and only moves that card ---------- */
{
  const app = boot({ members: [live("a", "Sam Live", 8)] });
  const before = columns(app).reduce((n, c) => n + cardIds(c.html).length, 0);

  app.ctx.toggleDone("a", "wk2", true);
  assert.ok(!column(app, "digital").includes("act-a-wk2"), "the card leaves its column when done");
  assert.strictEqual(countBadge(column(app, "digital")), 1, "…and its column's count comes down");
  assert.ok(column(app, "physical").includes("act-a-d3_postcard"),
    "the other columns are untouched");

  app.ctx.markMissed("a", "d3_postcard");
  assert.ok(!column(app, "physical").includes("act-a-d3_postcard"), "Missed clears the card too");
  assert.ok(/board-empty/.test(column(app, "physical")),
    "…and the emptied column holds its place rather than vanishing");

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

/* ---------- 10: the banner and the sub-view toggle are unchanged ---------- */
{
  const app = boot({ members: [live("a", "Sam Live", 8)] });
  assert.ok(/It’s <strong>/.test(app.html("todayBanner")), "the date banner still reads the day");
  assert.ok(/challenger(s?) on the journey right now\./.test(app.html("todayBanner")),
    "…and still counts who is on the journey");

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
