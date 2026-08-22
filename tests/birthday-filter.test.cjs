// Active / Left / Everyone on the Birthdays tab.
//
// Two different jobs were wearing one list. Sending a card to somebody still with us is
// ROUTINE — there is nothing to decide, you write it and you tie the balloons. Sending one to
// somebody who has gone is a JUDGMENT CALL about a particular person, and some of them are
// worth it and some are not. Mixed together, the handful of calls sit buried among thirty
// routine ones and get made by not being made.
//
// So the tab opens on Active, Left is a list of its own with a count on its tab, and Everyone
// is still there for anyone who wants the whole gym at once.
//
// The half of this worth pinning hardest is that "has this person left?" answers for BOTH
// kinds of record. A challenger leaves the 6 weeks — a decision a coach records on their card
// as outcome:'left'. A member ends a membership — a flag a cancellation webhook will set, in a
// build that does not exist yet. No member is flagged today, so the Left list is challengers
// only for now; the tests below flag one by hand to prove that when the webhook arrives those
// members land on this list with nothing else to change.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { boot, daysFromToday } = require("./lib/env.cjs");

const HTML = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

const Y = new Date().getFullYear();
const pad = (n) => String(n).padStart(2, "0");
const today = new Date();
// a birthday that is TODAY, so it is inside every notion of "coming up" this file uses
const dobToday = (Y - 30) + "-" + pad(today.getMonth() + 1) + "-" + pad(today.getDate());
// …and one months away, on file but not coming up
const dobLater = (Y - 30) + "-" + pad(((today.getMonth() + 5) % 12) + 1) + "-15";

const challenger = (id, name, dob, extra) => Object.assign({
  id, name, coach: "Grace", dob,
  day0: daysFromToday(-8), booked: daysFromToday(-8), firstSessionDone: true,
  completed: ["intro"], doneMeta: {}, checks: {}, missed: [],
  outcome: null, signedUp: false, extraDays: 0, pausedDays: 0, pausedAt: null,
}, extra || {});
const member = (id, name, dob, extra) => Object.assign({
  id, name, coach: "Gaz", dob, joined: daysFromToday(-100),
  completed: [], missed: [], doneMeta: {}, attendance: {}, notes: "",
}, extra || {});

// who is on the tab, in the order it lists them
const names = (app) => (app.html("birthdayList").match(/<div class="bday-name">([^<]*)/g) || [])
  .map((s) => s.replace(/<div class="bday-name">/, "").trim());
// the filter row, read off the rendered tab
function filters(app) {
  const html = app.html("birthdayList");
  return (html.match(/<button[^>]*data-bfilter="[^"]*"[\s\S]*?<\/button>/g) || []).map((b) => {
    const badge = /<span class="count tally">(\d+)<\/span>/.exec(b);
    return {
      id: /data-bfilter="([^"]*)"/.exec(b)[1],
      label: /">([^<]*)/.exec(b.slice(b.indexOf(">") + 1)) ? /onclick="[^"]*">([A-Za-z]+)/.exec(b)[1] : "",
      on: /aria-selected="true"/.test(b),
      badge: badge ? Number(badge[1]) : null,
    };
  });
}
const filter = (app, id) => filters(app).find((f) => f.id === id) || {};

// a gym with one of each: two still with us, two gone — one of each kind of gone
const gym = () => boot({
  members: [
    challenger("a", "Ada Active", dobLater),
    challenger("l", "Lee Left", dobToday, { outcome: "left" }),
  ],
  retention: [
    member("r", "Mo Member", dobLater),
    // the flag the cancellation webhook will set. Nothing in the app sets it today.
    member("x", "Xan Excancelled", dobToday, { left: true }),
  ],
});

/* ---------- 1: three tabs, and Active is where the day starts ---------- */
{
  const app = gym();
  assert.deepStrictEqual(filters(app).map((f) => f.id), ["active", "left", "everyone"],
    "three filters, in the order they are used");
  assert.strictEqual(filter(app, "active").on, true, "Active is selected on load");
  assert.strictEqual(filters(app).filter((f) => f.on).length, 1, "…and it is the only one");
  assert.ok(/role="tablist"/.test(app.html("birthdayList")), "the row is a tablist");

  // …and it is still Active on the next load, whatever the last one did
  app.ctx.setBirthdayFilter("left");
  assert.strictEqual(filter(boot({ members: [] }), "active").on, true,
    "a fresh page opens on Active again — this is where you are looking, not a preference");
}

