// One person, one birthday card.
//
// Converting does not MOVE a challenger, it copies them: the challenger record stays where it
// is — still counted by the conversion bar, still on their card, still with their journey —
// and a member record is created beside it. That is right, and it is also why the merged
// Birthdays tab showed a converted person twice, once tagged 6-week challenge and once Full
// member. The member wins, because current status wins: they ARE a full member now, and the
// card that goes out goes to a member.
//
// The dangerous half of this is the matching, and most of this file is about what must NOT
// match. Merging two different people hides one of them from the tab and puts somebody else's
// Ignore on their record — far worse than the duplicate row it was trying to fix. So: the
// handoff link, then email where both sides have one, and never a name.
const assert = require("assert");
const { boot, daysFromToday } = require("./lib/env.cjs");

const at = (n, age) => {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n);
  const p = (x) => String(x).padStart(2, "0");
  return (d.getFullYear() - age) + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
};

const challenger = (id, name, dob, extra) => Object.assign({
  id, name, coach: "Dan", dob, personal: "", email: "",
  day0: daysFromToday(-60), booked: daysFromToday(-60), firstSessionDone: true,
  completed: ["intro", "d1_text", "d3_postcard", "wk2", "wk3", "wk4", "wk5", "wk6"],
  doneMeta: {}, checks: {}, missed: [],
  outcome: "stayed", signedUp: true, extraDays: 0, pausedDays: 0, pausedAt: null,
  followUpOn: null, followUpStatus: null, notes: "",
}, extra || {});
// settled members: far enough in and caught up, so a tracker's badge is its birthday alone
const member = (id, name, dob, extra) => Object.assign({
  id, name, coach: "Grace", email: "", personal: "", notes: "", dob,
  joined: daysFromToday(-200), fromChallenger: null,
  completed: ["welcome_card", "day30", "day60"], missed: [], doneMeta: {}, attendance: {},
}, extra || {});

