// The onboarding Today's moves — the intro lane, and the six weeks as a folder.
//
// It has been three layouts now, and the reason it moved twice is width. It was one long
// stack; then it was columns, which sorted the day into channels; then the columns became the
// six weeks, which is the right way to sort them and the wrong number of columns to do it in.
// Seven lanes left each card about 180px to hold a challenger's name, a touchpoint title, a
// day, two buttons and a chevron — and a card that narrow does not wrap so much as shred, a
// word or two per line, sometimes a letter.
//
// So the weeks are a FOLDER: six tabs, one week open at a time, that week's cards laid across
// the full width of the screen. The intro sessions keep a lane of their own above it, because
// running an intro is not a week's work — it is what happens before the weeks start.
//
// What that trades away is seeing all six weeks at once, and the tab row is what buys it back:
// every week carries its own count whether or not it is the week on screen, and a week holding
// something overdue carries it in red.
//
// The other half of this file is everything that must NOT have changed across all three
// layouts: the cards' content, their ids and handlers, the OVERDUE flag, what is due and when,
// the standing rows above the board, and the retention tracker, which was left on its stacked
// layout on purpose.
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
// somebody whose intro has not been run yet — the one card the intro lane holds
const preStart = (id, name) => ({
  id, name, coach: "Grace", booked: daysFromToday(2),
  completed: [], doneMeta: {}, checks: {}, missed: [],
  outcome: null, signedUp: false, extraDays: 0, pausedDays: 0, pausedAt: null,
});

// the day's work, and its parts
function board(app) {
  const html = app.html("todayList");
  const i = html.indexOf('<div class="board">');
  return i === -1 ? "" : html.slice(i);
}
/* The intro lane is its own recessed block, and the standing rows now sit BETWEEN it and the
   folder — so the lane is sliced at its own element and ends at whatever comes next, which is
   either a stacked group heading or the tab row. */