/* ---------- 2: Active is everybody still with us ----------
   On the journey, paused, finished the six weeks, not started yet, or a full member. The one
   thing it is not is anybody who has gone, whichever way they went. */
{
  const app = boot({ members: [
    challenger("a", "Ada Active", dobLater),
    challenger("p", "Pam Paused", dobLater, { pausedAt: daysFromToday(-3) }),
    challenger("n", "Ned Notstarted", dobLater, { day0: null, firstSessionDone: false, completed: [] }),
    challenger("f", "Fay Finished", dobLater, { day0: daysFromToday(-60), booked: daysFromToday(-60) }),
    challenger("s", "Sid Stayed", dobLater, { outcome: "stayed" }),
    challenger("l", "Lee Left", dobLater, { outcome: "left" }),
  ], retention: [
    member("r", "Mo Member", dobLater),
    member("x", "Xan Excancelled", dobLater, { left: true }),
  ] });

  const shown = names(app);
  for (const staying of ["Ada Active", "Pam Paused", "Ned Notstarted", "Fay Finished",
                         "Sid Stayed", "Mo Member"]) {
    assert.ok(shown.includes(staying), "Active shows " + staying);
  }
  for (const gone of ["Lee Left", "Xan Excancelled"]) {
    assert.ok(!shown.includes(gone), "Active hides " + gone);
  }
  assert.strictEqual(shown.length, 6, "six still with us, and only those");
}

/* ---------- 3: Left is everybody who has gone, of either kind ----------
   The challenger half works today. The member half is the point of the exercise: nothing sets
   that flag yet, so it is set by hand here to prove the logic already reads it. */
{
  const app = gym();
  app.ctx.setBirthdayFilter("left");
  const shown = names(app);
  assert.ok(shown.includes("Lee Left"), "a challenger who left the 6 weeks is on the Left list");
  assert.ok(shown.includes("Xan Excancelled"),
    "…and so is a member whose record is flagged left — the webhook that sets it is a later "
    + "build, and this list is ready for it");
  assert.strictEqual(shown.length, 2, "and nobody who is still with us");

  // the one question, asked of both record types
  assert.strictEqual(app.ctx.hasLeft({ outcome: "left" }), true, "a challenger's outcome");
  assert.strictEqual(app.ctx.hasLeft({ left: true }), true, "a member's flag");
  assert.strictEqual(app.ctx.hasLeft({ outcome: "stayed" }), false, "somebody who stayed on");
  assert.strictEqual(app.ctx.hasLeft({ left: false }), false, "a member who is still a member");
  assert.strictEqual(app.ctx.hasLeft({}), false, "a record with neither");
  assert.strictEqual(app.ctx.hasLeft(null), false, "…and nothing at all");

  // the flag is a real field with a real default, so an old record does not read as undefined
  const fresh = app.ctx.migrateRetentionList([{ id: "m", name: "Old Record" }])[0];
  assert.strictEqual(fresh.left, false, "migration defaults the member's left flag to false");
  assert.strictEqual(app.ctx.hasLeft(fresh), false, "…so an existing member is not on the Left list");
  const flagged = app.ctx.migrateRetentionList([{ id: "m", name: "Gone", left: true }])[0];
  assert.strictEqual(flagged.left, true, "…and migration does not clobber one that is set");
}

/* ---------- 4: Everyone is the tab as it was ---------- */
{
  const app = gym();
  app.ctx.setBirthdayFilter("everyone");
  const shown = names(app);
  for (const anyone of ["Ada Active", "Lee Left", "Mo Member", "Xan Excancelled"]) {
    assert.ok(shown.includes(anyone), "Everyone shows " + anyone);
  }
  assert.strictEqual(shown.length, 4, "all four, on one list");

  // and an unknown filter changes nothing rather than emptying the tab
  assert.strictEqual(app.ctx.setBirthdayFilter("nonsense"), "everyone", "junk is refused");
  assert.strictEqual(names(app).length, 4, "…and the list is untouched");
}