const tab = (app) => app.html("birthdayList");
const rows = (app) => tab(app).split('<div class="bday-row').slice(1);
const rowsNamed = (app, name) => rows(app).filter((r) => r.includes(name));
const tagOf = (row) => (/bday-type [a-z]+">([^<]*)/.exec(row) || [, ""])[1];
const onbGroup = (app) => {
  const h = app.html("todayList");
  const i = h.indexOf("Birthdays this week");
  if (i === -1) return "";
  const end = h.indexOf('<div class="board">', i);
  return end === -1 ? h.slice(i) : h.slice(i, end);
};
const retGroup = (app) => {
  const h = app.html("retTodayList");
  const i = h.indexOf("Birthdays this week");
  return i === -1 ? "" : h.slice(i);
};

/* ---------- 1: the handoff link — one card, and it is the member's ---------- */
{
  const app = boot({
    members: [challenger("c1", "Sam Doyle", at(3, 30))],
    retention: [member("r1", "Sam Doyle", at(3, 30), { fromChallenger: "c1" })],
  });
  const shown = rowsNamed(app, "Sam Doyle");
  assert.strictEqual(shown.length, 1, "one card, not two");
  assert.strictEqual(tagOf(shown[0]), "Full member", "…and it is the member's");
  assert.ok(!/6-week challenge/.test(tab(app)), "the challenger's card is gone from the tab");

  // the member's own line and actions are what show
  assert.ok(/<div class="bday-meta">Coach Grace<\/div>/.test(shown[0]), "the member's line");
  assert.ok(/setBirthdayIgnored\('r1',true,'retention'\)/.test(shown[0]),
    "…and actions that write to the member record");
}

/* ---------- 2: the real handoff produces exactly one card ----------
   Driven through setOutcome rather than hand-built, so the fixture cannot drift from what the
   app actually writes when a coach marks somebody Stayed on. */
{
  const app = boot({ members: [challenger("c1", "Sam Doyle", at(3, 30), { outcome: null })] });
  assert.strictEqual(rowsNamed(app, "Sam Doyle").length, 1, "one card before converting");
  assert.strictEqual(tagOf(rowsNamed(app, "Sam Doyle")[0]), "6-week challenge");

  app.ctx.setOutcome("c1", "stayed");
  assert.strictEqual(app.retention().length, 1, "sanity: a member record was created");
  assert.strictEqual(app.retention()[0].fromChallenger, "c1", "…linked to the challenger");

  const shown = rowsNamed(app, "Sam Doyle");
  assert.strictEqual(shown.length, 1, "still one card after converting");
  assert.strictEqual(tagOf(shown[0]), "Full member", "…and the tag has changed hands");
}

/* ---------- 3: email is the fallback, for a pair with no link ---------- */
{
  const app = boot({
    members: [challenger("c1", "Sam Doyle", at(3, 30), { email: "  SAM.Doyle@Example.COM " })],
    retention: [member("r1", "Sam Doyle", at(3, 30), { email: "sam.doyle@example.com" })],
  });
  assert.strictEqual(app.retention()[0].fromChallenger, null, "sanity: nothing links them");
  const shown = rowsNamed(app, "Sam Doyle");
  assert.strictEqual(shown.length, 1, "an email match is enough");
  assert.strictEqual(tagOf(shown[0]), "Full member", "…and the member still wins");
}

/* ---------- 4: what must NOT match ----------
   The expensive mistake is the other one. Merging two different people hides a real birthday
   and puts somebody else's Ignore on their record, so every one of these stays two rows. */
{
  // the same name, on two different people — the case this rule exists for
  const names = boot({
    members: [challenger("c1", "Sarah Jones", at(3, 30))],
    retention: [member("r1", "Sarah Jones", at(4, 41))],
  });
  assert.strictEqual(rowsNamed(names, "Sarah Jones").length, 2,
    "two people can share a name and both keep their birthday");
  assert.deepStrictEqual(rowsNamed(names, "Sarah Jones").map(tagOf).sort(),
    ["6-week challenge", "Full member"], "…one of each, tagged apart");

  // the same name AND the same day, which is as close as a coincidence gets
  const sameDay = boot({
    members: [challenger("c1", "Sarah Jones", at(3, 30))],
    retention: [member("r1", "Sarah Jones", at(3, 41))],
  });
  assert.strictEqual(rowsNamed(sameDay, "Sarah Jones").length, 2, "still two people");

  // an email on one side only proves nothing
  const oneSided = boot({
    members: [challenger("c1", "Sam Doyle", at(3, 30), { email: "sam@example.com" })],
    retention: [member("r1", "Sam Doyle", at(3, 30), { email: "" })],
  });
  assert.strictEqual(rowsNamed(oneSided, "Sam Doyle").length, 2, "an email on one side is not a match");

  // …nor two empty ones, which are equal and mean nothing
  const empties = boot({
    members: [challenger("c1", "Sam Doyle", at(3, 30), { email: "   " })],
    retention: [member("r1", "Sam Doyle", at(3, 30), { email: "" })],
  });
  assert.strictEqual(rowsNamed(empties, "Sam Doyle").length, 2, "two blank emails are not a match");

  // different emails are different people, whatever they are called
  const diff = boot({
    members: [challenger("c1", "Sam Doyle", at(3, 30), { email: "sam.d@example.com" })],
    retention: [member("r1", "Sam Doyle", at(3, 30), { email: "sam.doyle@example.com" })],
  });
  assert.strictEqual(rowsNamed(diff, "Sam Doyle").length, 2, "different emails, different people");

  // a fromChallenger pointing at nobody drops nobody
  const dangling = boot({
    members: [challenger("c1", "Sam Doyle", at(3, 30))],
    retention: [member("r1", "Ann Other", at(4, 31), { fromChallenger: "gone-long-ago" })],
  });
  assert.strictEqual(rowsNamed(dangling, "Sam Doyle").length, 1, "the challenger is still shown");
  assert.strictEqual(tagOf(rowsNamed(dangling, "Sam Doyle")[0]), "6-week challenge");
}

/* ---------- 5: neither record is touched — this is display only ---------- */
{
  const app = boot({
    members: [challenger("c1", "Sam Doyle", at(3, 30))],
    retention: [member("r1", "Sam Doyle", at(3, 30), { fromChallenger: "c1" })],
  });
  const before = JSON.stringify(app.members());

  assert.strictEqual(app.members().length, 1, "the challenger is still on the roster");
  assert.strictEqual(app.find("c1").name, "Sam Doyle", "…intact");
  app.ctx.setMemberFilter("stayed");          // they converted, so that is their tab
  assert.ok(app.html("memberList").includes("Sam Doyle"), "…and still on the Challengers tab");
  app.ctx.renderMemberTable();
  assert.ok(app.html("todayTable").includes("Sam Doyle"), "…and in the whole-journey table");
  assert.ok(app.html("convBar").includes("100%"), "…and still counted by the conversion bar");

  // rendering the tab a few more times changes nothing about the data
  app.ctx.renderAll(); app.ctx.renderAll();
  assert.strictEqual(JSON.stringify(app.members()), before, "the roster is byte-identical");
  app.ctx.save();
  assert.strictEqual(app.cached().length, 1, "and the blob that syncs still holds them");

  // …and the member's record is equally untouched
  assert.strictEqual(app.findMember("r1").fromChallenger, "c1");
  assert.strictEqual(app.findMember("r1").birthdayIgnored, false);
}

/* ---------- 6: the counts, the dot and the ignored line count them once ---------- */
{
  const app = boot({
    members: [challenger("c1", "Sam Doyle", at(3, 30)), challenger("c2", "Ned New", at(5, 31))],
    retention: [member("r1", "Sam Doyle", at(3, 30), { fromChallenger: "c1" })],
  });
  // this month's group: Sam once, Ned once
  const month = tab(app).split('<div class="bday-month')[1] || "";
  assert.strictEqual(Number(/<span class="gcount">(\d+)<\/span>/.exec(month)[1]), 2,
    "the month count is two people, not three rows");
  assert.strictEqual(rows(app).length, 2, "…and there are two rows");

  // the ignored line counts the deduped list too
  const ign = boot({
    members: [challenger("c1", "Sam Doyle", at(3, 30), { birthdayIgnored: true })],
    retention: [member("r1", "Sam Doyle", at(3, 30), { fromChallenger: "c1", birthdayIgnored: true })],
  });
  assert.ok(/1 ignored/.test(tab(ign)), "one person ignored, not two");

  // the dot follows the member, not the dropped challenger
  const dot = boot({
    members: [challenger("c1", "Sam Doyle", at(2, 30), { birthdayIgnored: true })],
    retention: [member("r1", "Sam Doyle", at(2, 30), { fromChallenger: "c1" })],
  });
  assert.strictEqual(dot.el("bdayDot").classList.contains("on"), true,
    "the member is not ignored, so the dot is lit — the challenger's flag is not read");

  // and the missing-dob line counts people once
  const missing = boot({
    members: [challenger("c1", "Sam Doyle", null)],
    retention: [member("r1", "Sam Doyle", null, { fromChallenger: "c1" }),
      member("r2", "Dated Dee", at(3, 30))],
  });
  assert.ok(/1 person has no date of birth yet/.test(tab(missing)),
    "one person without a dob, not two");
}

/* ---------- 7: the birthday task happens once, on the member's tracker ----------
   Two tasks on two screens for one birthday is worse than none: they are separate records, so
   marking one done leaves the other standing and each coach can reasonably assume the other
   has it. The card, the bar and the balloons happen once, so the task does. */
{
  const app = boot({
    members: [challenger("c1", "Sam Doyle", at(2, 30))],
    retention: [member("r1", "Sam Doyle", at(2, 30), { fromChallenger: "c1" })],
  });
  assert.ok(retGroup(app).includes("Sam Doyle"), "the member raises the task");
  assert.strictEqual(onbGroup(app), "",
    "…and the challenger record does not raise a second one");
  assert.strictEqual(app.el("retTodayCount").textContent, "1", "counted once, on retention");
  assert.strictEqual(app.el("todayCount").textContent, "0", "…and not on onboarding");

  // marking it done clears it, and there is nothing left standing anywhere
  app.ctx.toggleBirthdayActioned("r1", "retention");
  assert.strictEqual(retGroup(app), "", "the task is done");
  assert.strictEqual(onbGroup(app), "", "…with nothing left on the other tracker");
  assert.strictEqual(app.find("c1").birthdayActionedYear, null,
    "and the challenger record was never involved");

  // an UNconverted challenger is unaffected by any of this
  const solo = boot({ members: [challenger("c1", "Ned New", at(2, 30), { outcome: null })] });
  assert.ok(onbGroup(solo).includes("Ned New"), "a challenger with no member record still raises one");
  assert.strictEqual(solo.el("todayCount").textContent, "1");
}

/* ---------- 8: a big roster with no duplicates in it is untouched ----------
   The member list is the whole gym and the dedup runs over it on every render, so the cheap
   thing it must do is nothing at all when there is nothing to do. */
{
  const many = [];
  for (let i = 0; i < 40; i++) many.push(member("m" + i, "Member " + i, at((i % 7) + 1, 30 + i)));
  const app = boot({
    members: [challenger("c1", "Chris Challenger", at(3, 30))],
    retention: many,
  });
  assert.strictEqual(app.ctx.birthdaySupersededChallengers().size, 0, "nobody is superseded");
  assert.ok(tab(app).includes("Chris Challenger"), "the challenger is shown");
  assert.strictEqual(rows(app).length, 41, "…and every member beside them");
}

console.log("birthday-dedup.test.cjs: OK");
