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
const IDS = ["eg-soon", "eg-milestone"];
const seed = (state) => ({ stored: { [KEY]: JSON.stringify(state) } });

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
  const i = h.indexOf('<div class="bday-examples">');
  return i === -1 ? "" : h.slice(i, h.indexOf('<div class="bday-month'));
};
const rowsOf = (app) => blockOf(app).split('<div class="bday-row').slice(1);
const rowFor = (app, name) => rowsOf(app).find((r) => r.includes(name)) || "";
const classesOf = (row) => (/^([^>]*)>/.exec(row) || [, ""])[1].replace(/"/g, "").trim();

/* ---------- 1: both examples are on the tab, and they are the two that were asked for ---- */
{
  const app = boot({ members: [] });
  const rows = rowsOf(app);
  assert.strictEqual(rows.length, 2, "two examples");
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

  // both are unmistakably examples
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
  const app = boot({ members: [] });
  const [soon, milestone] = app.ctx.birthdayExamples();
  const today = new Date(); today.setHours(0, 0, 0, 0);

  for (const x of [soon, milestone]) {
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
  assert.ok(soon.at < milestone.at, "the nearer one is listed first");
}

/* ---------- 3: Ignore clears one away, and it stays cleared ---------- */
{
  const app = boot({ members: [] });
  app.ctx.dismissBirthdayExample("eg-soon");
  assert.strictEqual(rowsOf(app).length, 1, "one goes");
  assert.ok(!blockOf(app).includes("Jo Example"), "…the one that was ignored");
  assert.ok(blockOf(app).includes("Pat Example"), "…and only that one");
  assert.strictEqual(Number(/<span class="gcount">(\d+)<\/span>/.exec(blockOf(app))[1]), 1,
    "the block's own count comes down with it");

  // it is written down, so it survives the page being reloaded after the meeting
  assert.deepStrictEqual(JSON.parse(app.stored(KEY)).dismissed, ["eg-soon"], "the dismissal is stored");
  const reopened = boot({ members: [], stored: { [KEY]: app.stored(KEY) } });
  assert.strictEqual(rowsOf(reopened).length, 1, "…and holds on the next load");
  assert.ok(!blockOf(reopened).includes("Jo Example"));

  // ignoring the second takes the whole block with it — heading, note and all
  app.ctx.dismissBirthdayExample("eg-milestone");
  assert.strictEqual(blockOf(app), "", "the block is gone entirely, not left as an empty heading");
  assert.ok(!app.html("birthdayList").includes("for showing the team"));
  assert.ok(!app.html("birthdayList").includes("Example"), "no trace of them is left on the tab");

  // and dismissing twice is not an error, nor a duplicate
  app.ctx.dismissBirthdayExample("eg-milestone");
  assert.deepStrictEqual(JSON.parse(app.stored(KEY)).dismissed, IDS, "each id recorded once");
}

/* ---------- 4: Actioned works on them too, so it can be demonstrated ---------- */
{
  const app = boot({ members: [] });
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
  const app = boot({ members: [
    person("r", "Real Rita", null),
    person("y", "Real Ray", (new Date().getFullYear() - 33) + "-06-14"),
  ] });
  assert.strictEqual(rowsOf(app).length, 2, "sanity: the examples are on screen");

  // the roster, and the blob that syncs to every other device
  assert.deepStrictEqual(app.members().map((m) => m.name), ["Real Rita", "Real Ray"], "not in the roster");
  app.ctx.save();          // boot seeds the list without writing; this is what a real edit does
  assert.deepStrictEqual(app.cached().map((m) => m.name), ["Real Rita", "Real Ray"], "not in what syncs");
  for (const id of IDS) {
    assert.strictEqual(app.find(id), undefined, id + " is not a challenger");
  }

  // every screen a challenger would appear on
  assert.ok(!app.html("memberList").includes("Example"), "not on the Challengers tab");
  assert.ok(!app.html("todayList").includes("Example"), "not on Today's moves");
  app.ctx.renderMemberTable();
  assert.ok(!app.html("todayTable").includes("Example"), "not in the whole-journey table");
  assert.ok(!app.html("convBar").includes("Example"), "not in the conversion bar");
  assert.ok(!app.html("retBirthdayList").includes("Example"), "and not on the members' Birthdays tab");

  // the counts on the tab itself
  assert.strictEqual(app.el("liveCount").textContent, "2", "the masthead counts the real two");
  const months = app.html("birthdayList").split('<div class="bday-month').slice(1).join("");
  assert.ok(!months.includes("Example"), "no month group has one smuggled into it");

  // "1 challenger has no date of birth yet" is about Rita, and only Rita
  assert.ok(/1 challenger has no date of birth yet/.test(app.html("birthdayList")),
    "the missing-dob line counts real people only");
}

/* ---------- 6: they never light the dot on the tab ----------
   The dot is a nudge about a real person, so a made-up one must not be able to raise it —
   that would be the prop telling a coach to go and do something. */
{
  const app = boot({ members: [] });
  assert.strictEqual(rowsOf(app).length, 2, "the examples are showing");
  assert.strictEqual(app.el("bdayDot").classList.contains("on"), false,
    "…and the tab's dot is dark, because nobody real has a birthday coming");
  assert.strictEqual(app.ctx.birthdaysSoon(app.members()), false);
}

/* ---------- 7: a broken or missing stored state is just "show both" ---------- */
{
  for (const bad of ["not json", "null", "[]", '{"dismissed":"eg-soon"}', "{}"]) {
    const app = boot({ members: [], stored: { [KEY]: bad } });
    assert.strictEqual(rowsOf(app).length, 2, "a state of " + bad + " shows both rather than throwing");
  }
  const partial = boot({ members: [], stored: { [KEY]: JSON.stringify({ dismissed: ["eg-soon"] }) } });
  assert.strictEqual(rowsOf(partial).length, 1, "a state with no `actioned` key still reads its dismissals");
}

console.log("birthday-examples.test.cjs: OK");