/* ---------- 5: the badge on Left is the nudge that list is allowed ----------
   Active does not carry a count: it is routine work and the tab's own dot already says there
   is some. Left does, because a discretionary list nobody is prompted to open is a list nobody
   opens — and it counts birthdays COMING UP rather than everybody on it, so the number means
   "there are calls to make this month" rather than "here is how many people have ever left". */
{
  const app = gym();                       // Lee and Xan both have a birthday today
  assert.strictEqual(filter(app, "left").badge, 2, "two left people have a birthday coming up");
  assert.strictEqual(filter(app, "active").badge, null, "Active carries no count");
  assert.strictEqual(filter(app, "everyone").badge, null, "…nor Everyone");

  // it is the ones COMING UP, not the ones on the list
  const later = boot({ members: [challenger("l", "Lee Left", dobLater, { outcome: "left" })] });
  assert.strictEqual(names(later).length, 0, "sanity: he is not on Active");
  assert.strictEqual(filter(later, "left").badge, null,
    "a left person whose birthday is months away raises no badge — and no badge at zero, "
    + "because a nought on a discretionary list is a thing to read and dismiss every morning");

  // and it does not care which filter is open
  app.ctx.setBirthdayFilter("everyone");
  assert.strictEqual(filter(app, "left").badge, 2, "the count is the same from any list");

  // ignoring somebody takes them out of the count, exactly as it takes them off the tab
  const one = boot({ members: [
    challenger("l", "Lee Left", dobToday, { outcome: "left" }),
    challenger("i", "Ivy Ignored", dobToday, { outcome: "left", birthdayIgnored: true }),
  ] });
  assert.strictEqual(filter(one, "left").badge, 1,
    "an ignored birthday is off the tab, so it cannot nudge from the filter row either");
}

/* ---------- 6: the routine dot stays routine ----------
   The dot on the Birthdays tab means "go and look" — and the tab it points at opens on Active.
   A dot lit by somebody on the Left list would send a coach to a screen that person is not on,
   which is worse than no dot at all. */
{
  const leftOnly = boot({ members: [challenger("l", "Lee Left", dobToday, { outcome: "left" })] });
  assert.strictEqual(leftOnly.el("bdayDot").classList.contains("on"), false,
    "a birthday belonging only to somebody who has left does not light the tab");
  assert.strictEqual(leftOnly.el("retBdayDot").classList.contains("on"), false,
    "…on either tracker's tab");
  assert.strictEqual(filter(leftOnly, "left").badge, 1,
    "…it asks for attention on the Left filter instead, which is where it lives");

  const active = boot({ members: [challenger("a", "Ada Active", dobToday)] });
  assert.strictEqual(active.el("bdayDot").classList.contains("on"), true,
    "a routine birthday lights it, exactly as it always did");

  /* The same line drawn on Today's moves: a birthday belonging to somebody who has left is not
     pushed as a task there either, so the two screens say one thing. It is off the daily list
     and on this tab under Left, which is where a decision belongs — see birthday-today. */
  assert.ok(!leftOnly.html("todayList").includes('id="act-l-birthday"'),
    "…and raises no birthday task on Today's moves");
  leftOnly.ctx.setBirthdayFilter("left");
  assert.ok(leftOnly.html("birthdayList").includes("Lee Left"),
    "…while still being on this tab, under Left, exactly as before");

  const both = boot({ members: [
    challenger("a", "Ada Active", dobToday),
    challenger("l", "Lee Left", dobToday, { outcome: "left" }),
  ] });
  assert.strictEqual(both.el("bdayDot").classList.contains("on"), true,
    "…and one of each still lights it, on the active one's account");
}

