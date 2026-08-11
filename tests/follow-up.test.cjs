// "Left — follow up later" harness. Assertions: a follow-up is a PLAIN 'left' outcome, so
// the conversion figure is byte-for-byte what the plain Left button produces; the reminder
// stays off Today until its date, then surfaces even though the challenger is inactive
// (the deliberate exception to the isInactive filter); Done retires it for good; Snooze
// pushes it 30 days from today and it comes back; undoing the decision takes it with it;
// and the dates survive the clocks changing.
const assert = require("assert");
const { boot, daysFromToday, dateInput } = require("./lib/env.cjs");

// Someone who finished the six weeks and then left — the exact case the feature is for.
const finisher = (over) => ({
  id: "fin", name: "Kelly Finished", coach: "Dan", personal: "runs the parkrun",
  day0: daysFromToday(-60), booked: daysFromToday(-60), firstSessionDone: true,
  completed: [], doneMeta: {}, checks: {}, missed: [], outcome: over ? "left" : null,
  signedUp: false, extraDays: 0, pausedDays: 0, pausedAt: null,
});

function setFollowUp(app, id, ts) {
  app.ctx.openFollowUp(id);
  app.el("fu-date").value = dateInput(ts);
  app.ctx.confirmFollowUp();
}

/* ---------- 1: it records a plain Left, plus a date ---------- */
{
  const app = boot({ members: [finisher(false)] });
  const when = daysFromToday(30);
  setFollowUp(app, "fin", when);

  const m = app.find("fin");
  assert.strictEqual(m.outcome, "left", "outcome is the existing 'left' — no new outcome type");
  assert.strictEqual(m.signedUp, false, "same signedUp handling as the Left button");
  assert.strictEqual(m.followUpOn, when);
  assert.strictEqual(m.followUpStatus, "pending");
  assert.strictEqual(app.ctx.isInactive(m), true, "they are inactive, exactly like any leaver");
  // and it went through the normal save path, so it syncs to everyone
  assert.strictEqual(app.cached()[0].followUpStatus, "pending");
  assert.strictEqual(app.cached()[0].followUpOn, when);
  assert.strictEqual(app.el("fuBg").classList.contains("show"), false, "the modal closes on confirm");
}

/* ---------- 2: the modal defaults to 30 days out, but the date is mine to change ---------- */
{
  const app = boot({ members: [finisher(false)] });
  app.ctx.openFollowUp("fin");
  assert.strictEqual(app.el("fuBg").classList.contains("show"), true);
  assert.strictEqual(app.el("fu-date").value, dateInput(daysFromToday(30)), "defaults to 30 days from today");
  assert.strictEqual(app.el("fuWho").textContent, "Kelly Finished");

  // change it to something else entirely
  const custom = daysFromToday(9);
  app.el("fu-date").value = dateInput(custom);
  app.ctx.confirmFollowUp();
  assert.strictEqual(app.find("fin").followUpOn, custom, "my date wins over the default");

  // reopening an existing follow-up offers the date already set, not the default
  app.ctx.openFollowUp("fin");
  assert.strictEqual(app.el("fu-date").value, dateInput(custom));
}

/* ---------- 3: the conversion maths cannot tell the two apart ---------- */
{
  const roster = () => [
    { id: "a", name: "Stayer", coach: "Dan", day0: daysFromToday(-60), booked: daysFromToday(-60),
      firstSessionDone: true, outcome: "stayed", signedUp: true, completed: [], doneMeta: {}, checks: {}, missed: [] },
    finisher(false),
  ];

  const plain = boot({ members: roster() });
  plain.ctx.setOutcome("fin", "left");

  const parked = boot({ members: roster() });
  setFollowUp(parked, "fin", daysFromToday(30));

  assert.strictEqual(
    parked.html("convBar"), plain.html("convBar"),
    "the conversion bar renders identically whether they were Left or Left — follow up"
  );
  assert.ok(plain.html("convBar").includes("50%"), "sanity: 1 of 2 decided stayed");
  // the live count in the masthead treats them the same too
  assert.strictEqual(parked.el("liveCount").textContent, plain.el("liveCount").textContent);
  // and so does the Left/inactive filter on the Challengers tab
  parked.el("filter").value = "inactive"; parked.ctx.renderMembers();
  plain.el("filter").value = "inactive"; plain.ctx.renderMembers();
  assert.ok(parked.html("memberList").includes("Kelly Finished"));
  assert.ok(plain.html("memberList").includes("Kelly Finished"));
}

