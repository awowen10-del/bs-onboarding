// The Birthdays tab, MERGED — everybody from both lists on one screen.
//
// A birthday does not belong to Onboarding or to Retention. It belongs to a person, and the
// question a coach opens this tab to ask ("whose is coming, and what have we done about it")
// does not change because somebody finished their six weeks. Split across two tabs it meant
// checking two screens and holding the answer in your head.
//
// Two things carry the weight here and both get their own blocks. The TAG, because the member
// list is the whole gym and the challenger list is a handful of people on trial — so most of
// this tab is members and the few challengers have to be findable at a glance. And WHICH
// RECORD a row writes back to, because the two rosters are separate blobs and nothing stops
// the same id existing on both.
//
// What is NOT merged is Today's moves. That is each tracker's daily work, and a member's
// birthday is not a challenger coach's job. Block 7 holds that line.
const assert = require("assert");
const { boot, daysFromToday } = require("./lib/env.cjs");

const at = (n, age) => {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n);
  const p = (x) => String(x).padStart(2, "0");
  return (d.getFullYear() - age) + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
};
const yearOf = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.getFullYear(); };

const challenger = (id, name, dob, extra) => Object.assign({
  id, name, coach: "Dan", dob, personal: "",
  day0: daysFromToday(-8), booked: daysFromToday(-8), firstSessionDone: true,
  completed: ["intro"], doneMeta: {}, checks: {}, missed: [],
  outcome: null, signedUp: false, extraDays: 0, pausedDays: 0, pausedAt: null,
  followUpOn: null, followUpStatus: null, notes: "",
}, extra || {});
const member = (id, name, dob, extra) => Object.assign({
  id, name, coach: "Grace", email: "", personal: "", notes: "", dob,
  joined: daysFromToday(-200), fromChallenger: null,
  completed: ["welcome_card", "day30", "day60"], missed: [], doneMeta: {}, attendance: {},
}, extra || {});

const tab = (app) => app.html("birthdayList");
const rowFor = (app, name, id) =>
  app.html(id || "birthdayList").split('<div class="bday-row').find((r) => r.includes(name)) || "";
