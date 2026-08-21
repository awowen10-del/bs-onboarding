// Member journey harness — the Retention tracker's four scheduled touchpoints.
//
// The whole thing hangs off one number: `joined`. A welcome card the day they join, Gaz at
// 30 and 60 days, a gift at a year. So most of this file is arithmetic against that anchor —
// each touchpoint appearing on the day it should and not a day before, staying for its grace
// window and then dropping off — plus the two things a coach actually does with a row, Done
// and Missed, and the grid that shows the lot.
//
// It also guards the move: the welcome card used to be an onboarding touchpoint, and it must
// now exist in exactly one journey, not two and not none.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { boot, daysFromToday } = require("./lib/env.cjs");

const HTML = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

// a member who joined n days ago
function member(id, name, joinedDaysAgo, extra) {
  return Object.assign({
    id, name, coach: "Gaz", email: "", dob: null, personal: "", notes: "",
    joined: joinedDaysAgo === null ? null : daysFromToday(-joinedDaysAgo),
    fromChallenger: null, completed: [], missed: [], doneMeta: {},
  }, extra || {});
}
const dueIds = (app, m) => [...app.ctx.memberDueToday(m)].map((it) => it.id);

/* ---------- 1: the four touchpoints, anchored to joined ---------- */
{
  const app = boot({});
  const J = [...app.ctx.__t.MEMBER_JOURNEY];
  assert.deepStrictEqual(J.map((it) => it.id), ["welcome_card", "day30", "day60", "anniversary"],
    "four touchpoints, welcome card first");
  assert.deepStrictEqual(J.map((it) => it.day), [0, 30, 60, 365], "at day 0, 30, 60 and 365");
  assert.deepStrictEqual(J.map((it) => it.ch), ["physical", "digital", "digital", "physical"],
    "a card and a gift in the post; two voice notes");
  assert.ok(/Gaz/.test(J[1].title) && /Gaz/.test(J[2].title), "the check-ins are Gaz's");
  assert.ok(/anniversary/i.test(J[3].title) && /gift/i.test(J[3].title), "a year gets a gift");
}

/* ---------- 2: each becomes due on its day, and not before ---------- */
{
  const app = boot({});
  const on = (n) => dueIds(app, app.ctx.migrateRetentionList([member("m", "Mem", n)])[0]);

  assert.deepStrictEqual(on(0), ["welcome_card"], "day 0: the welcome card, straight away");
  assert.deepStrictEqual(on(1), ["welcome_card"], "…and it is still the only thing on day 1");
  assert.deepStrictEqual(on(29), ["welcome_card"], "day 29: still nothing from Gaz");
  assert.deepStrictEqual(on(30), ["welcome_card", "day30"], "day 30 to the day");
  assert.deepStrictEqual(on(40), ["welcome_card", "day30"], "day 40: still inside day30's grace");
  assert.deepStrictEqual(on(59), ["welcome_card"], "day 59: day30 has expired, day60 not yet due");
  assert.deepStrictEqual(on(60), ["welcome_card", "day60"], "day 60 arrives");
  assert.deepStrictEqual(on(364), ["welcome_card"], "day 364: nothing but the unsent card");
  assert.deepStrictEqual(on(365), ["welcome_card", "anniversary"], "a year, to the day");
  assert.deepStrictEqual(on(400), ["welcome_card"], "day 400: the gift window has closed");

  // the grace windows, at their exact edges
  assert.ok(dueIds(app, member("a", "A", 44)).includes("day30"), "day30 lasts 14 days");
  assert.ok(!dueIds(app, member("b", "B", 45)).includes("day30"), "…and no longer");
  assert.ok(dueIds(app, member("c", "C", 74)).includes("day60"), "day60 lasts 14 days");
  assert.ok(!dueIds(app, member("d", "D", 75)).includes("day60"), "…and no longer");
  assert.ok(dueIds(app, member("e", "E", 395)).includes("anniversary"), "the gift lasts 30 days");
  assert.ok(!dueIds(app, member("f", "F", 396)).includes("anniversary"), "…and no longer");

  // the welcome card never expires — an unsent card is still an unsent card
  assert.ok(dueIds(app, member("g", "G", 900)).includes("welcome_card"),
    "the welcome card keeps asking until somebody deals with it");

  // a member with no joined date has no journey at all
  const nowt = member("h", "No Anchor", null);
  assert.deepStrictEqual(dueIds(app, nowt), [], "no joined date means nothing is due…");
  assert.strictEqual(app.ctx.memberDay(nowt), 0, "…rather than 20,000 days of overdue");
  assert.strictEqual(app.ctx.memberStarted(nowt), false);
}