/* ---------- 7: every card feature still works inside every list ----------
   The filter decides WHO is on the list and nothing else. */
{
  const app = boot({ members: [
    challenger("l", "Lee Left", dobToday, { outcome: "left" }),
  ], retention: [
    member("x", "Xan Excancelled", dobToday, { left: true }),
    member("r", "Mo Member", dobLater),
  ] });
  app.ctx.setBirthdayFilter("left");
  const h = app.html("birthdayList");

  assert.ok(/<div class="group-label">/.test(h), "the months are still months");
  assert.ok(/<span class="bday-day">/.test(h), "…with ordinal days down the side");
  assert.ok(/class="bday-today"/.test(h), "…and today's birthday is still flagged as today's");
  assert.ok(/6-week challenge/i.test(h) && /full member/i.test(h),
    "both type tags still say which list somebody came off");
  assert.ok(/class="notes-btn/.test(h), "the notes icon is still on the row");
  assert.ok(/toggleBirthdayActioned\('l'\)/.test(h) && /setBirthdayIgnored\('l',true\)/.test(h),
    "Actioned and Ignore are still wired, and still to the right record");
  assert.ok(/toggleBirthdayActioned\('x','retention'\)/.test(h),
    "…including a member's, which writes back to the member roster");

  // and they still DO something from inside the filtered list
  app.ctx.toggleBirthdayActioned("l");
  assert.ok(app.find("l").birthdayActionedYear, "Actioned wrote to the challenger's record");
  assert.ok(/bday-row[^"]*actioned/.test(app.html("birthdayList")),
    "…and the row says so, inside the filtered list");
  app.ctx.setBirthdayIgnored("x", true, "retention");
  assert.strictEqual(app.findMember("x").birthdayIgnored, true, "Ignore wrote to the member's");

  // the milestone treatment, in the Left list
  const milestone = boot({ members: [
    challenger("m", "Milly Milestone", (Y - 40) + "-" + pad(today.getMonth() + 1) + "-"
      + pad(today.getDate()), { outcome: "left" }),
  ] });
  milestone.ctx.setBirthdayFilter("left");
  assert.ok(/Turning 40/.test(milestone.html("birthdayList")), "a milestone is still called out");
  assert.ok(/bday-row milestone/.test(milestone.html("birthdayList")), "…and still marked on the row");
}

/* ---------- 8: the dedup, and the demo props ---------- */
{
  // somebody who converted is one person on this tab, and the filter reads their CURRENT
  // status — the member record — not the challenger record they were promoted from
  const app = boot({
    members: [challenger("c", "Sam Doyle", dobLater, { outcome: "stayed" })],
    retention: [member("m", "Sam Doyle", dobLater, { fromChallenger: "c", left: true })],
  });
  assert.strictEqual(names(app).length, 0, "Active does not show them: the member has left");
  app.ctx.setBirthdayFilter("left");
  assert.deepStrictEqual(names(app), ["Sam Doyle"], "…they are on Left, once, as the member");
  app.ctx.setBirthdayFilter("everyone");
  assert.strictEqual(names(app).filter((n) => n === "Sam Doyle").length, 1,
    "and still once on Everyone — the dedup is untouched by any of this");

  // the demo props demonstrate a routine card, so they sit the Left list out
  const eg = boot({ members: [] });
  eg.ctx.toggleBirthdayExamples();
  assert.ok(/bday-examples/.test(eg.html("birthdayList")), "the examples show on Active");
  eg.ctx.setBirthdayFilter("everyone");
  assert.ok(/bday-examples/.test(eg.html("birthdayList")), "…and on Everyone");
  eg.ctx.setBirthdayFilter("left");
  assert.ok(!/bday-examples/.test(eg.html("birthdayList")),
    "…but not on Left: two people who do not exist have not left anywhere");
}

/* ---------- 9: an empty list says which kind of empty it is ----------
   Three different things "nothing here" can mean, and only one of them is a job to go and do. */
{
  const nobody = boot({ members: [challenger("n", "No Dob", null)] });
  assert.ok(nobody.html("birthdayList").includes("No birthdays on file yet"),
    "nobody on file at all: the how-to");

  const allGone = boot({ members: [challenger("l", "Lee Left", dobLater, { outcome: "left" })] });
  assert.ok(allGone.html("birthdayList").includes("No birthdays on this list"),
    "Active emptied by the filter says so — the dates are on file, they are on the other list");
  assert.ok(!allGone.html("birthdayList").includes("No birthdays on file yet"),
    "…and does NOT tell a coach to go and add some");

  allGone.ctx.setBirthdayFilter("left");
  assert.ok(allGone.html("birthdayList").includes("Lee Left"), "…where they are");

  const noneLeft = boot({ members: [challenger("a", "Ada Active", dobLater)] });
  noneLeft.ctx.setBirthdayFilter("left");
  assert.ok(noneLeft.html("birthdayList").includes("Nobody who has left has a birthday on file"),
    "an empty Left list says what would put somebody on it");
}

/* ---------- 10: the filter is this screen's business and nobody else's ---------- */
{
  const app = gym();
  app.ctx.setBirthdayFilter("left");
  assert.strictEqual(app.stored("bsj_birthday_filter"), null, "no localStorage key");
  assert.ok(!/birthdayFilter/.test(JSON.stringify(app.cached())), "nothing of it in the roster blob");
  assert.ok(!/localStorage[^\n]*birthdayFilter|birthdayFilter[^\n]*localStorage/.test(HTML),
    "the filter touches localStorage nowhere");
  assert.ok(!/key=eq\.[^']*(filter|birthday)/i.test(HTML),
    "…and no realtime subscription carries it");

  // both trackers' Birthdays tabs are the same screen, so they show the same list
  assert.strictEqual(app.html("birthdayList"), app.html("retBirthdayList"),
    "one merged tab, painted into both hosts — including its filter row");
}

console.log("birthday-filter.test.cjs: OK");