const introLane = (app) => {
  const b = board(app);
  const from = b.indexOf('<div class="board-col" data-col="intro">');
  if (from < 0) return "";
  const ends = ['<div class="group-label">', 'class="week-tabs"']
    .map((m) => b.indexOf(m, from)).filter((i) => i >= 0);
  return b.slice(from, ends.length ? Math.min.apply(null, ends) : b.length);
};
const folder = (app) => (board(app).split('<div class="weekfolder">')[1] || "");
const panel = (app) => (folder(app).split('<div class="week-panel"')[1] || "");
const openWeek = (app) => {
  const m = /data-week="(\d)"/.exec(folder(app));
  return m ? Number(m[1]) : null;
};
// every tab on the row: its week, whether it is the open one, its count and whether that
// count is the red one
function tabs(app) {
  return (folder(app).match(/<button[^>]*class="week-tab[^"]*"[\s\S]*?<\/button>/g) || [])
    .map((t) => {
      const count = /<span class="wk-count([^"]*)">(\d+)<\/span>/.exec(t);
      return {
        week: Number(/Week (\d)/.exec(t)[1]),
        open: /class="week-tab on"/.test(t),
        selected: /aria-selected="true"/.test(t),
        count: count ? Number(count[2]) : null,
        late: !!(count && /late/.test(count[1])),
      };
    });
}
const tab = (app, w) => tabs(app).find((t) => t.week === w) || {};
const cardIds = (html) => (html.match(/id="act-[^"]+"/g) || []).map((s) => s.slice(4, -1));
const countBadge = (html) => {
  const m = /<span class="gcount">(\d+)<\/span>/.exec(html);
  return m ? Number(m[1]) : null;
};

/* ---------- 1: one lane, then six tabs ---------- */
{
  const app = boot({ members: [preStart("p", "Ned New"), live("a", "Sam Live", 8)] });

  assert.strictEqual(introLane(app).match(/data-col="intro"/g).length, 1,
    "the intro has a lane of its own");
  assert.ok(/<span class="board-col-title">Intro sessions to run<\/span>/.test(introLane(app)),
    "…under its own heading");
  assert.ok(board(app).indexOf('data-col="intro"') < board(app).indexOf("weekfolder"),
    "…above the folder, not inside it");
  assert.ok(!/data-col="week/.test(board(app)), "the weeks are not lanes any more");

  assert.deepStrictEqual(tabs(app).map((t) => t.week), [1, 2, 3, 4, 5, 6],
    "six week tabs, in order");
  assert.ok(/role="tablist"/.test(folder(app)) && /role="tab"/.test(folder(app))
    && /role="tabpanel"/.test(folder(app)), "…and they are tabs, as far as a screen reader is told");

  // the row is the same six every day: an emptier one does not reshuffle or drop any
  const quiet = boot({ members: [live("c", "Katie Leicester", 1)] });
  assert.deepStrictEqual(tabs(quiet).map((t) => t.week), [1, 2, 3, 4, 5, 6],
    "…with five weeks empty, the row is still the same six tabs");
  // an intro to run and nothing in any week: the folder is still the same six tabs
  const introOnly = boot({ members: [preStart("q", "Nia New")] });
  assert.deepStrictEqual(tabs(introOnly).map((t) => t.week), [1, 2, 3, 4, 5, 6],
    "…and with no week work at all, still six");
}

/* ---------- 2: ONE week is on screen, and it is the only one in the page ----------
   The fix. Not five hidden weeks with a class on them — five weeks that are not built. A card
   that is not on screen must not be in the page carrying a live Done button and a duplicate
   element id. */
{
  const app = boot({ members: [
    live("a", "Sam Live", 8), live("b", "Dee Deep", 15), live("c", "Ell Late", 22),
  ] });

  assert.strictEqual(openWeek(app), 1, "week 1 is open");
  assert.strictEqual((folder(app).match(/class="week-panel"/g) || []).length, 1,
    "exactly one panel is rendered");
  assert.deepStrictEqual(cardIds(panel(app)), ["act-a-d1_text", "act-a-wk2"],
    "…holding week 1's cards, in journey-day order");
  for (const hidden of ["act-b-wk3", "act-c-wk4"]) {
    assert.ok(!board(app).includes(hidden),
      hidden + " is in another week, so it is not in the page at all");
  }

  // and opening another week swaps what is there, rather than adding to it
  assert.strictEqual(app.ctx.setOpenWeek(2), 2, "the tab reports the week it opened");
  assert.strictEqual(openWeek(app), 2);
  assert.deepStrictEqual(cardIds(panel(app)), ["act-b-wk3"], "week 2's card, and only its");
  assert.ok(!board(app).includes("act-a-wk2"), "…week 1's have gone from the page");
  assert.strictEqual((folder(app).match(/class="week-panel"/g) || []).length, 1,
    "still exactly one panel — the folder does not accumulate");
  assert.strictEqual(tab(app, 2).open, true, "the tab that was pressed is the one lit");
  assert.strictEqual(tab(app, 2).selected, true, "…and says so to a screen reader");
  assert.strictEqual(tabs(app).filter((t) => t.open).length, 1, "…and it is the only one lit");
  assert.strictEqual(tabs(app).filter((t) => t.selected).length, 1, "…in both senses");

  // the panel is the tab's panel, wired both ways
  assert.ok(/id="wkpanel-2"[^>]*aria-labelledby="wktab-2"/.test(folder(app)),
    "the open panel names the tab it belongs to");
  assert.ok(/id="wktab-2"[^>]*aria-controls="wkpanel-2"/.test(folder(app)),
    "…and the tab names the panel");

  // the intro lane is outside all of it and never moves
  assert.ok(introLane(app).includes("Intro sessions to run"), "the intro lane is still there");
  const other = boot({ members: [preStart("p", "Ned New"), live("b", "Dee Deep", 15)] });
  other.ctx.setOpenWeek(6);
  assert.deepStrictEqual(cardIds(introLane(other)), ["act-p-intro"],
    "…with its card on it, whichever week is open");
}

/* ---------- 3: a card is in the week its DAY puts it in ----------
   Unchanged by the layout, and the rule is arithmetic on a number the touchpoint already
   carried: week = ceil(day / 7). Asserted by opening each week and reading it. */
{
  const app = boot({ members: [
    live("a", "Sam Live", 8), live("b", "Dee Deep", 15), live("c", "Ell Late", 22),
    live("d", "Fay Far", 29), live("e", "Gus Gone", 36),
  ] });
  const inWeek = (w) => { app.ctx.setOpenWeek(w); return cardIds(panel(app)); };

  assert.deepStrictEqual(inWeek(1), ["act-a-d1_text", "act-a-wk2"], "days 1 and 7 → week 1");
  assert.deepStrictEqual(inWeek(2), ["act-b-wk3"], "day 14 → week 2");
  assert.deepStrictEqual(inWeek(3), ["act-c-wk4"], "day 21 → week 3");
  assert.deepStrictEqual(inWeek(4), ["act-d-wk5"], "day 28 → week 4");
  assert.deepStrictEqual(inWeek(5), ["act-e-wk6"], "day 35 → week 5");
  assert.deepStrictEqual(inWeek(6), [], "and nothing fires in week 6 yet");

  // the rule is the function, not a table somebody has to keep in step
  const J = app.ctx.__t.JOURNEY;
  const weekOf = (id) => app.ctx.journeyWeek(J.find((it) => it.id === id));
  assert.strictEqual(
    JSON.stringify(J.filter((it) => it.phase !== "intro").map((it) => [it.id, it.day, weekOf(it.id)])),
    JSON.stringify([["d1_text", 1, 1], ["wk2", 7, 1], ["wk3", 14, 2],
                    ["wk4", 21, 3], ["wk5", 28, 4], ["wk6", 35, 5]]),
    "every touchpoint's week is ceil(day/7) — and every day is exactly what it always was");
  assert.strictEqual(app.ctx.journeyWeek(J.find((it) => it.id === "intro")), 0,
    "the intro has no week, which is why it has a lane");
  assert.strictEqual(app.ctx.journeyWeek({ day: 0, phase: "journey" }), 1, "day 0 reads as week 1");
  assert.strictEqual(app.ctx.journeyWeek({ day: 99, phase: "journey" }), 6, "…and day 99 as week 6");

  // no card is in two places, across all six weeks and the lane
  const all = [1, 2, 3, 4, 5, 6].reduce((acc, w) => acc.concat(inWeek(w)), [])
    .concat(cardIds(introLane(app)));
  assert.strictEqual(new Set(all).size, all.length, "every due card appears exactly once");
}

/* ---------- 4: the tabs carry the counts, so a hidden week still speaks ----------
   This is what makes hiding five weeks defensible. A count on every week that has work, no
   count at all on a week that does not, and red the moment a week is holding something late. */
{
  // Sam is on day 8 — both his week-1 touchpoints are past their day. Dee is exactly on day 14
  // with her first week already handled, so her week-2 check-in is due today and not late.
  // Nothing else is due anywhere.
  const caughtUp = (id, name, day) =>
    Object.assign(live(id, name, day), { completed: ["intro", "d1_text", "wk2"] });
  const app = boot({ members: [live("a", "Sam Live", 8), caughtUp("b", "Dee Deep", 14)] });

  assert.strictEqual(tab(app, 1).count, 2, "week 1 is carrying two");
  assert.strictEqual(tab(app, 1).late, true, "…and both are past their day, so it is red");
  assert.strictEqual(tab(app, 2).count, 1, "week 2 is carrying one");
  assert.strictEqual(tab(app, 2).late, false, "…due today, not late, so it is not red");
  for (const w of [3, 4, 5, 6]) {
    assert.strictEqual(tab(app, w).count, null,
      "week " + w + " has nothing outstanding, so it carries no count at all — not a zero");
  }
  assert.ok(!/wk-count[^>]*>0</.test(folder(app)), "no tab shows a nought");

  // the count is the week's own work, and it is right whichever week is open
  app.ctx.setOpenWeek(5);
  assert.strictEqual(tab(app, 1).count, 2, "week 1 still says two from a week away");
  assert.strictEqual(tab(app, 1).late, true, "…and still says it in red");

  // marking the work takes the count down rather than leaving a zero behind. Two in the week so
  // the board survives it — on a day with nothing left anywhere the screen is "All caught up".
  const fresh = boot({ members: [caughtUp("b", "Dee Deep", 14), live("a", "Sam Live", 8)] });
  assert.strictEqual(tab(fresh, 2).count, 1, "sanity: one in week 2");
  assert.strictEqual(tab(fresh, 2).late, false, "…and nothing late in it");
  fresh.ctx.toggleDone("b", "wk3", true);
  assert.strictEqual(tab(fresh, 2).count, null, "done: the count goes");

  // and a tab says its state in words too, for anyone who cannot see the red
  assert.ok(/aria-label="Week 1, 2 overdue to do"/.test(folder(app)),
    "the tab spells its state out rather than leaving it to the colour");
}

/* ---------- 5: the folder opens on the earliest week with work ----------
   And then it stays where it is put. Following the work is the DEFAULT, not the behaviour — a
   screen that jumps out from under somebody the moment they finish a card is worse than one
   that waits to be told. */
{
  // nothing in week 1; the earliest outstanding work is week 3
  const app = boot({ members: [live("c", "Ell Late", 22), live("e", "Gus Gone", 36)] });
  assert.strictEqual(openWeek(app), 3, "it opens on week 3, the earliest week with anything in it");

  // finish week 3 and, untouched, it follows the work forward
  app.ctx.toggleDone("c", "wk4", true);
  assert.strictEqual(openWeek(app), 5, "…and moves to week 5 when week 3 empties");

  // but a coach's own choice is pinned, including onto a week they then empty
  const pinned = boot({ members: [live("a", "Sam Live", 8), live("e", "Gus Gone", 36)] });
  assert.strictEqual(openWeek(pinned), 1, "opens on week 1");
  pinned.ctx.setOpenWeek(5);
  assert.strictEqual(openWeek(pinned), 5, "…moves where it is told");
  pinned.ctx.toggleDone("e", "wk6", true);
  assert.strictEqual(openWeek(pinned), 5,
    "…and stays there on the week just emptied, rather than jumping to the next job");
  assert.ok(/board-empty/.test(panel(pinned)), "…which is showing its empty state");

  // a day with nothing due anywhere opens on week 1
  const clear = boot({ members: [preStart("p", "Ned New")] });
  assert.strictEqual(openWeek(clear), 1, "a clear day opens on week 1");
  assert.strictEqual(tabs(clear).filter((t) => t.count !== null).length, 0,
    "…with no counts on the row");

  // and a week that does not exist is refused rather than opening a panel that is not there
  const app2 = boot({ members: [live("a", "Sam Live", 8)] });
  app2.ctx.setOpenWeek(9);
  assert.strictEqual(openWeek(app2), 1, "week 9 does not exist, so nothing moved");
  app2.ctx.setOpenWeek(0);
  assert.strictEqual(openWeek(app2), 1, "nor does week 0");
}

/* ---------- 6: an empty week stands there and says so ----------
   Week 6 is the interesting one: it has no touchpoint in JOURNEY at all — the end-of-challenge
   review that will live there has not been written — so it says something slightly different
   from a week that simply has nothing due today, and it says it every day. */
{
  const app = boot({ members: [live("c", "Katie Leicester", 1)] });
  app.ctx.setOpenWeek(3);
  assert.deepStrictEqual(cardIds(panel(app)), [], "nothing due in week 3");
  assert.ok(/<div class="board-empty">Nothing here today<\/div>/.test(panel(app)),
    "…and the panel says so rather than collapsing");

  app.ctx.setOpenWeek(6);
  assert.ok(/<div class="board-empty">Nothing here yet<\/div>/.test(panel(app)),
    "week 6 has nothing in the journey to be quiet about — it says “yet”");
  assert.strictEqual(app.ctx.weekHasTouchpoints(6), false, "…which is what the panel asks");
  for (const w of [1, 2, 3, 4, 5]) {
    assert.strictEqual(app.ctx.weekHasTouchpoints(w), true, "week " + w + " has work defined");
  }

  // the intro lane has the same manners
  assert.strictEqual(countBadge(introLane(app)), 0, "no intro to run today");
  assert.ok(/<div class="board-empty">Nothing here today<\/div>/.test(introLane(app)),
    "…and the lane says so");
}

/* ---------- 7: a completely clear day is still "All caught up", not an empty folder ---------- */
{
  const app = boot({ members: [] });
  assert.ok(app.html("todayList").includes("All caught up"), "the clear-day message is unchanged");
  assert.strictEqual(board(app), "", "…and no board is drawn behind it");
}

/* ---------- 8: what a card carries, at full width ----------
   Everything the card is for, and nothing it is not. The channel CHIP is gone and stays gone,
   but the channel is still on the card as its class, because that is what colours the stripe
   down its left edge. */
{
  const app = boot({ members: [live("a", "Sam Live", 8)] });
  const card = /<div class="action digital" id="act-a-wk2"[\s\S]*?(?=<div class="action|<\/div><\/div>|$)/
    .exec(panel(app))[0];

  assert.ok(/<span class="status-day">Day 8<\/span>/.test(card), "the day label is on the card");
  assert.ok(/<span class="nm">Sam Live<\/span>/.test(card), "…as is the challenger's name");
  assert.ok(/<span class="ttl">Week 1 check-in<\/span>/.test(card), "…and the touchpoint's title");
  assert.ok(/toggleDone\('a','wk2',true\)/.test(card), "Done is still wired to the real handler");
  assert.ok(/markMissed\('a','wk2'\)/.test(card), "…and Missed to its own");
  assert.ok(/toggleExpand\('a','wk2'\)/.test(card), "…and the card still expands");
  assert.ok(/class="chev"/.test(card), "…the expand chevron is still there to expand it with");
  assert.ok(/class="notes-btn/.test(card), "…and it still carries the notes icon");

  // the chip is gone from every card on the board, not just this one
  assert.ok(!/class="ch /.test(board(app)), "no card spells its channel out in a chip");
  for (const word of ["Digital", "Physical", "In person"]) {
    assert.ok(!board(app).includes(">" + word + "<"),
      "…so “" + word + "” is not printed on the board at all");
  }
  assert.ok(/<div class="action digital" id="act-a-wk2"/.test(card),
    "the channel still rides on the card's own class, which is what draws its colour stripe");

  // the intro lane and the open week emit the SAME card — one builder, two places
  const both = boot({ members: [preStart("p", "Ned New"), live("a", "Sam Live", 8)] });
  for (const [where, html] of [["the lane", introLane(both)], ["the open week", panel(both)]]) {
    for (const part of ['class="card-top"', 'class="card-status"', 'class="who"',
                        'class="mark-btns"', 'class="chev"', 'class="body"', 'class="detail"']) {
      assert.ok(html.includes(part), where + " builds a card with " + part);
    }
    assert.ok(/toggleDone\(/.test(html) && /markMissed\(/.test(html) && /toggleExpand\(/.test(html),
      where + " wires it to the same three handlers");
  }
}

/* ---------- 8b: the pre-start day label says what it means ---------- */
{
  const app = boot({ members: [preStart("p", "Ned New")] });
  const card = introLane(app);
  assert.ok(/<span class="status-day">Not started yet<\/span>/.test(card),
    "an intro card's day label reads “Not started yet”");
  assert.ok(!/Pre-start/.test(app.html("todayList")), "…and “Pre-start” is gone from Today");
  assert.ok(!/status-sep|overdue/.test(card), "…and an unstarted card carries no overdue half");

  const dated = boot({ members: [live("a", "Sam Live", 8)] });
  assert.ok(/<span class="status-day">Day 8<\/span>/.test(panel(dated)),
    "the relabel did not touch the dated cards");
}

/* ---------- 8c: the day label lives in the status line, and only there ---------- */
{
  const app = boot({ members: [live("a", "Sam Live", 8), preStart("p", "Ned New")] });
  const brd = board(app);

  assert.ok(/<span class="card-status">\s*<span class="status-day">Day 8<\/span>/.test(brd),
    "the day label opens the card's status line");
  assert.ok(!/<span class="day">/.test(brd),
    "no board card still carries the day pill next to its title");
  const bodyOf = (id) => /<div class="who">([\s\S]*?)<\/div>/.exec(
    new RegExp('id="' + id + '"[\\s\\S]*').exec(brd)[0])[1];
  for (const id of ["act-a-wk2", "act-p-intro"]) {
    assert.ok(!/Day |Not started yet/.test(bodyOf(id)),
      id + ": the name-and-title block says nothing about the day any more");
  }

  // the pill class itself is untouched — the standing rows still use it
  const standing = boot({ members: [{ ...preStart("w", "Priya R"), completed: ["intro"] }] });
  const above = standing.html("todayList");
  const at = above.indexOf("Waiting on a first session");
  assert.ok(at > 0, "sanity: the waiting row is rendered");
  const row = above.slice(at, above.indexOf('class="week-tabs"'));
  assert.ok(/<span class="day">/.test(row),
    "the waiting-to-start row keeps its own day pill");
  assert.ok(!/status-day/.test(row), "…and none of the status-line treatment leaked into it");
}

/* ---------- 9: OVERDUE, in the card's corner and on the week's tab ----------
   Spotting the late one is the reason to look at this screen at all, and with five weeks
   hidden it has to be sayable from outside the week it is in. */
{
  const app = boot({ members: [live("a", "Sam Live", 8), live("c", "Katie Leicester", 1)] });
  const slice = (id) =>
    new RegExp('<div class="action [a-z]+" id="' + id + '"[\\s\\S]*?(?=<div class="action|$)')
      .exec(panel(app))[0];

  const late = slice("act-a-d1_text");
  assert.ok(/<span class="overdue-flag">Overdue<\/span>/.test(late),
    "a touchpoint whose day has passed is flagged on its card");
  assert.ok(/<span class="card-status">\s*<span class="status-day">Day 8<\/span>\s*<span class="status-sep"[^>]*><\/span><span class="overdue-flag">Overdue<\/span>\s*<\/span>/.test(late),
    "the late card's status line reads day, then a divider, then Overdue — one line, one order");
  assert.ok(late.indexOf("card-status") < late.indexOf('class="who"'),
    "…in the top rail, above the name, rather than beside the title");

  const onTime = slice("act-c-d1_text");
  assert.ok(!/overdue/.test(onTime), "a touchpoint due today carries no flag at all");
  assert.ok(!/status-sep/.test(onTime), "…and no divider either");
  assert.ok(/<span class="card-status">\s*<span class="status-day">Day 1<\/span>\s*<\/span>/.test(onTime),
    "…which is exactly what it shows");
  assert.ok(/class="card-top"/.test(onTime), "…and it keeps the rail");

  // every flag is paired with exactly one divider, and every card has a status line
  const p = panel(app);
  const flags = (p.match(/overdue-flag/g) || []).length;
  assert.strictEqual((p.match(/status-sep/g) || []).length, flags,
    "one divider per flag — the divider never shows without it");
  assert.strictEqual((p.match(/card-status/g) || []).length, cardIds(p).length,
    "every card in the open week carries a status line");
  assert.strictEqual(tab(app, 1).late, true, "…and the week carrying them is red on the tab");
}

/* ---------- 10: marking a card still works, and only moves that card ---------- */
{
  const app = boot({ members: [live("a", "Sam Live", 8), live("b", "Dee Deep", 15)] });
  app.ctx.setOpenWeek(1);        // a coach working through week 1, as they would be
  assert.strictEqual(tab(app, 1).count, 2, "two cards in week 1 to start with");

  app.ctx.toggleDone("a", "wk2", true);
  assert.ok(!panel(app).includes("act-a-wk2"), "the card leaves the panel when done");
  assert.strictEqual(tab(app, 1).count, 1, "…and its week's count comes down");
  assert.ok(panel(app).includes("act-a-d1_text"), "…while the other card in the week is untouched");
  assert.strictEqual(tab(app, 2).count, 1, "…and so are the other weeks");
  assert.ok((app.find("a").completed || []).includes("wk2"),
    "and it is 'wk2' that was ticked — the id is what Done writes, whatever the card is called");

  app.ctx.markMissed("a", "d1_text");
  assert.deepStrictEqual(cardIds(panel(app)), [], "Missed clears its card too");
  assert.strictEqual(tab(app, 1).count, null, "…and the week stops carrying a count");
  assert.strictEqual(openWeek(app), 1, "…and the folder does not move out from under the coach");
  assert.ok(/<div class="board-empty">Nothing here today<\/div>/.test(panel(app)),
    "…it shows the week it is on, empty");
  assert.strictEqual(tabs(app).length, 6, "…and the row is still six tabs");
}

/* ---------- 11: the order of the day ----------
   Deadline first, then the day's work in the order it gets done: birthdays this week (only
   when there are any), the intro sessions, the two standing states — follow-ups and who is
   waiting on a first session — and last the check-ins, which is the longest section.

   Follow-ups and the waiting rows are not touchpoints, have no week, and are not week work.
   They keep their stacked rows between the intros and the folder rather than being cards in
   it. */
{
  const leaver = {
    id: "fin", name: "Kelly Finished", coach: "Grace", day0: daysFromToday(-60),
    booked: daysFromToday(-60), firstSessionDone: true, completed: ["intro"], doneMeta: {},
    checks: {}, missed: [], outcome: "left", signedUp: false, extraDays: 0, pausedDays: 0,
    pausedAt: null, followUpOn: daysFromToday(0), followUpStatus: "pending",
  };
  const waiting = { ...preStart("w", "Priya Raghunathan"), completed: ["intro"] };
  // a challenger whose birthday is this week, so every section is on the screen at once
  const today = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const dob = "1990-" + pad(today.getMonth() + 1) + "-" + pad(today.getDate());
  const app = boot({ members: [
    leaver, waiting, preStart("p", "Ned New"), { ...live("a", "Sam Live", 8), dob },
  ] });

  // where each section starts, read off the rendered screen
  const html = app.html("todayList");
  const at = (needle) => {
    const i = html.indexOf(needle);
    assert.ok(i >= 0, "sanity: the screen has " + needle);
    return i;
  };
  const order = [
    ["Birthdays this week", at(">Birthdays this week<")],
    ["Intro sessions to run", at(">Intro sessions to run<")],
    ["Follow-ups to make", at(">Follow-ups to make<")],
    ["Waiting on a first session", at(">Waiting on a first session<")],
    ["the check-ins", at('class="week-tabs"')],
  ];
  assert.deepStrictEqual(
    order.slice().sort((x, y) => x[1] - y[1]).map((x) => x[0]),
    order.map((x) => x[0]),
    "the screen reads: birthdays, intros, follow-ups, waiting, check-ins — found "
    + JSON.stringify(order.slice().sort((x, y) => x[1] - y[1]).map((x) => x[0])));

  // neither standing row is a card in a week
  assert.ok(!folder(app).includes("act-fin-followup"), "a follow-up is not week work");
  assert.ok(!folder(app).includes("act-w-startclock"), "…and neither is a waiting-to-start row");
  assert.ok(!introLane(app).includes("act-fin-followup"), "…nor an intro to run");
}

/* ---------- 11b: birthdays lead the day, and only on the days there are any ----------
   The one section that appears and disappears. A birthday is the only thing on this screen
   that expires — it is either today's or it is an apology — so it goes above everything when
   it exists, and when it does not it is absent rather than an empty box saying so. */
{
  const today = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const dob = "1990-" + pad(today.getMonth() + 1) + "-" + pad(today.getDate());

  const none = boot({ members: [preStart("p", "Ned New"), live("a", "Sam Live", 8)] });
  const quiet = none.html("todayList");
  assert.ok(!quiet.includes("Birthdays this week"),
    "no birthday this week: the section is not on the screen at all");
  assert.ok(quiet.indexOf(">Intro sessions to run<") < quiet.indexOf('class="week-tabs"'),
    "…and the day opens on the intro sessions");

  const some = boot({ members: [preStart("p", "Ned New"), { ...live("a", "Sam Live", 8), dob }] });
  const busy = some.html("todayList");
  assert.ok(busy.includes("Birthdays this week"), "a birthday this week: the section appears");
  assert.strictEqual(busy.indexOf(">Birthdays this week<"),
    Math.min(busy.indexOf(">Birthdays this week<"), busy.indexOf(">Intro sessions to run<"),
             busy.indexOf('class="week-tabs"')),
    "…at the very top, above every other section");
  assert.ok(/<div class="group-label">Birthdays this week<span class="gcount">1<\/span>/.test(busy),
    "…counted, as it always was");

  // and the section is unchanged inside: same rows, same handlers, still no Missed
  assert.ok(/id="act-a-birthday"/.test(busy), "the birthday row is the row it was");
  assert.ok(!/act-a-birthday[\s\S]{0,600}?markMissed/.test(busy),
    "…with no Missed on it: the day happens whether or not you act");
}

/* ---------- 12: the banner is the date, and the sub-view toggle is unchanged ---------- */
{
  const app = boot({ members: [live("a", "Sam Live", 8)] });
  assert.ok(/It’s <strong>/.test(app.html("todayBanner")), "the date banner still reads the day");
  assert.ok(!/on the journey/.test(app.html("todayBanner")), "the banner no longer quotes a headcount");
  assert.strictEqual(app.el("liveCount").textContent, "1", "and the corner is the one that counts");

  const view = /<section class="view" id="view-today"[\s\S]*?<\/section>/.exec(HTML)[0];
  assert.ok(/setTodayView\('moves'\)/.test(view) && /setTodayView\('table'\)/.test(view),
    "both halves of the Today's moves / Whole journey toggle are still there");
  assert.ok(view.indexOf("viewtoggle") < view.indexOf('id="todayMoves"'),
    "…and the toggle is still above the moves it switches to");

  app.ctx.setTodayView("table");
  assert.ok(/<table/.test(app.html("todayTable")), "Whole journey is still the table it was");
  assert.ok(!/week-tab|board-col/.test(app.html("todayTable")), "…and the folder did not leak into it");
}

/* ---------- 13: the open week is this screen's business and nobody else's ----------
   Which week a coach is looking at is not a fact about the gym. It is in memory, it dies with
   the page, and it must not be persisted or pushed anywhere — one coach's tap moving another's
   screen mid-tick would be a bug, not a feature. */
{
  const app = boot({ members: [live("a", "Sam Live", 8)] });
  app.ctx.setOpenWeek(4);
  assert.strictEqual(app.stored("bsj_open_week"), null, "no localStorage key");
  assert.ok(!/open_week|openWeek/.test(JSON.stringify(app.cached())),
    "…and nothing of it in the roster blob");
  assert.ok(!/localStorage[^\n]*openWeek|openWeek[^\n]*localStorage/.test(HTML),
    "the open week touches localStorage nowhere");
  assert.ok(!/key=eq\.[^']*week/i.test(HTML), "…and no realtime subscription carries it");

  const again = boot({ members: [live("a", "Sam Live", 8)] });
  assert.strictEqual(openWeek(again), 1, "a fresh load starts from the default, whatever the last did");
}

/* ---------- 14: nothing drags ----------
   It is a folder now rather than a board, and it never looked draggable, but the assertion is
   the same one for the same reason: cards are arranged by the journey, so a coach dragging one
   somewhere would either be lying to themselves or silently rewriting what is due. */
{
  assert.ok(!/\bdraggable\b/i.test(HTML), "no element is made draggable");
  assert.ok(!/on(dragstart|dragover|dragend|drop|dragenter|dragleave)/i.test(HTML),
    "no drag or drop handler anywhere on the page");
  assert.ok(!/addEventListener\((['"])(dragstart|dragover|drop|dragend)\1/.test(HTML),
    "…and none wired up in script either");
}

/* ---------- 15: the retention tracker was left alone ---------- */
{
  const member = {
    id: "m1", name: "Rita Member", coach: "Grace", joined: daysFromToday(-30),
    completed: [], doneMeta: {}, checks: {}, missed: [], notes: "", attendance: {},
  };
  const app = boot({ retention: [member] });
  const ret = app.html("retTodayList");
  assert.ok(ret.includes("Day 30 check-in"), "sanity: the member has a touchpoint due");
  assert.ok(!/board-col|class="board"|week-tab/.test(ret),
    "retention's Today has no board and no folder");
  assert.ok(/<div class="group-label">/.test(ret), "…it is still the stacked group layout");
}

console.log("board.test.cjs: OK");