/* ---------- 3: they show on Retention Today's moves ---------- */
{
  const app = boot({ retention: [
    member("new", "Nina New", 0),
    member("mid", "Mo Month", 30),
    member("yr", "Yasmin Year", 365),
    member("quiet", "Quinn Quiet", 100),        // nothing due, but the card was sent
  ] });
  app.ctx.retToggleDone("quiet", "welcome_card", true);

  const h = app.html("retTodayList");
  assert.ok(h.includes("Nina New") && h.includes("Welcome card"), "the new member needs a card");
  assert.ok(h.includes("Mo Month") && h.includes("Day 30 check-in"), "…Mo needs Gaz");
  assert.ok(h.includes("Yasmin Year") && h.includes("anniversary"), "…Yasmin needs a gift");
  assert.ok(!h.includes("Quinn Quiet"), "…and Quinn needs nothing");

  // grouped by channel, cards before voice notes, and counted on the tab
  assert.ok(h.includes("Cards &amp; gifts to send") || h.includes("Cards & gifts to send"),
    "the physical group is labelled");
  assert.ok(h.includes("Voice notes &amp; check-ins") || h.includes("Voice notes & check-ins"));
  assert.ok(h.indexOf("Welcome card") < h.indexOf("Day 30 check-in"), "posted things lead");
  assert.strictEqual(app.el("retTodayCount").textContent, "5",
    "the tab counts every due touchpoint: three unsent cards, Mo's check-in, Yasmin's gift");
  assert.ok(/<strong>4<\/strong> members with us/.test(app.html("retTodayBanner")),
    "the banner counts members, not touchpoints");

  // Done and Missed on every row, the same two buttons as the onboarding side
  assert.ok(/retToggleDone\((&#39;|')new\1,(&#39;|')welcome_card\2,true\)/.test(h), "a Done button");
  assert.ok(/retMarkMissed\((&#39;|')mid\1,(&#39;|')day30\2\)/.test(h), "a Missed button");
  assert.ok(h.includes("notes-btn"), "and the shared-notes icon travels here too");

  // overdue is called out
  const late = boot({ retention: [member("l", "Lee Late", 40)] });
  assert.ok(late.html("retTodayList").includes("Overdue"), "a check-in ten days late says so");
  const bang = boot({ retention: [member("o", "Ona Ontime", 30)] });
  assert.ok(!/Day 30 check-in[\s\S]{0,200}Overdue/.test(bang.html("retTodayList")),
    "…and one due today does not");
}

/* ---------- 4: Done and Missed ---------- */
{
  const app = boot({ retention: [member("m", "Mo Month", 30)] });
  assert.deepStrictEqual(dueIds(app, app.findMember("m")), ["welcome_card", "day30"]);

  app.ctx.retToggleDone("m", "day30", true);
  const m = app.findMember("m");
  assert.ok(m.completed.includes("day30"), "marked done");
  assert.ok(m.doneMeta.day30, "…and stamped with when");
  assert.deepStrictEqual(dueIds(app, m), ["welcome_card"], "…so it drops off Today");
  assert.strictEqual(app.retentionCached()[0].completed[0], "day30", "…through the member sync path");
  assert.ok(!app.html("retTodayList").includes("Day 30 check-in"), "…and off the screen");

  // un-done puts it back
  app.ctx.retToggleDone("m", "day30", false);
  assert.deepStrictEqual(dueIds(app, app.findMember("m")), ["welcome_card", "day30"]);
  assert.strictEqual(app.findMember("m").doneMeta.day30, undefined, "the stamp goes with it");

  // missed also clears it off Today, but records it differently
  app.ctx.retMarkMissed("m", "day30");
  assert.ok(app.findMember("m").missed.includes("day30"));
  assert.ok(!app.findMember("m").completed.includes("day30"), "never both at once");
  assert.deepStrictEqual(dueIds(app, app.findMember("m")), ["welcome_card"]);

  // doing it late overrides a miss
  app.ctx.retToggleDone("m", "day30", true);
  assert.ok(app.findMember("m").completed.includes("day30"));
  assert.ok(!app.findMember("m").missed.includes("day30"), "done late beats missed");

  // and none of this touches the challenger roster
  assert.strictEqual(app.cached().length, 0, "the roster was never written");
}

/* ---------- 5: the whole-journey grid ---------- */
{
  const app = boot({ retention: [member("m", "Mo Month", 61)] });
  app.ctx.setRetTodayView("table");
  const h = app.html("retTodayTable");

  assert.ok(h.includes("Mo Month"), "the member is a row");
  ["Card", "Day 30", "Day 60", "1 year"].forEach((c) =>
    assert.ok(h.includes(">" + c + "<"), "column " + c));
  assert.ok(/class="cell due"/.test(h), "day60 is due");
  assert.ok(/class="cell overdue"/.test(h), "day30 has been missed");
  assert.ok(/class="cell future"/.test(h), "the anniversary is a long way off");
  assert.ok(/retTableCellTap\((&#39;|')m\1,(&#39;|')day60\2\)/.test(h), "cells are tappable");

  // tapping cycles empty → done → missed → empty, exactly like the onboarding grid
  app.ctx.retTableCellTap("m", "day60");
  assert.ok(app.findMember("m").completed.includes("day60"), "tap 1: done");
  app.ctx.retTableCellTap("m", "day60");
  assert.ok(app.findMember("m").missed.includes("day60"), "tap 2: missed");
  assert.ok(!app.findMember("m").completed.includes("day60"));
  app.ctx.retTableCellTap("m", "day60");
  assert.ok(!app.findMember("m").missed.includes("day60"), "tap 3: clear");
  assert.deepStrictEqual([...app.findMember("m").completed], []);

  // and the toggle is wired both ways
  app.ctx.setRetTodayView("moves");
  assert.strictEqual(app.el("retTodayMoves").classList.contains("hide"), false);
  assert.strictEqual(app.el("retTodayTable").classList.contains("hide"), true);
  app.ctx.setRetTodayView("table");
  assert.strictEqual(app.el("retTodayTable").classList.contains("hide"), false);
}

/* ---------- 6: nothing due reads as caught up, not as broken ---------- */
{
  const app = boot({ retention: [member("q", "Quinn Quiet", 100)] });
  app.ctx.retToggleDone("q", "welcome_card", true);
  assert.ok(app.html("retTodayList").includes("All caught up"), "the empty state");
  assert.strictEqual(app.el("retTodayCount").textContent, "0");

  const none = boot({});
  assert.ok(none.html("retTodayList").includes("All caught up"), "…with no members at all");
  none.ctx.setRetTodayView("table");
  assert.ok(none.html("retTodayTable").includes("No members yet"), "…and on the grid");
}

/* ---------- 7: the welcome card moved, it was not copied ---------- */
{
  const app = boot({ members: [{
    id: "sam", name: "Sam Doyle", coach: "Dan", day0: daysFromToday(-45), booked: daysFromToday(-45),
    firstSessionDone: true, completed: [], doneMeta: {}, checks: {}, missed: [],
    outcome: null, signedUp: false, extraDays: 0, pausedDays: 0, pausedAt: null,
  }] });

  // gone from the onboarding journey, its table and its playbook
  assert.ok(!app.ctx.__t.JOURNEY.some((it) => it.id === "welcome_card"),
    "the onboarding journey no longer carries a welcome card");
  assert.ok(!app.ctx.__t.TABLE_COLS.includes("welcome_card"), "…nor does its grid");
  assert.ok(!app.html("playbookList").includes("Welcome card"), "…nor the Playbook");
  assert.ok(!/welcome_card/.test(HTML.slice(0, HTML.indexOf("MEMBER_JOURNEY"))),
    "…and no onboarding code still special-cases it");

  // signing up no longer conjures one on Today's moves
  app.ctx.setOutcome("sam", "stayed");
  assert.ok(!app.html("todayList").includes("Welcome card"),
    "staying on does not put a welcome card on the onboarding Today");
  assert.ok(!app.html("todayTable").includes("welcome_card"));

  // it is on the retention side instead, for the member the handoff just made
  assert.strictEqual(app.retention().length, 1);
  assert.ok(app.html("retTodayList").includes("Welcome card"),
    "…it is the first thing their member journey asks for");
  assert.ok(app.html("retTodayList").includes("Sam Doyle"));
  assert.strictEqual(app.el("retTodayCount").textContent, "1");
  assert.deepStrictEqual(dueIds(app, app.retention()[0]), ["welcome_card"],
    "day 0 of their membership");

  // The onboarding journey is now the 42 days and nothing after them. The welcome card left
  // first; the month-1 and month-2 follow-ups followed it to the retention side for the same
  // reason — they hang off the day somebody JOINED, not off their day 0.
  const ONBOARDING = ["intro", "d1_text", "d3_postcard", "wk2", "wk3", "wk4", "wk5", "wk6"];
  assert.deepStrictEqual([...app.ctx.__t.JOURNEY].map((it) => it.id), ONBOARDING,
    "the onboarding journey ends at week 6");
  assert.deepStrictEqual([...app.ctx.__t.TABLE_COLS], ONBOARDING,
    "…and the whole-journey table has a column for each and nothing more");
  app.ctx.setMemberFilter("stayed");            // they stayed on, so that is their tab
  assert.ok(app.html("memberList").includes("Sam Doyle"), "and the challenger still renders");
  assert.ok(app.html("memberList").includes("Stayed ✓"));
}

/* ---------- 7b: the month follow-ups are gone from the onboarding side entirely ----------
   They fired at days 72 and 103 off a challenger's day 0, gated on signedUp, and were the
   only reason the onboarding journey had a 'member' phase at all. Both moved to the retention
   member journey, which counts from the day somebody joined — the clock that actually matters
   for a follow-up about being a member. This checks the whole surface, not just the array:
   Today's moves at the day they used to fire, the whole-journey grid, and the Playbook. */
{
  const app = boot({ members: [] });
  for (const id of ["month1", "month2"]) {
    assert.ok(!app.ctx.__t.JOURNEY.some((it) => it.id === id), id + " is out of the journey");
    assert.ok(!app.ctx.__t.TABLE_COLS.includes(id), id + " is out of the grid");
  }
  assert.ok(!/Mth1|Mth2/.test(HTML), "no month columns are labelled anywhere");
  assert.ok(!app.html("playbookList").includes("Month 1 follow-up"), "gone from the Playbook");
  assert.ok(!app.html("playbookList").includes("Month 2 follow-up"));
  // nothing in the onboarding code still reasons about a 'member' phase
  assert.ok(!/phase\s*===\s*['"]member['"]/.test(HTML),
    "no onboarding branch still special-cases the member phase");
  assert.ok(!app.ctx.__t.JOURNEY.some((it) => it.phase === "member"),
    "…because no touchpoint declares it");

  // A signed-up challenger sitting at day 75 — squarely inside the old month-1 window, and
  // past the end of the 42 days — has an empty Today rather than a follow-up.
  const late = boot({ members: [{
    id: "late", name: "Lena Late", coach: "Dan", day0: daysFromToday(-75), booked: daysFromToday(-75),
    firstSessionDone: true, completed: ["intro", "d1_text", "d3_postcard", "wk2", "wk3", "wk4", "wk5", "wk6"],
    doneMeta: {}, checks: {}, missed: [], outcome: "stayed", signedUp: true,
    extraDays: 0, pausedDays: 0, pausedAt: null,
  }] });
  assert.strictEqual(late.ctx.currentDay(late.find("late")), 75, "sanity: they really are at day 75");
  // spread out of the vm's realm — a sandbox array has a different Array.prototype and
  // deepStrictEqual compares those too
  assert.deepStrictEqual([...late.ctx.dueToday(late.find("late"))].map((it) => it.id), [],
    "nothing is due — the 42 days are over and no month follow-up exists to fire");
  assert.ok(late.html("todayList").includes("All caught up"), "…so Today is genuinely clear");
  assert.strictEqual(late.el("todayCount").textContent, "0");
  // and the conversion flow they went through is untouched
  assert.strictEqual(late.find("late").signedUp, true, "signedUp still records the decision");
  late.ctx.setMemberFilter("stayed");
  assert.ok(late.html("memberList").includes("Stayed ✓"), "…and still reads as stayed");
  assert.ok(late.html("memberList").includes("8 of 8 touchpoints done"),
    "the touchpoint count is the 42 days, all eight of them");
}

/* ---------- 8: existing members do not error, and the tab exists ---------- */
{
  // a member written before the member journey existed: no completed/missed/doneMeta
  const app = boot({ retention: [
    { id: "old", name: "Ollie Old", coach: "Grace", joined: daysFromToday(-30) },
  ] });
  const m = app.findMember("old");
  assert.deepStrictEqual([...m.completed], [], "defaulted by the migration");
  assert.deepStrictEqual([...m.missed], []);
  assert.deepStrictEqual({ ...m.doneMeta }, {});
  assert.ok(app.html("retTodayList").includes("Ollie Old"), "…and their journey just works");
  app.ctx.retToggleDone("old", "day30", true);
  assert.ok(app.findMember("old").completed.includes("day30"), "…including marking it done");

  assert.ok(/data-view="ret-today"/.test(HTML), "there is a Today's moves tab on the retention side");
  assert.ok(/id="view-ret-today"/.test(HTML), "…and a section for it");
  ["ret-members", "ret-birthdays"].forEach((v) =>
    assert.ok(HTML.includes('data-view="' + v + '"'), "the " + v + " tab is still there"));
}

console.log("member-journey.test.cjs: OK");