const classesOf = (row) => (/^([^>]*)>/.exec(row) || [, ""])[1].replace(/"/g, "").trim();
const metaOf = (row) => (/<div class="bday-meta">([\s\S]*?)<\/div>/.exec(row) || [, ""])[1];
const monthCounts = (app) => (tab(app).match(/<span class="gcount">(\d+)<\/span>/g) || [])
  .map((s) => Number(/(\d+)/.exec(s)[1]));
const retGroup = (app) => {
  const h = app.html("retTodayList");
  const i = h.indexOf("Birthdays this week");
  return i === -1 ? "" : h.slice(i);
};
const onbGroup = (app) => {
  const h = app.html("todayList");
  const i = h.indexOf("Birthdays this week");
  if (i === -1) return "";
  const end = h.indexOf('<div class="board">', i);
  return end === -1 ? h.slice(i) : h.slice(i, end);
};

/* ---------- 1: both lists, one screen, and the same screen from either door ---------- */
{
  const app = boot({
    members: [challenger("c", "Chris Challenger", at(3, 30))],
    retention: [member("r", "Mo Member", at(4, 31))],
  });
  assert.ok(tab(app).includes("Chris Challenger"), "the challenger is on it");
  assert.ok(tab(app).includes("Mo Member"), "…and the member");
  assert.strictEqual(app.html("birthdayList"), app.html("retBirthdayList"),
    "and it is byte-for-byte the same screen from either tracker");

  // one list with nothing in it is not a special case
  const noMembers = boot({ members: [challenger("c", "Chris Challenger", at(3, 30))] });
  assert.ok(noMembers.html("retBirthdayList").includes("Chris Challenger"),
    "with no members, the member door still shows the challengers");
  const noChallengers = boot({ retention: [member("r", "Mo Member", at(4, 31))] });
  assert.ok(noChallengers.html("birthdayList").includes("Mo Member"),
    "…and with no challengers, the challenger door shows the members");
  assert.ok(boot({}).html("birthdayList").includes("No birthdays on file yet"),
    "and with neither, one empty state rather than two");
}

/* ---------- 2: the tag is what tells them apart ---------- */
{
  const app = boot({
    members: [challenger("c", "Chris Challenger", at(3, 30))],
    retention: [member("r", "Mo Member", at(4, 31))],
  });
  assert.ok(/bday-type challenge">6-week challenge</.test(rowFor(app, "Chris Challenger")),
    "a challenger is tagged 6-week challenge");
  assert.ok(/bday-type member">Full member</.test(rowFor(app, "Mo Member")),
    "…and a member Full member");
  // one tag each, never both
  assert.ok(!/bday-type member/.test(rowFor(app, "Chris Challenger")));
  assert.ok(!/bday-type challenge/.test(rowFor(app, "Mo Member")));
  // every row on the tab carries one — this is the thing a coach scans by
  const rows = tab(app).split('<div class="bday-row').slice(1);
  assert.strictEqual(rows.length, 2);
  rows.forEach((r) => assert.ok(/bday-type /.test(r), "every row is tagged"));
}

/* ---------- 3: the line under a name says what is useful about THAT kind of person ---------- */
{
  const app = boot({
    members: [
      challenger("a", "Ada Active", at(3, 30)),
      challenger("l", "Lee Left", at(4, 31), { outcome: "left" }),
      challenger("p", "Pam Paused", at(5, 32), { pausedAt: daysFromToday(-3) }),
    ],
    retention: [member("r", "Mo Member", at(6, 33), { coach: "Gaz" })],
  });
  // Everyone, so all four kinds of person are on one list to compare
  app.ctx.setBirthdayFilter("everyone");
  // a challenger's is their journey status — it is how you spot who has left, and that is
  // the whole Ignore decision
  assert.strictEqual(metaOf(rowFor(app, "Ada Active")), "on the journey");
  assert.strictEqual(metaOf(rowFor(app, "Lee Left")), "left");
  assert.strictEqual(metaOf(rowFor(app, "Pam Paused")), "paused");
  // a member has no 42-day clock to report on, so theirs is their coach
  assert.strictEqual(metaOf(rowFor(app, "Mo Member")), "Coach Gaz");
  // and neither line repeats the type — the tag beside the name has already said it
  assert.ok(!/member|challenge/i.test(metaOf(rowFor(app, "Mo Member"))));
}

/* ---------- 4: month groups, counts and ordering are over the combined list ---------- */
{
  const Y = new Date().getFullYear();
  const app = boot({
    members: [challenger("c", "Chris Challenger", (Y - 30) + "-06-20")],
    retention: [
      member("a", "Anna Member", (Y - 31) + "-06-05"),
      member("z", "Zed Member", (Y - 32) + "-11-02"),
    ],
  });
  const june = tab(app).split('<div class="bday-month').find((g) => g.includes("June")) || "";
  assert.ok(june.includes("Anna Member") && june.includes("Chris Challenger"),
    "a member and a challenger share a month group");
  assert.ok(june.indexOf("Anna Member") < june.indexOf("Chris Challenger"),
    "…sorted by day of the month across both lists, not by which list they came from");
  assert.ok(/<span class="gcount">2<\/span>/.test(june), "and the month count is the combined one");
  assert.ok(!june.includes("Zed Member"), "November is not June");
}

/* ---------- 5: Ignore and Actioned write back to the right record ----------
   The same id on both rosters, on purpose: an id lookup would answer for the wrong person,
   so the row has to carry which list it came from. */
{
  const app = boot({
    members: [challenger("x", "Chris Challenger", at(3, 30))],
    retention: [member("x", "Mo Member", at(4, 31))],
  });
  // the buttons on each row name their own roster
  assert.ok(/setBirthdayIgnored\('x',true\)"/.test(rowFor(app, "Chris Challenger")),
    "the challenger's Ignore writes to the roster — no scope means the challengers'");
  assert.ok(/setBirthdayIgnored\('x',true,'retention'\)/.test(rowFor(app, "Mo Member")),
    "…and the member's to the member list");

  app.ctx.toggleBirthdayActioned("x", "retention");
  assert.strictEqual(app.findMember("x").birthdayActionedYear, yearOf(4), "the member was actioned");
  assert.strictEqual(app.find("x").birthdayActionedYear, null, "…and the challenger untouched");
  assert.ok(/\bactioned\b/.test(classesOf(rowFor(app, "Mo Member"))), "the member's row shows handled");
  assert.ok(!/\bactioned\b/.test(classesOf(rowFor(app, "Chris Challenger"))), "…and the challenger's does not");

  app.ctx.setBirthdayIgnored("x", true);                    // no scope = the challenger roster
  assert.strictEqual(app.find("x").birthdayIgnored, true, "the challenger was ignored");
  assert.strictEqual(app.findMember("x").birthdayIgnored, false, "…and the member was not");
  assert.ok(!tab(app).includes("Chris Challenger"), "…and only the challenger left the tab");
  assert.ok(tab(app).includes("Mo Member"));

  // each landed in its own blob
  app.ctx.save(); app.ctx.saveRetention();
  assert.strictEqual(app.cached().find((m) => m.id === "x").birthdayIgnored, true);
  assert.strictEqual(app.retentionCached().find((m) => m.id === "x").birthdayActionedYear, yearOf(4));
}

/* ---------- 6: counts, the ignored line and the dot all span both lists ---------- */
{
  const app = boot({
    members: [challenger("c", "Chris Challenger", at(3, 30), { birthdayIgnored: true })],
    retention: [member("r", "Mo Member", at(4, 31), { birthdayIgnored: true })],
  });
  assert.ok(/2 ignored/.test(tab(app)), "the ignored line counts across both lists");
  assert.ok(!tab(app).includes("Chris Challenger") && !tab(app).includes("Mo Member"),
    "…and both are hidden by default");
  assert.strictEqual(app.el("bdayDot").classList.contains("on"), false,
    "with everybody ignored, no dot");
  assert.strictEqual(app.el("retBdayDot").classList.contains("on"), false, "…on either tab");

  // a member's birthday lights both dots, because both point at the same merged tab
  const mo = boot({ retention: [member("r", "Mo Member", at(2, 31))] });
  assert.strictEqual(mo.el("bdayDot").classList.contains("on"), true,
    "a member's birthday lights the onboarding dot — the tab it points at has them on it");
  assert.strictEqual(mo.el("retBdayDot").classList.contains("on"), true, "…and the retention one");

  // the missing-dob line is people, from both lists, and knows its irregular plural
  const missing = boot({
    members: [challenger("c", "No Dob Chris", null), challenger("d", "Dated Dan", at(3, 30))],
    retention: [member("r", "No Dob Mo", null)],
  });
  assert.ok(/2 people have no date of birth yet/.test(tab(missing)),
    "two people, not two persons and not two challengers");
  const one = boot({
    members: [challenger("d", "Dated Dan", at(3, 30))],
    retention: [member("r", "No Dob Mo", null)],
  });
  assert.ok(/1 person has no date of birth yet/.test(tab(one)), "…and one person, singular");
}

/* ---------- 7: Today's moves stays SPLIT, and that is deliberate ----------
   The tab is a planning screen and belongs to everybody. Today's moves is a tracker's daily
   work: a member's birthday is not a challenger coach's job, and the two screens have their
   own badges, their own boards and their own "all caught up". */
{
  // both are past any scheduled touchpoint, so each tracker's badge is its birthday alone and
  // the numbers below mean something
  const app = boot({
    members: [challenger("c", "Chris Challenger", at(2, 30), {
      day0: daysFromToday(-90), booked: daysFromToday(-90), outcome: "stayed", signedUp: true,
      completed: ["intro", "d1_text", "wk2", "wk3", "wk4", "wk5", "wk6"],
    })],
    retention: [member("r", "Mo Member", at(2, 31))],
  });
  // each appears on exactly one Today's moves
  assert.ok(onbGroup(app).includes("Chris Challenger"), "the challenger is onboarding work");
  assert.ok(!onbGroup(app).includes("Mo Member"), "…and the member is not");
  assert.ok(retGroup(app).includes("Mo Member"), "the member is retention work");
  assert.ok(!retGroup(app).includes("Chris Challenger"), "…and the challenger is not");

  // …while both are on the one tab
  assert.ok(tab(app).includes("Chris Challenger") && tab(app).includes("Mo Member"),
    "and both are on the merged tab");

  // one each, counted on its own tracker's badge
  assert.strictEqual(app.el("todayCount").textContent, "1", "one piece of onboarding work");
  assert.strictEqual(app.el("retTodayCount").textContent, "1", "…and one of retention's");

  // handling the member's clears the retention task and leaves the challenger's alone
  app.ctx.toggleBirthdayActioned("r", "retention");
  assert.strictEqual(retGroup(app), "", "the member's task is done");
  assert.ok(onbGroup(app).includes("Chris Challenger"), "…and the challenger's is untouched");
  assert.strictEqual(app.el("todayCount").textContent, "1", "…as is its badge");
  // and both states are visible on the one tab, which is the point of merging it
  assert.ok(/\bactioned\b/.test(classesOf(rowFor(app, "Mo Member"))), "the tab shows the member handled");
  assert.ok(!/\bactioned\b/.test(classesOf(rowFor(app, "Chris Challenger"))), "…and the challenger not");
}

/* ---------- 8: milestones and notes work per-person, whichever list ---------- */
{
  const app = boot({
    members: [challenger("c", "Chris Fifty", at(3, 50))],
    retention: [member("r", "Mo Fifty", at(4, 50))],
  });
  for (const [name, id] of [["Chris Fifty", "c"], ["Mo Fifty", "r"]]) {
    const row = rowFor(app, name);
    assert.ok(/🎉 Turning 50/.test(row), name + " is flagged as a milestone");
    assert.ok(/\bmilestone\b/.test(classesOf(row)), "…with the accent");
    assert.ok(new RegExp("openNotes\\((&#39;|')" + id + "\\1\\)").test(row),
      "…and the notes icon opens their own notes");
  }
  // clientById already spans both lists, so the notes editor opens for either
  assert.strictEqual(app.ctx.clientById("r").name, "Mo Fifty", "a member's notes are reachable");
  assert.strictEqual(app.ctx.clientById("c").name, "Chris Fifty", "…and a challenger's");
}

console.log("birthday-merged.test.cjs: OK");