/* ---------- 4: silent until its date ---------- */
{
  const app = boot({ members: [finisher(false)] });
  setFollowUp(app, "fin", daysFromToday(3));

  assert.strictEqual(app.ctx.followUpPending(app.find("fin")), true);
  assert.strictEqual(app.ctx.followUpDue(app.find("fin")), false, "not due for another three days");
  assert.ok(!app.html("todayList").includes("Follow-ups to make"), "nothing on Today yet");
  assert.strictEqual(app.el("todayCount").textContent, "0", "and it is not counted");
  // it is visible on their card, though, so we know it is booked in
  assert.ok(app.html("memberList").includes("Follow-up "), "the card shows the scheduled follow-up");
}

/* ---------- 5: on the day it surfaces — piercing the inactive filter ---------- */
{
  const app = boot({ members: [finisher(false)] });
  setFollowUp(app, "fin", daysFromToday(0));

  const m = app.find("fin");
  // the ordinary journey path drops them completely — this is what makes it an exception
  assert.strictEqual(app.ctx.dueToday(m).length, 0, "dueToday() still hides an inactive challenger");
  assert.strictEqual(app.ctx.isInactive(m), true);

  const today = app.html("todayList");
  assert.ok(today.includes("Follow-ups to make"), "…yet the follow-up group appears");
  assert.ok(today.includes("Kelly Finished"), "…with their name on it");
  assert.ok(today.includes("followUpDone(&#39;fin&#39;)") || today.includes("followUpDone('fin')"), "Done button present");
  assert.ok(today.includes("followUpSnooze"), "Snooze button present");
  assert.strictEqual(app.el("todayCount").textContent, "1", "and it counts as a move to make");
  assert.ok(!today.includes("Overdue"), "on the day itself it is not overdue");
}

/* ---------- 6: a date that has passed still surfaces, flagged overdue ---------- */
{
  const app = boot({ members: [finisher(false)] });
  setFollowUp(app, "fin", daysFromToday(-5));
  assert.strictEqual(app.ctx.followUpDue(app.find("fin")), true, "a missed follow-up does not expire");
  assert.ok(app.html("todayList").includes("Overdue"));
}

/* ---------- 7: Done retires it permanently ---------- */
{
  const app = boot({ members: [finisher(false)] });
  setFollowUp(app, "fin", daysFromToday(-2));
  assert.ok(app.html("todayList").includes("Follow-ups to make"));

  app.ctx.followUpDone("fin");
  const m = app.find("fin");
  assert.strictEqual(m.followUpStatus, "done");
  assert.strictEqual(app.ctx.followUpDue(m), false);
  assert.ok(!app.html("todayList").includes("Follow-ups to make"), "off Today");
  assert.strictEqual(app.el("todayCount").textContent, "0");
  assert.ok(!app.html("memberList").includes("Follow-up "), "and off the card");
  assert.strictEqual(app.cached()[0].followUpStatus, "done", "persisted for the rest of the team");
  // still left, still counted as left
  assert.strictEqual(m.outcome, "left");
  // and it does not come back the next day
  m.followUpOn = daysFromToday(-1);
  assert.strictEqual(app.ctx.followUpDue(m), false, "a done follow-up stays done whatever the date");
}

/* ---------- 8: Snooze pushes 30 days from TODAY and comes back ---------- */
{
  const app = boot({ members: [finisher(false)] });
  setFollowUp(app, "fin", daysFromToday(-40));   // long overdue
  app.ctx.followUpSnooze("fin");

  const m = app.find("fin");
  assert.strictEqual(m.followUpStatus, "pending", "still pending — snoozing is not finishing");
  assert.strictEqual(m.followUpOn, daysFromToday(30), "30 days from today, not from the old date");
  assert.strictEqual(app.ctx.followUpDue(m), false);
  assert.ok(!app.html("todayList").includes("Follow-ups to make"), "gone for now");
  assert.strictEqual(app.cached()[0].followUpOn, daysFromToday(30));

  // wind the clock forward: the day arrives and it is back
  m.followUpOn = daysFromToday(0);
  app.ctx.renderAll();
  assert.ok(app.html("todayList").includes("Follow-ups to make"), "and back when the date comes round");
}

