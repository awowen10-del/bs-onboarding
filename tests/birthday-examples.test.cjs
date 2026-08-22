// The two demo cards at the top of the onboarding Birthdays tab.
//
// They exist because a month with nobody's birthday in it is impossible to demonstrate: the
// tab is working perfectly and there is nothing on it to point at. So there are two people
// who do not exist — one ordinary birthday coming up, one milestone — and Ignore sweeps them
// away when the meeting is over.
//
// Most of this file is about what they must NOT touch. A fake person that leaks into the
// roster would show up in the conversion bar, the Challengers tabs, the whole-journey table
// and the blob that syncs to everybody else's phone, and the first coach to find one there
// would be right to stop trusting every number on the screen. So: not in members, not in the
// cache, not in a month count, not in the dot. Those are asserted one at a time.
const assert = require("assert");
const { boot, daysFromToday } = require("./lib/env.cjs");

const KEY = "bsj_bday_examples";
const IDS = ["eg-soon", "eg-member", "eg-milestone"];   // two challengers and a member

// The examples are behind a toggle and OFF by default, so almost every block here has to open
// it first. bootShown does that; block 8 is the one that checks the default state itself.
const bootShown = (opts) => {
  const app = boot(opts);
  app.ctx.toggleBirthdayExamples();
  return app;
};

const person = (id, name, dob) => ({
  id, name, coach: "Dan", dob, personal: "",
  day0: daysFromToday(-8), booked: daysFromToday(-8), firstSessionDone: true,
  completed: ["intro"], doneMeta: {}, checks: {}, missed: [],
  outcome: null, signedUp: false, extraDays: 0, pausedDays: 0, pausedAt: null,
  followUpOn: null, followUpStatus: null, notes: "",
});

