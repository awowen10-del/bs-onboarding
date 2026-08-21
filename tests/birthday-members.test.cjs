// The birthday feature set, mirrored to MEMBERS.
//
// Challengers got Ignore, milestones, Actioned and birthday tasks first; this is the same
// behaviour pointed at the member list. So the interesting question is not "does each feature
// work again" — it is whether it is the SAME code doing it. A second implementation beside the
// first is two things to keep in step and they will not stay in step, so several blocks here
// assert that a member and a challenger go through the same function and come out identical.
//
// Two things are deliberately NOT mirrored, and both have a block of their own: a member's
// meta line is their coach rather than a journey status they do not have, and the Jo/Pat demo
// props stay challengers-only.
const assert = require("assert");
const { boot, daysFromToday } = require("./lib/env.cjs");

const NOW = new Date();
const CUR_Y = NOW.getFullYear();
const CUR_M = NOW.getMonth() + 1;
const CUR_D = NOW.getDate();
const DAYS_IN_CUR_M = new Date(CUR_Y, CUR_M, 0).getDate();

// a dob putting somebody's next birthday `n` days out, turning `age`
const at = (n, age) => {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n);
  const p = (x) => String(x).padStart(2, "0");
  return (d.getFullYear() - age) + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
};
const yearOf = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.getFullYear(); };

const member = (id, name, dob, extra) => Object.assign({
  id, name, coach: "Grace", email: "", personal: "", notes: "", dob,
  joined: daysFromToday(-200), fromChallenger: null,
  completed: ["welcome_card", "day30", "day60"], missed: [], doneMeta: {}, attendance: {},
}, extra || {});
const challenger = (id, name, dob, extra) => Object.assign({
  id, name, coach: "Dan", dob, personal: "",
  day0: daysFromToday(-8), booked: daysFromToday(-8), firstSessionDone: true,
  completed: ["intro"], doneMeta: {}, checks: {}, missed: [],
  outcome: null, signedUp: false, extraDays: 0, pausedDays: 0, pausedAt: null,
  followUpOn: null, followUpStatus: null, notes: "",
}, extra || {});