/* ---------- 9: changing or undoing the decision takes the reminder with it ---------- */
{
  const app = boot({ members: [finisher(false)] });
  setFollowUp(app, "fin", daysFromToday(0));
  assert.ok(app.html("todayList").includes("Follow-ups to make"));

  app.ctx.setOutcome("fin", null);                       // "Undo decision"
  let m = app.find("fin");
  assert.strictEqual(m.followUpOn, null, "undoing the decision clears the follow-up");
  assert.strictEqual(m.followUpStatus, null);
  assert.ok(!app.html("todayList").includes("Follow-ups to make"));

  // and if they turn round and join after all
  setFollowUp(app, "fin", daysFromToday(0));
  app.ctx.setOutcome("fin", "stayed");
  m = app.find("fin");
  assert.strictEqual(m.followUpStatus, null, "a member does not need chasing as a leaver");
  assert.strictEqual(m.signedUp, true, "and the stayed path is untouched");
}

/* ---------- 10: a plain Left is still a plain Left ---------- */
{
  const app = boot({ members: [finisher(false)] });
  app.ctx.setOutcome("fin", "left");
  const m = app.find("fin");
  assert.strictEqual(m.followUpOn, null, "the Left button schedules nothing");
  assert.strictEqual(m.followUpStatus, null);
  assert.ok(!app.html("todayList").includes("Follow-ups to make"));
  assert.ok(!app.html("memberList").includes("Follow-up "));
}

/* ---------- 11: the clocks changing must not move a follow-up by a day ---------- */
{
  const app = boot({ members: [] });
  const { addDays, toDateInput } = app.ctx;
  // Europe/London: BST starts 29 Mar 2026, ends 25 Oct 2026 — a raw +30×86400000 lands an
  // hour either side of midnight across those, which is a day's slip in the >= comparison.
  const cases = [
    ["2026-03-01", 30, "2026-03-31"],   // spring forward inside the window
    ["2026-03-28", 1, "2026-03-29"],    // the transition day itself
    ["2026-10-01", 30, "2026-10-31"],   // fall back inside the window
    ["2026-10-24", 1, "2026-10-25"],
    ["2026-06-15", 30, "2026-07-15"],   // no transition — the ordinary case
  ];
  for (const [from, n, expect] of cases) {
    const start = new Date(from + "T00:00:00").getTime();
    const got = addDays(start, n);
    assert.strictEqual(new Date(got).getHours(), 0, from + " +" + n + "d lands on local midnight");
    assert.strictEqual(toDateInput(got), expect, from + " +" + n + "d should be " + expect);
  }
  // toDateInput reads local parts: through BST, toISOString() would report the day before
  assert.strictEqual(toDateInput(new Date("2026-06-15T00:00:00").getTime()), "2026-06-15");
}

/* ---------- 12: several follow-ups queue in date order ---------- */
{
  const later = { ...finisher(false), id: "late", name: "Zoe Later" };
  const app = boot({ members: [finisher(false), later] });
  setFollowUp(app, "fin", daysFromToday(-1));
  setFollowUp(app, "late", daysFromToday(-9));
  const today = app.html("todayList");
  assert.ok(today.indexOf("Zoe Later") < today.indexOf("Kelly Finished"), "oldest follow-up first");
  assert.strictEqual(app.el("todayCount").textContent, "2");
}

/* ---------- 13: follow-ups do not disturb live challengers on Today ---------- */
{
  const live = {
    id: "live", name: "Sam Live", coach: "Grace", day0: daysFromToday(-7), booked: daysFromToday(-7),
    firstSessionDone: true, completed: ["intro"], doneMeta: {}, checks: {}, missed: [],
    outcome: null, signedUp: false, extraDays: 0, pausedDays: 0, pausedAt: null,
  };
  const before = boot({ members: [live] });
  const liveCount = Number(before.el("todayCount").textContent);
  assert.ok(liveCount > 0, "sanity: a day-7 challenger has touchpoints due");

  const after = boot({ members: [live, finisher(false)] });
  setFollowUp(after, "fin", daysFromToday(0));
  assert.strictEqual(Number(after.el("todayCount").textContent), liveCount + 1, "count adds, nothing replaced");
  assert.ok(after.html("todayList").includes("Sam Live"), "the live challenger's touchpoints are untouched");
  assert.ok(after.html("todayList").includes("Kelly Finished"));
}

console.log("follow-up.test.cjs: OK");