// the examples block, and the rows inside it
const blockOf = (app) => {
  const h = app.html("birthdayList");
  const i = h.indexOf('<div class="bday-examples"');
  if (i === -1) return "";
  const end = h.indexOf('<div class="bday-month', i);      // -1 when no real birthdays follow
  return end === -1 ? h.slice(i) : h.slice(i, end);
};
// the "Birthdays this week" group on the onboarding Today's moves
const todayGroup = (app) => {
  const h = app.html("todayList");
  const i = h.indexOf("Birthdays this week");
  if (i === -1) return "";
  const end = h.indexOf('<div class="board">', i);
  return end === -1 ? h.slice(i) : h.slice(i, end);
};
const toggleLine = (app) => {
  const m = /<div class="bday-examples-toggle">([\s\S]*?)<\/div>/.exec(app.html("birthdayList"));
  return m ? m[1] : "";
};
const rowsOf = (app) => blockOf(app).split('<div class="bday-row').slice(1);
const rowFor = (app, name) => rowsOf(app).find((r) => r.includes(name)) || "";
const classesOf = (row) => (/^([^>]*)>/.exec(row) || [, ""])[1].replace(/"/g, "").trim();

/* ---------- 1: both examples are on the tab, and they are the two that were asked for ---- */
{
  const app = bootShown({ members: [] });
  const rows = rowsOf(app);
  assert.strictEqual(rows.length, 3, "three examples: two challengers and a member");
  assert.ok(blockOf(app).includes("Example — for showing the team"), "under a heading that says so");

  // one ordinary birthday coming up…
  const jo = rowFor(app, "Jo Example");
  assert.ok(jo, "there is an ordinary one");
  assert.ok(!/🎉/.test(jo), "…with no milestone badge, because that is the point of it");
  assert.ok(!/\bmilestone\b/.test(classesOf(jo)), "…and no milestone accent");

  // …and one milestone
  const pat = rowFor(app, "Pat Example");
  assert.ok(/🎉 Turning 50/.test(pat), "the other is turning 50");
  assert.ok(/\bmilestone\b/.test(classesOf(pat)), "…and carries the milestone accent");

  // …and a member, which is the one that proves the SCOPING rather than the features
  const mel = rowFor(app, "Mel Example");
  assert.ok(mel, "there is a member example");
  assert.ok(/bday-type member">Full member</.test(mel), "…tagged as a full member");
  assert.ok(!/bday-type challenge/.test(mel), "…and never as a challenger");
  assert.ok(/bday-type challenge">6-week challenge</.test(jo), "while Jo is tagged a challenger");
  assert.ok(!/bday-type member/.test(jo));

  // all three are unmistakably examples
  for (const r of rows) {
    assert.ok(/bday-example-tag">Example</.test(r), "every row is tagged as an example");
    assert.ok(/\bexample\b/.test(classesOf(r)), "…and marked on the row for the dashed edge");
    assert.ok(!/notes-btn/.test(r), "…with no notes icon: there is nobody behind it to keep notes on");
  }
}

/* ---------- 2: their dates are always still to come, whenever the meeting happens ----------
   Built forward from today rather than written down, so this demonstrates an UPCOMING
   birthday in March as well as it does in August. The milestone one really is a milestone by
   the app's own rule — the treatment being shown is the treatment, not a mock-up of it. */
{
  const app = bootShown({ members: [] });
  const all = app.ctx.birthdayExamples();
  const byId = (id) => all.find((x) => x.id === id);
  const soon = byId("eg-soon"), milestone = byId("eg-milestone"), mem = byId("eg-member");
  const today = new Date(); today.setHours(0, 0, 0, 0);

  for (const x of [soon, mem, milestone]) {
    assert.ok(app.ctx.dobParts(x.dob), x.name + " has a real date of birth: " + x.dob);
    const nb = app.ctx.nextBirthday(x);
    assert.ok(nb, "…that the app's own rule can read");
    assert.ok(x.at > today.getTime(), x.name + "'s birthday is still ahead of us");
    assert.strictEqual(nb.year, new Date(x.at).getFullYear(), "…and it is the one being shown");
    assert.strictEqual(nb.d, new Date(x.at).getDate(), "…on the day the card prints");
  }
  assert.strictEqual(app.ctx.birthdayMilestone(soon), null, "the ordinary one is not a milestone");
  assert.strictEqual(app.ctx.birthdayMilestone(milestone), 50,
    "…and the milestone one is 50 by the same rule a real challenger goes through");
  assert.ok(soon.at < mem.at && mem.at < milestone.at,
    "they are ordered by date, and interleaved so the merged tab's sort is visible");
  assert.strictEqual(app.ctx.birthdayExampleScope(mem), "retention", "one of them is a member");
  assert.strictEqual(app.ctx.birthdayExampleScope(soon), "onboarding", "…and two are challengers");
  assert.strictEqual(app.ctx.birthdayExampleScope(milestone), "onboarding");
}

/* ---------- 3: Ignore clears one away, and it stays cleared ---------- */
{
  const app = bootShown({ members: [] });
  app.ctx.dismissBirthdayExample("eg-soon");
  assert.strictEqual(rowsOf(app).length, 2, "one goes");
  assert.ok(!blockOf(app).includes("Jo Example"), "…the one that was ignored");
  assert.ok(blockOf(app).includes("Pat Example") && blockOf(app).includes("Mel Example"),
    "…and only that one");
  assert.strictEqual(Number(/<span class="gcount">(\d+)<\/span>/.exec(blockOf(app))[1]), 2,
    "the block's own count comes down with it");

  // it is written down, so it survives the page being reloaded after the meeting
  assert.deepStrictEqual(JSON.parse(app.stored(KEY)).dismissed, ["eg-soon"], "the dismissal is stored");
  const reopened = bootShown({ members: [], stored: { [KEY]: app.stored(KEY) } });
  assert.strictEqual(rowsOf(reopened).length, 2, "…and holds on the next load");
  assert.ok(!blockOf(reopened).includes("Jo Example"));

  // ignoring the rest takes the whole block with it — heading, note and all
  app.ctx.dismissBirthdayExample("eg-member");
  app.ctx.dismissBirthdayExample("eg-milestone");
  assert.strictEqual(blockOf(app), "", "the block is gone entirely, not left as an empty heading");
  assert.ok(!app.html("birthdayList").includes("for showing the team"));
  assert.ok(!app.html("birthdayList").includes("Example"), "no trace of them is left on the tab");

  // and dismissing twice is not an error, nor a duplicate
  app.ctx.dismissBirthdayExample("eg-milestone");
  assert.deepStrictEqual(JSON.parse(app.stored(KEY)).dismissed.slice().sort(), IDS.slice().sort(),
    "each id recorded once");
}

/* ---------- 4: Actioned works on them too, so it can be demonstrated ---------- */
{
  const app = bootShown({ members: [] });
  assert.ok(!/\bactioned\b/.test(classesOf(rowFor(app, "Pat Example"))), "nothing starts handled");

  app.ctx.toggleExampleActioned("eg-milestone");
  const pat = rowFor(app, "Pat Example");
  assert.ok(/\bactioned\b/.test(classesOf(pat)), "the row goes to the handled state");
  assert.ok(/✓ Actioned/.test(pat) && /aria-pressed="true"/.test(pat), "…and the button with it");
  assert.ok(/🎉 Turning 50/.test(pat), "…while the milestone badge stays: it is still their 50th");
  assert.ok(!/\bactioned\b/.test(classesOf(rowFor(app, "Jo Example"))), "the other is untouched");

  app.ctx.toggleExampleActioned("eg-milestone");
  assert.ok(!/\bactioned\b/.test(classesOf(rowFor(app, "Pat Example"))), "and it toggles back");
  assert.deepStrictEqual(JSON.parse(app.stored(KEY)).actioned, [], "…leaving nothing behind");
}

/* ---------- 5: they are a prop, so nothing real may know they exist ----------
   The load-bearing block. Each of these is somewhere a fake person would do damage. */
{
  // one real person with a date of birth and one without, so every count on the tab has
  // something real to be about and the examples have somewhere to go wrong
  const app = bootShown({ members: [
    person("r", "Real Rita", null),
    person("y", "Real Ray", (new Date().getFullYear() - 33) + "-06-14"),
  ] });
  assert.strictEqual(rowsOf(app).length, 3, "sanity: the examples are on screen");

  // the roster, and the blob that syncs to every other device
  assert.deepStrictEqual(app.members().map((m) => m.name), ["Real Rita", "Real Ray"], "not in the roster");
  app.ctx.save();          // boot seeds the list without writing; this is what a real edit does
  assert.deepStrictEqual(app.cached().map((m) => m.name), ["Real Rita", "Real Ray"], "not in what syncs");
  for (const id of IDS) {
    assert.strictEqual(app.find(id), undefined, id + " is not a challenger");
  }

  // every screen a challenger would appear on. Today's moves is the exception and only while
  // the toggle is on — that is what block 11 is for; everywhere else they never reach at all.
  assert.ok(!app.html("memberList").includes("Example"), "not on the Challengers tab");
  app.ctx.renderMemberTable();
  assert.ok(!app.html("todayTable").includes("Example"), "not in the whole-journey table");
  assert.ok(!app.html("convBar").includes("Example"), "not in the conversion bar");
  // the Birthdays tab is merged, so they show there from either door — tagged as the
  // challengers they are pretending to be. Block 16 is where that is nailed down.
  assert.ok(!/Jo Example|Pat Example/.test(app.html("retTodayList")),
    "and the CHALLENGER props are never on the member Today's moves — 11b is the whole split");
  assert.ok(!app.html("retMemberList").includes("Example"), "…and no prop is in the member list");

  // the counts on the tab itself
  assert.strictEqual(app.el("liveCount").textContent, "2", "the masthead counts the real two");
  const months = app.html("birthdayList").split('<div class="bday-month').slice(1).join("");
  assert.ok(!months.includes("Example"), "no month group has one smuggled into it");

  // "1 challenger has no date of birth yet" is about Rita, and only Rita
  // "person" now the tab is merged, and still ONE: Rita has no dob, the props are not counted
  assert.ok(/1 person has no date of birth yet/.test(app.html("birthdayList")),
    "the missing-dob line counts real people only");
}

/* ---------- 6: they never light the dot on the tab ----------
   The dot is a nudge about a real person, so a made-up one must not be able to raise it —
   that would be the prop telling a coach to go and do something. */
{
  const app = bootShown({ members: [] });
  assert.strictEqual(rowsOf(app).length, 3, "the examples are showing");
  assert.strictEqual(app.el("bdayDot").classList.contains("on"), false,
    "…and the tab's dot is dark, because nobody real has a birthday coming");
  assert.strictEqual(app.ctx.birthdaysSoon(app.members()), false);
}

/* ---------- 7: a broken or missing stored state is just "show both" ---------- */
{
  for (const bad of ["not json", "null", "[]", '{"dismissed":"eg-soon"}', "{}"]) {
    const app = bootShown({ members: [], stored: { [KEY]: bad } });
    assert.strictEqual(rowsOf(app).length, 3, "a state of " + bad + " shows all rather than throwing");
  }
  const partial = bootShown({ members: [], stored: { [KEY]: JSON.stringify({ dismissed: ["eg-soon"] }) } });
  assert.strictEqual(rowsOf(partial).length, 2, "a state with no `actioned` key still reads its dismissals");
}

/* ---------- 8: they are OFF by default, and the toggle is the only way in ----------
   The tab is read every week to decide who gets a card; the examples are for a team meeting
   twice a year. So the default has to be the real months, with the prop reachable rather than
   present — and the one trace of it on an ordinary day is a footnote-sized link. */
{
  const app = boot({ members: [person("r", "Real Rita", (new Date().getFullYear() - 33) + "-06-14")] });
  assert.strictEqual(app.ctx.__t.showBirthdayExamples, false, "the tab opens with them hidden");
  assert.strictEqual(blockOf(app), "", "…so there is no example block on screen");
  assert.ok(!app.html("birthdayList").includes("Jo Example"), "…and neither of them is rendered");
  assert.ok(!app.html("birthdayList").includes("for showing the team"), "…nor the heading");
  assert.ok(app.html("birthdayList").includes("Real Rita"), "the real months are what you land on");

  // the way in: one quiet control, and it says which way it goes
  assert.ok(/>Show examples</.test(toggleLine(app)), "there is a Show examples control");
  assert.ok(/toggleBirthdayExamples\(\)/.test(toggleLine(app)), "…wired to the toggle");
  assert.ok(/aria-expanded="false"/.test(toggleLine(app)), "…which reads as collapsed");

  app.ctx.toggleBirthdayExamples();
  assert.strictEqual(rowsOf(app).length, 3, "showing brings all three back");
  assert.ok(/>Hide examples</.test(toggleLine(app)), "…and the control offers the way out");
  assert.ok(/aria-expanded="true"/.test(toggleLine(app)), "…reading as expanded");

  app.ctx.toggleBirthdayExamples();
  assert.strictEqual(blockOf(app), "", "and hiding puts them away again");
  assert.ok(/>Show examples</.test(toggleLine(app)));

  // the control sits with the thing it reveals, not down in the footer under twelve months
  const h = app.html("birthdayList");
  assert.ok(h.indexOf("bday-examples-toggle") < h.indexOf("bday-month"),
    "the toggle is at the top of the tab, above the month groups");
}

/* ---------- 9: dismissal outranks the toggle, because dismissal is the permanent one ---- */
{
  const app = bootShown({ members: [] });
  app.ctx.dismissBirthdayExample("eg-soon");
  assert.ok(/bday-examples-toggle/.test(app.html("birthdayList")),
    "one example left, so the control still has something to show");

  app.ctx.dismissBirthdayExample("eg-member");
  app.ctx.dismissBirthdayExample("eg-milestone");
  assert.ok(!/bday-examples-toggle/.test(app.html("birthdayList")),
    "all cleared away for good, so the control goes too — there is nothing left to reveal");
  assert.ok(!app.html("birthdayList").includes("Example"), "no trace of any of it");

  // and it stays gone on the next load, toggle and all
  const reopened = boot({ members: [], stored: { [KEY]: app.stored(KEY) } });
  assert.ok(!/bday-examples-toggle/.test(reopened.html("birthdayList")), "…on a fresh load too");
  reopened.ctx.toggleBirthdayExamples();
  assert.strictEqual(blockOf(reopened), "", "…and asking to show them reveals nothing");
}

/* ---------- 10: the coach is off the challengers' cards, the status is not ----------
   The status is what the Ignore decision is made on — somebody who has left is somebody we
   are not sending a card to — so it has to survive the coach coming off the line. */
{
  const Y = new Date().getFullYear();
  const app = boot({ members: [
    person("a", "Ada Active", (Y - 30) + "-06-14"),
    Object.assign(person("l", "Lee Left", (Y - 30) + "-06-15"), { outcome: "left" }),
    Object.assign(person("p", "Pam Paused", (Y - 30) + "-06-16"), { pausedAt: daysFromToday(-3) }),
    Object.assign(person("f", "Fay Finished", (Y - 30) + "-06-17"),
      { day0: daysFromToday(-60), booked: daysFromToday(-60) }),
  ] });
  app.ctx.setBirthdayFilter("everyone");     // Lee has left, and this is about all four lines
  const h = app.html("birthdayList");
  assert.ok(!/Coach/.test(h), "no coach's name anywhere on the tab");

  const metaFor = (name) => {
    const row = h.split('<div class="bday-row').find((r) => r.includes(name)) || "";
    return (/<div class="bday-meta">([\s\S]*?)<\/div>/.exec(row) || [, ""])[1];
  };
  assert.strictEqual(metaFor("Ada Active"), "on the journey");
  assert.strictEqual(metaFor("Lee Left"), "left", "the one the Ignore decision turns on");
  assert.strictEqual(metaFor("Pam Paused"), "paused");
  assert.strictEqual(metaFor("Fay Finished"), "finished the 6 weeks");

  // the example cards read the same way, so the demo shows what the tab actually does
  app.ctx.toggleBirthdayExamples();
  assert.ok(/<div class="bday-meta">on the journey · /.test(rowFor(app, "Jo Example")),
    "an example's line is the status and its date, with no coach in front of it");
}

/* ---------- 11: one toggle, two screens — and OFF is off everywhere ----------
   The examples now raise birthday tasks on Today's moves as well as sitting on the Birthdays
   tab, which puts a made-up person on the screen a coach opens every morning. So the default
   matters more than it did: off has to mean off on BOTH, and one press has to move both. */
{
  const real = person("r", "Real Rita", null);          // day 8, so the day has real work on it

  // OFF — and this is the default
  const app = boot({ members: [real] });
  assert.strictEqual(app.ctx.__t.showBirthdayExamples, false, "the default is off");
  assert.ok(!app.html("todayList").includes("Jo Example"), "no prop on Today's moves");
  assert.ok(!app.html("todayList").includes("Pat Example"));
  assert.ok(!app.html("todayList").includes("Example — for showing the team"));
  assert.strictEqual(app.ctx.birthdayExampleTasks("onboarding").length, 0, "…none are due as tasks");
  assert.strictEqual(app.ctx.birthdayExampleTasks("retention").length, 0, "…on either tracker");
  assert.ok(!app.html("retTodayList").includes("Mel Example"), "…and no member prop either");
  assert.ok(!app.html("birthdayList").includes("Jo Example"), "…and none on the Birthdays tab");

  // ON — one press, and they arrive on both
  app.ctx.toggleBirthdayExamples();
  assert.ok(todayGroup(app).includes("Jo Example"), "Jo is a birthday task now");
  assert.ok(todayGroup(app).includes("Pat Example"), "…and Pat");
  assert.strictEqual(app.ctx.birthdayExampleTasks("onboarding").length, 2, "both challengers");
  assert.strictEqual(app.ctx.birthdayExampleTasks("retention").length, 1, "…and the member");
  assert.ok(app.html("retTodayList").includes("Mel Example"), "Mel is a task on the member day");
  assert.ok(app.html("birthdayList").includes("Jo Example"), "…and all three are on the tab");
  assert.ok(app.html("birthdayList").includes("Mel Example"));

  // OFF again — the same one press takes them off all three screens
  app.ctx.toggleBirthdayExamples();
  assert.ok(!app.html("todayList").includes("Jo Example"), "hiding clears Today's moves");
  assert.ok(!app.html("retTodayList").includes("Mel Example"), "…and the member's");
  assert.ok(!app.html("birthdayList").includes("Example — for showing"), "…and the tab, together");
}

/* ---------- 11b: each prop lands on ONE tracker's day, and that is the point of Mel ----------
   Two challenger props demonstrate the features. A member beside them demonstrates the rule
   that cannot be pointed at with one kind of person on screen: a birthday task belongs to the
   tracker the person is on. It is also the rule most likely to be got wrong later. */
{
  const app = bootShown({ members: [], retention: [] });

  const onb = todayGroup(app);
  assert.ok(onb.includes("Jo Example") && onb.includes("Pat Example"),
    "the challenger props are onboarding work");
  assert.ok(!onb.includes("Mel Example"),
    "…and the member prop is NOT — a member's birthday is not a challenger coach's job");

  const ret = app.html("retTodayList");
  assert.ok(ret.includes("Mel Example"), "the member prop is retention work");
  assert.ok(!/Jo Example|Pat Example/.test(ret), "…and the challenger props are not");

  // both days mark them as props, under the same line
  for (const h of [onb, ret]) {
    assert.ok(/<div class="today-example-label">Example — for showing the team/.test(h),
      "a line introduces them on both days");
  }
  const mel = ret.split('<div class="action').find((r) => r.includes("Mel Example")) || "";
  assert.ok(/bday-example-tag">Example</.test(mel), "Mel's task is tagged as an example");
  assert.ok(/^ birthday[^"]*\bexample\b/.test(mel), "…and marked on the row");
  assert.ok(!/notes-btn/.test(mel), "…with no notes icon");
  for (const step of [...app.ctx.__t.BIRTHDAY_STEPS]) {
    assert.ok(mel.includes(step), "…and lists “" + step + "”");
  }
  assert.ok(/toggleExampleActioned\('eg-member'\)/.test(mel),
    "its Done writes the prop's own state, never a member record");

  // marking it done clears the member day and leaves the challenger day alone
  app.ctx.toggleExampleActioned("eg-member");
  assert.ok(!app.html("retTodayList").includes("Mel Example"), "done clears it");
  assert.ok(todayGroup(app).includes("Jo Example"), "…and the challenger props are untouched");
  app.ctx.toggleExampleActioned("eg-member");
  assert.ok(app.html("retTodayList").includes("Mel Example"), "…and it comes back");
}

/* ---------- 12: on Today's moves they are unmistakably props ---------- */
{
  const app = bootShown({ members: [] });
  const h = app.html("todayList");
  const i = h.indexOf("Birthdays this week");
  const group = h.slice(i, h.indexOf('<div class="board">', i));
  const rowFor = (name) => group.split('<div class="action').find((r) => r.includes(name)) || "";

  assert.ok(/<div class="today-example-label">Example — for showing the team/.test(group),
    "a line introduces them, so the cards under it are not read as the day's work");
  for (const name of ["Jo Example", "Pat Example"]) {
    const row = rowFor(name);
    assert.ok(row, name + " has a card");
    assert.ok(/bday-example-tag">Example</.test(row), "…tagged beside the name");
    assert.ok(/^ birthday[^"]*\bexample\b/.test(row), "…and marked on the row for the dashed edge");
    assert.ok(!/notes-btn/.test(row), "…with no notes icon: there is nobody behind it");
  }

  // …while carrying everything a real card carries, because that is what is being shown
  const pat = rowFor("Pat Example");
  assert.ok(/🎉 Turning 50/.test(pat), "the milestone one is flagged the same way a real one is");
  assert.ok(/\bmilestone\b/.test(pat), "…with the same accent");
  assert.ok(/above and beyond/.test(pat), "…and the same words");
  for (const step of [...app.ctx.__t.BIRTHDAY_STEPS]) {
    assert.ok(pat.includes(step), "the card lists “" + step + "”");
  }
  assert.ok(/Birthday — /.test(pat) && /class="day">in \d+ days</.test(pat), "…and says when");
}

/* ---------- 13: marking a prop done cannot touch anything real ----------
   The wall. A real card's Done writes birthdayActionedYear on a roster record; a prop's Done
   writes an id into localStorage. If those ever became the same call, this is what would
   catch it. */
{
  const app = bootShown({ members: [
    person("r", "Real Rita", null),
    person("y", "Real Ray", (new Date().getFullYear() - 33) + "-06-14"),
  ] });
  const todayHas = (n) => app.html("todayList").includes(n);
  const before = {
    count: app.el("todayCount").textContent,
    retCount: app.el("retTodayCount").textContent,
    roster: JSON.stringify(app.members()),
    retRoster: JSON.stringify(app.retention()),
    live: app.el("liveCount").textContent,
  };
  assert.ok(todayHas("Jo Example"), "Jo is showing as a task");

  app.ctx.toggleExampleActioned("eg-soon");             // what the prop's Done button calls
  assert.ok(!todayHas("Jo Example"), "…and marking it done clears it from Today's moves");
  assert.ok(todayHas("Pat Example"), "…leaving the other one alone");
  // still on the Birthdays tab, in the handled state — done is not deleted, which is the
  // difference between Actioned and Ignore and the point of demonstrating both
  const joRow = rowFor(app, "Jo Example");
  assert.ok(joRow, "she is still on the Birthdays tab");
  assert.ok(/\bactioned\b/.test(classesOf(joRow)), "…showing as handled");

  // nothing real moved — and the member prop is held to the same wall
  app.ctx.toggleExampleActioned("eg-member");
  app.ctx.dismissBirthdayExample("eg-member");
  assert.strictEqual(JSON.stringify(app.members()), before.roster, "no roster record changed");
  assert.strictEqual(JSON.stringify(app.retention()), before.retRoster, "no member record changed");
  assert.strictEqual(app.el("todayCount").textContent, before.count, "the badge did not move");
  assert.strictEqual(app.el("retTodayCount").textContent, before.retCount, "nor the member badge");
  assert.strictEqual(app.el("liveCount").textContent, before.live, "nor the masthead figure");
  for (const m of app.members()) {
    assert.strictEqual(m.birthdayActionedYear, null, m.name + "'s Actioned year is untouched");
    assert.strictEqual(m.birthdayIgnored, false, "…and their ignore flag");
  }
  assert.deepStrictEqual(JSON.parse(app.stored(KEY)).actioned.slice().sort(),
    ["eg-member", "eg-soon"],
    "the props' done-ness lives in localStorage, where it cannot reach anybody");
  assert.deepStrictEqual(JSON.parse(app.stored(KEY)).dismissed, ["eg-member"], "…and so does dismissal");

  // and it is reversible, like the demo needs
  app.ctx.toggleExampleActioned("eg-soon");
  assert.ok(todayHas("Jo Example"), "un-doing brings the task back for the next run-through");
}

/* ---------- 14: the examples never inflate the day's real count ----------
   The badge on the tab is what tells a coach they have work. A prop must never add to it,
   even while it is on screen — and a clear day with the examples up must still show them
   rather than "All caught up" over the top of two visible cards. */
{
  const quiet = Object.assign(person("q", "Quiet Quinn", null), {
    day0: daysFromToday(-90), booked: daysFromToday(-90), outcome: "stayed", signedUp: true,
    completed: ["intro", "d1_text", "wk2", "wk3", "wk4", "wk5", "wk6"],
  });
  const app = boot({ members: [quiet] });
  assert.strictEqual(app.el("todayCount").textContent, "0", "nothing real is due");
  assert.ok(app.html("todayList").includes("All caught up"), "…so the day reads clear");

  app.ctx.toggleBirthdayExamples();
  assert.strictEqual(app.el("todayCount").textContent, "0",
    "the badge still says 0 — a prop is not work, however visible it is");
  assert.strictEqual(app.el("retTodayCount").textContent, "0", "…and the member badge likewise");
  assert.ok(!app.html("retTodayList").includes("All caught up"),
    "…while the member day does not claim to be empty with a card on it");
  assert.ok(!app.html("todayList").includes("All caught up"),
    "…but the screen does not claim to be empty while showing two cards");
  assert.ok(app.html("todayList").includes("Jo Example"), "…which is what it is showing");

  // the group's own count is the REAL birthdays, so it never disagrees with itself
  const g = app.html("todayList");
  assert.ok(/Birthdays this week<span class="gcount">0<\/span>/.test(g),
    "no real birthdays this week, and the count says so with the props below it");
}

/* ---------- 15: dismissing takes them off both screens ---------- */
{
  const app = bootShown({ members: [] });
  assert.ok(app.html("todayList").includes("Jo Example"));
  app.ctx.dismissBirthdayExample("eg-soon");
  assert.ok(!app.html("todayList").includes("Jo Example"), "dismissed is gone from Today's moves");
  assert.ok(!app.html("birthdayList").includes("Jo Example"), "…and from the Birthdays tab");
  assert.ok(app.html("todayList").includes("Pat Example"), "…and only the one that was dismissed");

  app.ctx.dismissBirthdayExample("eg-milestone");
  assert.ok(!app.html("todayList").includes("Example — for showing the team"),
    "with both challenger props gone the line that introduces them goes too");
  assert.ok(!app.html("todayList").includes("Example"), "no trace on Today's moves");
  assert.ok(app.html("retTodayList").includes("Mel Example"),
    "…while the member prop is untouched: dismissal is per prop, not per batch");

  app.ctx.dismissBirthdayExample("eg-member");
  assert.ok(!app.html("retTodayList").includes("Example"), "and dismissing it clears the member day");
  assert.ok(!app.html("birthdayList").includes("Example — for showing"),
    "…and with all three gone the block on the tab goes too");
}

/* ---------- 16: on the merged tab they are tagged as challengers ----------
   The Birthdays tab shows both lists now, so a prop on it has to say which kind of person it
   is pretending to be as well as that it is a prop. Two tags, and they answer different
   questions: Example says "not real", 6-week challenge says "and not a member either". */
{
  const app = bootShown({ retention: [{ id: "r1", name: "Mo Member", coach: "Dan",
    dob: (new Date().getFullYear() - 33) + "-06-14", email: "", personal: "", notes: "",
    joined: daysFromToday(-90) }] });

  for (const id of ["birthdayList", "retBirthdayList"]) {
    const h = app.html(id);
    assert.ok(h.includes("Jo Example") && h.includes("Pat Example") && h.includes("Mel Example"),
      "all three props on #" + id);
    const row = (n) => h.split('<div class="bday-row').find((r) => r.includes(n)) || "";
    for (const n of ["Jo Example", "Pat Example", "Mel Example"]) {
      assert.ok(/bday-example-tag">Example</.test(row(n)), n + " is tagged as an example");
    }
    assert.ok(/bday-type challenge">6-week challenge</.test(row("Jo Example")), "…Jo as a challenger");
    assert.ok(!/bday-type member/.test(row("Jo Example")), "…never as a member");
    assert.ok(/bday-type member">Full member</.test(row("Mel Example")), "…and Mel as a member");
    assert.ok(!/bday-type challenge/.test(row("Mel Example")), "…never as a challenger");
    // their lines read the way a real person of that kind reads
    assert.ok(/bday-meta">on the journey · /.test(row("Jo Example")), "a challenger's line is a status");
    assert.ok(/bday-meta">Coach [^<]*· /.test(row("Mel Example")), "…and a member's is their coach");
  }
  assert.strictEqual(app.html("birthdayList"), app.html("retBirthdayList"),
    "and it is the same merged screen from either tracker");

  // the real member beside them is tagged the other way, which is the whole point of the tags
  const mo = app.html("birthdayList").split('<div class="bday-row').find((r) => r.includes("Mo Member")) || "";
  assert.ok(/bday-type member">Full member</.test(mo), "the real member is tagged as one");
  assert.ok(!/bday-example-tag/.test(mo), "…and carries no Example tag");
}

console.log("birthday-examples.test.cjs: OK");