// the member Birthdays tab
const tabRows = (app) => app.html("retBirthdayList").split('<div class="bday-row').slice(1);
const tabRow = (app, name) => tabRows(app).find((r) => r.includes(name)) || "";
const classesOf = (row) => (/^([^>]*)>/.exec(row) || [, ""])[1].replace(/"/g, "").trim();
// the member Today's moves
const todayGroup = (app) => {
  const h = app.html("retTodayList");
  const i = h.indexOf("Birthdays this week");
  return i === -1 ? "" : h.slice(i);
};
const taskFor = (app, name) => todayGroup(app).split('<div class="action').find((r) => r.includes(name)) || "";
const onRetToday = (app, name) => todayGroup(app).includes(name);

/* ---------- 1: the two fields exist on a member and default the same way ---------- */
{
  const app = boot({ retention: [{ id: "old", name: "Legacy Len", coach: "Gaz" }] });
  const len = app.findMember("old");
  assert.strictEqual(len.birthdayIgnored, false, "nobody is ignored by default");
  assert.strictEqual(len.birthdayActionedYear, null, "and nothing is actioned by default");
  assert.ok(!app.html("retBirthdayList").includes("undefined"), "a legacy member renders cleanly");

  // and a member who came through the handoff starts clean too — an ignore or a tick made
  // about a CHALLENGER was about a six-week challenge, not about a membership
  const h = boot({ members: [challenger("c", "Cross Chris", at(2, 30),
    { birthdayIgnored: true, birthdayActionedYear: CUR_Y })] });
  h.ctx.setOutcome("c", "stayed");
  const crossed = h.retention()[0];
  assert.strictEqual(crossed.name, "Cross Chris", "sanity: they came across");
  assert.strictEqual(crossed.dob, at(2, 30), "…with their date of birth");
  assert.strictEqual(crossed.birthdayIgnored, false, "…but not their ignore");
  assert.strictEqual(crossed.birthdayActionedYear, null, "…nor their Actioned tick");
}

/* ---------- 2: it is the SAME rules, not a second set ----------
   A member and a challenger with the same date of birth must be indistinguishable to every
   birthday rule. If these ever diverge, two implementations have grown where there was one. */
{
  const app = boot({
    members: [challenger("c", "Same Sam", at(4, 50))],
    retention: [member("r", "Same Sue", at(4, 50))],
  });
  const c = app.find("c"), r = app.findMember("r");
  for (const fn of ["nextBirthday", "birthdayMilestone", "birthdayActioned",
    "birthdayDaysAway", "birthdayDue"]) {
    assert.deepStrictEqual(JSON.parse(JSON.stringify(app.ctx[fn](r) ?? null)),
      JSON.parse(JSON.stringify(app.ctx[fn](c) ?? null)),
      fn + " gives a member and a challenger the same answer");
  }
  assert.strictEqual(app.ctx.birthdayMilestone(r), 50, "sanity: it is a milestone");
  assert.strictEqual(app.ctx.birthdayDue(r), true, "…and it is due");
}

/* ---------- 3: milestones on a member's card ---------- */
{
  const MILESTONES = [18, 21, 30, 40, 50, 60, 65, 70, 80];
  for (const age of MILESTONES) {
    const app = boot({ retention: [member("r", "Milestone Mo", at(4, age))] });
    assert.strictEqual(app.ctx.birthdayMilestone(app.findMember("r")), age, age + " is a milestone");
    assert.ok(tabRow(app, "Milestone Mo").includes("🎉 Turning " + age), "…flagged on the tab");
    assert.ok(/\bmilestone\b/.test(classesOf(tabRow(app, "Milestone Mo"))), "…with the accent");
    assert.ok(taskFor(app, "Milestone Mo").includes("🎉 Turning " + age), "…and on the task");
  }
  const plain = boot({ retention: [member("r", "Ordinary Olive", at(4, 51))] });
  assert.ok(!/🎉/.test(tabRow(plain, "Ordinary Olive")), "51 is an ordinary birthday");
  assert.ok(!/🎉/.test(taskFor(plain, "Ordinary Olive")), "…on both screens");
}

/* ---------- 4: Ignore on a member — groups, counts, the dot, and the way back ---------- */
{
  const app = boot({ retention: [
    member("k", "Kim Keep", at(3, 30)),
    member("i", "Ivy Ignore", at(4, 31)),
  ] });
  const monthCount = () =>
    Number(/<span class="gcount">(\d+)<\/span>/.exec(app.html("retBirthdayList"))[1]);
  assert.strictEqual(monthCount(), 2, "both are in the month group to begin with");
  assert.strictEqual(app.el("retBdayDot").classList.contains("on"), true, "and the dot is lit");

  app.ctx.setBirthdayIgnored("i", true, "retention");
  assert.strictEqual(app.findMember("i").birthdayIgnored, true, "the flag is on the member");
  assert.ok(!app.html("retBirthdayList").includes("Ivy Ignore"), "she is off the tab");
  assert.strictEqual(monthCount(), 1, "…and out of the month count, not greyed in place");
  assert.ok(!onRetToday(app, "Ivy Ignore"), "…and off Today's moves");
  assert.ok(onRetToday(app, "Kim Keep"), "…while nobody else moved");

  // the way back, counted and reversible
  const note = /<div class="bday-ignored-note">([\s\S]*?)<\/div>/.exec(app.html("retBirthdayList"));
  assert.ok(note && /1 ignored/.test(note[1]), "an ignored line says how many");
  assert.ok(/toggleIgnoredBirthdays\(\)/.test(note[1]), "…and offers to show them");

  app.ctx.toggleIgnoredBirthdays();
  assert.ok(app.html("retBirthdayList").includes("Ivy Ignore"), "showing brings her into view");
  assert.ok(/Un-ignore/.test(tabRow(app, "Ivy Ignore")), "…with the undo on her row");
  app.ctx.setBirthdayIgnored("i", false, "retention");
  app.ctx.toggleIgnoredBirthdays();
  assert.strictEqual(monthCount(), 2, "un-ignoring returns her to the count");

  // ignoring everybody puts the dot out
  app.ctx.setBirthdayIgnored("k", true, "retention");
  app.ctx.setBirthdayIgnored("i", true, "retention");
  assert.strictEqual(app.el("retBdayDot").classList.contains("on"), false,
    "an ignored member cannot nudge from a tab they are not on");
}

/* ---------- 5: one merged tab, one "show ignored" peek ----------
   The tab is a single screen shown from two doors, so the peek has to be the same peek from
   either — one flag, revealing everybody who has been ignored on either list at once. Two
   flags would mean the same list reading differently depending on which door you came in by. */
{
  const app = boot({
    members: [challenger("c", "Chris Challenger", at(3, 30), { birthdayIgnored: true })],
    retention: [member("r", "Mo Member", at(3, 30), { birthdayIgnored: true })],
  });
  assert.ok(!app.html("birthdayList").includes("Chris Challenger"), "both start hidden");
  assert.ok(!app.html("retBirthdayList").includes("Mo Member"));
  assert.ok(/2 ignored/.test(app.html("birthdayList")), "…and the line counts across both lists");

  app.ctx.toggleIgnoredBirthdays();
  for (const id of ["birthdayList", "retBirthdayList"]) {
    assert.ok(app.html(id).includes("Chris Challenger"), "#" + id + " reveals the challenger");
    assert.ok(app.html(id).includes("Mo Member"), "…and the member, together");
  }
  assert.strictEqual(app.html("birthdayList"), app.html("retBirthdayList"),
    "and the two doors show the same screen");

  app.ctx.toggleIgnoredBirthdays();
  assert.ok(!app.html("retBirthdayList").includes("Mo Member"), "…and hiding puts both away");
}

/* ---------- 6: Actioned on a member stores the year and expires by itself ---------- */
{
  const app = boot({ retention: [member("r", "Ann Actioned", at(3, 30))] });
  assert.strictEqual(app.ctx.birthdayActioned(app.findMember("r")), false, "nothing starts handled");

  app.ctx.toggleBirthdayActioned("r", "retention");
  assert.strictEqual(app.findMember("r").birthdayActionedYear, yearOf(3),
    "the YEAR is stored, the same as it is for a challenger");
  assert.ok(/\bactioned\b/.test(classesOf(tabRow(app, "Ann Actioned"))), "the tab shows it handled");
  assert.ok(/✓ Actioned/.test(tabRow(app, "Ann Actioned")), "…with the tick");
  assert.ok(app.html("retBirthdayList").includes("Ann Actioned"),
    "…and still listed: handled is not hidden, which is the difference from Ignore");

  app.ctx.toggleBirthdayActioned("r", "retention");
  assert.strictEqual(app.findMember("r").birthdayActionedYear, null, "and it undoes");

  // it counts only against the birthday it was stored for
  const ann = app.findMember("r");
  ann.birthdayActionedYear = yearOf(3);
  assert.strictEqual(app.ctx.birthdayActioned(ann), true, "this year's tick, this year's birthday");
  ann.birthdayActionedYear = yearOf(3) - 1;
  assert.strictEqual(app.ctx.birthdayActioned(ann), false, "last year's does nothing for this one");
  ann.birthdayActionedYear = yearOf(3) + 1;
  assert.strictEqual(app.ctx.birthdayActioned(ann), false, "…nor a year on the other side");
}

/* ---------- 7: member birthday tasks — the window, and the flags that gate it ---------- */
{
  const app = boot({ retention: [
    member("t", "Tess Today", at(0, 29)),
    member("m", "Milo Midweek", at(3, 31)),
    member("e", "Edge Eddie", at(7, 26)),
    member("j", "Just Missed Jo", at(8, 27)),
    member("i", "Ivy Ignored", at(2, 33), { birthdayIgnored: true }),
    member("a", "Ann Actioned", at(4, 35), { birthdayActionedYear: yearOf(4) }),
  ] });

  for (const n of ["Tess Today", "Milo Midweek", "Edge Eddie"]) {
    assert.ok(onRetToday(app, n), n + " is on the member Today's moves");
  }
  for (const n of ["Just Missed Jo", "Ivy Ignored", "Ann Actioned"]) {
    assert.ok(!onRetToday(app, n), n + " is not");
  }
  assert.strictEqual(todayGroup(app).split('<div class="action').length - 1, 3, "three cards");
  assert.ok(/Birthdays this week<span class="gcount">3<\/span>/.test(todayGroup(app)),
    "the group is labelled and counted like the others");

  // soonest first
  assert.deepStrictEqual(
    todayGroup(app).split('<div class="action').slice(1).map((r) => /class="nm">([^<]*)/.exec(r)[1]),
    ["Tess Today", "Milo Midweek", "Edge Eddie"], "soonest first");

  // when, in words, and the four steps
  assert.strictEqual(/class="day">([^<]*)/.exec(taskFor(app, "Tess Today"))[1], "today");
  assert.strictEqual(/class="day">([^<]*)/.exec(taskFor(app, "Milo Midweek"))[1], "in 3 days");
  for (const step of [...app.ctx.__t.BIRTHDAY_STEPS]) {
    assert.ok(taskFor(app, "Milo Midweek").includes(step), "the card lists “" + step + "”");
  }
  // no challenger-only status leaked onto a member's card
  assert.ok(!/on the journey|Day \d|not started yet/.test(todayGroup(app)),
    "no journey status on a member's birthday task");
}

/* ---------- 8: one action — Done on Today's moves IS Actioned on the tab ---------- */
{
  const app = boot({ retention: [member("t", "Tess Today", at(2, 29))] });
  assert.ok(onRetToday(app, "Tess Today"), "the task is there");
  assert.ok(/toggleBirthdayActioned\('t','retention'\)/.test(taskFor(app, "Tess Today")),
    "Done names the member list, so it cannot write to the wrong roster");

  app.ctx.toggleBirthdayActioned("t", "retention");        // what the Done button calls
  assert.strictEqual(app.findMember("t").birthdayActionedYear, yearOf(2), "one field, the member's own");
  assert.ok(!onRetToday(app, "Tess Today"), "the task clears from Today's moves");
  assert.ok(/\bactioned\b/.test(classesOf(tabRow(app, "Tess Today"))), "…and the tab shows it handled");

  // and the reverse: the tab's Actioned button clears the task
  const back = boot({ retention: [member("t", "Tess Today", at(2, 29))] });
  back.ctx.toggleBirthdayActioned("t", "retention");
  assert.ok(!onRetToday(back, "Tess Today"), "pressing Actioned on the tab clears the task");
  back.ctx.toggleBirthdayActioned("t", "retention");
  assert.ok(onRetToday(back, "Tess Today"), "…and un-actioning brings it back");

  // exactly two birthday fields on a member — no parallel "task done" state appeared
  const fields = Object.keys(app.findMember("t")).filter((k) => /birthday/i.test(k)).sort();
  assert.deepStrictEqual(fields, ["birthdayActionedYear", "birthdayIgnored"]);
  assert.strictEqual(app.retentionCached().find((m) => m.id === "t").birthdayActionedYear, yearOf(2),
    "and it is in the member blob that syncs");
}

/* ---------- 9: the two rosters never write to each other ----------
   The one new risk in mirroring this: the write path takes a scope, and a scope is a string
   that can be wrong. Same id on both lists, so a mix-up would land somewhere visible. */
{
  const app = boot({
    members: [challenger("x", "Chris Challenger", at(3, 30))],
    retention: [member("x", "Mo Member", at(3, 30))],
  });
  assert.strictEqual(app.find("x").name, "Chris Challenger", "sanity: the ids collide on purpose");
  assert.strictEqual(app.findMember("x").name, "Mo Member");

  app.ctx.toggleBirthdayActioned("x", "retention");
  assert.strictEqual(app.findMember("x").birthdayActionedYear, yearOf(3), "the member was actioned");
  assert.strictEqual(app.find("x").birthdayActionedYear, null, "…and the challenger was not touched");

  app.ctx.setBirthdayIgnored("x", true);                    // no scope = challengers
  assert.strictEqual(app.find("x").birthdayIgnored, true, "the challenger was ignored");
  assert.strictEqual(app.findMember("x").birthdayIgnored, false, "…and the member was not");

  // each tracker's screens show only its own
  assert.ok(!todayGroup(app).includes("Chris Challenger"), "no challenger on the member Today");
  const onTodayMoves = app.html("todayList");
  assert.ok(!onTodayMoves.includes("Mo Member"), "…and no member on the challengers'");
}

/* ---------- 10: the demo props are challengers, and stay challengers ----------
   The Birthdays tab is merged, so they appear on it from either door — carrying the CHALLENGE
   tag, because that is what they are pretending to be. What they must never do is become
   member work: no member task, no member record, no member count. */
{
  const app = boot({ retention: [member("r", "Mo Member", at(3, 30))] });
  app.ctx.toggleBirthdayExamples();
  assert.ok(app.html("birthdayList").includes("Jo Example"), "sanity: the toggle reveals them");
  assert.ok(app.html("retBirthdayList").includes("Jo Example"), "…on the same merged tab either way");

  const jo = app.html("retBirthdayList").split('<div class="bday-row').find((r) => r.includes("Jo Example"));
  assert.ok(/bday-type challenge">6-week challenge</.test(jo), "tagged as a challenger, not a member");
  assert.ok(/bday-example-tag">Example</.test(jo), "…and as an example");

  // …and nowhere near the member side's own work or data
  for (const id of ["retTodayList", "retMemberList"]) {
    assert.ok(!app.html(id).includes("Example"), "no example reaches #" + id);
  }
  assert.strictEqual(app.retention().length, 1, "and no prop was added to the member list");
  assert.ok(onRetToday(app, "Mo Member"), "the real member's task is unaffected");
  assert.strictEqual(app.el("retTodayCount").textContent, "1", "…and the badge counts only them");
}

/* ---------- 11: the member journey and the rest of the tracker are untouched ---------- */
{
  const app = boot({ retention: [
    member("n", "New Nadia", at(3, 30), { joined: daysFromToday(0), completed: [], missed: [] }),
  ] });
  const h = app.html("retTodayList");
  assert.ok(h.includes("Welcome card"), "the member journey still surfaces its touchpoints");
  assert.ok(h.includes("Birthdays this week"), "…alongside the birthday group");
  assert.ok(h.indexOf("Birthdays this week") < h.indexOf("Cards & gifts to send"),
    "…with birthdays above the journey groups");

  // the badge counts both kinds of work
  assert.strictEqual(app.el("retTodayCount").textContent, "2",
    "one journey touchpoint and one birthday");

  // and a day with only a birthday on it is not "all caught up"
  const only = boot({ retention: [member("o", "Only Ollie", at(3, 30))] });
  assert.ok(!app.html("retTodayList").includes("All caught up"));
  assert.ok(onRetToday(only, "Only Ollie"), "the birthday is the day's work");
  assert.strictEqual(only.el("retTodayCount").textContent, "1");
  only.ctx.toggleBirthdayActioned("o", "retention");
  assert.ok(only.html("retTodayList").includes("All caught up"), "handling it clears the day");
  assert.strictEqual(only.el("retTodayCount").textContent, "0");
}

console.log("birthday-members.test.cjs: OK");
