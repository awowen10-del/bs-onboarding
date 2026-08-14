// The intro and the first session are two jobs on two different days, and Today's moves used
// to treat them as one card: the intro checklist with the start-the-clock control buried
// inside it. Marking the admin done swept the whole thing off Today while the clock was still
// at zero, and the only way back to it was the Challengers tab — so the start step got lost
// and people sat at Day 0 for weeks.
//
// They are two sequential tasks now. This file pins the handover between them: the intro card
// while the admin is outstanding, a standing "waiting on a first session" task the moment it
// is done, and nothing at all once the clock is running.
const assert = require("assert");
const { boot, daysFromToday, dateInput } = require("./lib/env.cjs");

// A challenger as the app creates them: nothing done, clock at zero.
function fresh(over) {
  return Object.assign({
    id: "c1", name: "Sophie Webhook", booked: null, day0: null, firstSessionDone: false,
    coach: "Dan", personal: "", dob: null, extraDays: 0, pausedDays: 0, pausedAt: null,
    signedUp: false, outcome: null, completed: [], missed: [], doneMeta: {}, checks: {},
    followUpOn: null, followUpStatus: null, notes: "",
  }, over || {});
}
const introDone = (over) => fresh(Object.assign({ completed: ["intro"] }, over || {}));

// The two cards, told apart by the ids the renderer gives them.
const hasIntroCard = (app) => /id="act-c1-intro"/.test(app.html("todayList"));
const hasStartTask = (app) => /id="act-c1-startclock"/.test(app.html("todayList"));

/* ---------- 1: intro done but not started surfaces the start-clock task ---------- */
{
  const app = boot({ members: [introDone({ booked: daysFromToday(3) })] });
  const today = app.html("todayList");
  assert.ok(hasStartTask(app), "the start-the-clock task is on Today's moves");
  assert.ok(today.includes("Waiting on a first session"), "…under its own group heading");
  assert.ok(today.includes("Sophie Webhook"), "…naming the challenger");
  assert.ok(/Confirm their first session to start their 42 days/.test(today),
    "…and saying what the coach has to do");

  // it carries the action itself — the whole point is not having to go to the Challengers tab
  assert.ok(/First session attended — start clock/.test(today), "the start control is on the task");
  assert.ok(/markFirstSession\('c1',true\)/.test(today), "…wired to the real start handler");
  assert.ok(/setBookedDate\('c1'/.test(today), "…and the booked-date field comes with it");
  assert.ok(today.includes("Booked " ), "the booked date shows on the row");
  // inline on the row, not folded away: nothing should stand between the coach and the one
  // action that clears this task
  assert.ok(!/id="act-c1-startclock"[^>]*class="[^"]*\bopen\b/.test(today),
    "the task does not need expanding — the control is already on the row");

  // it is a waiting-for state, so there is nothing to mark done or missed on it
  const task = /<div class="[^"]*" id="act-c1-startclock"[\s\S]*?(?=<div class="group-label"|$)/
    .exec(today)[0];
  assert.ok(!/toggleDone\('c1'/.test(task), "no Done button — only the clock resolves this");
  assert.ok(!/markMissed\('c1'/.test(task), "and no Missed button either");
  assert.ok(/class="action awaiting"/.test(task), "…and it renders in the quiet style");

  assert.strictEqual(app.el("todayCount").textContent, "1", "it counts on the tab badge");
}

/* ---------- 2: no double-show — the intro card is gone once its admin is done ---------- */
{
  const app = boot({ members: [introDone()] });
  assert.ok(!hasIntroCard(app), "the full intro card does not come back");
  assert.ok(hasStartTask(app), "…the start-the-clock task stands in its place");
}

/* ---------- 3: a challenger who hasn't had their intro still shows the intro card ---------- */
{
  const app = boot({ members: [fresh()] });
  assert.ok(hasIntroCard(app), "the normal intro card is unchanged");
  assert.ok(!hasStartTask(app), "…and the start-clock task has not jumped the queue");
  const today = app.html("todayList");
  assert.ok(today.includes("Intro sessions to run"), "under its own heading, as before");
  assert.ok(/toggleDone\('c1','intro',true\)/.test(today), "with its Done button, as before");
  assert.ok(/markMissed\('c1','intro'\)/.test(today), "and its Missed button, as before");
  // the intro card still carries the start control it always did — nothing was taken away
  assert.ok(/markFirstSession\('c1',true\)/.test(today), "the intro card keeps its start block");
}

/* ---------- 4: starting the clock from the task clears it and begins the journey ---------- */
{
  const booked = daysFromToday(-2);          // their session was two days ago
  const app = boot({ members: [introDone({ booked })] });
  assert.ok(hasStartTask(app), "waiting to start");

  app.ctx.markFirstSession("c1", true);      // exactly what the task's button calls

  const m = app.find("c1");
  assert.strictEqual(m.firstSessionDone, true, "the clock is running");
  assert.strictEqual(m.day0, booked, "Day 0 is anchored to the session they actually attended");
  assert.strictEqual(app.ctx.status(m), "live", "they are on the journey");
  assert.strictEqual(app.ctx.currentDay(m), 2, "…on day 2, counted from the session date");

  assert.ok(!hasStartTask(app), "the task has cleared");
  assert.ok(!hasIntroCard(app), "…and the intro card did not reappear");
  assert.strictEqual(app.ctx.awaitingStart(m), false);
  // and their journey is genuinely running — a dated touchpoint has come due
  assert.ok(app.html("todayList").includes("Sophie Webhook"),
    "they are back on Today's moves, now for real journey work");
}

/* ---------- 5: the clock still anchors correctly with no booked date ---------- */
{
  const app = boot({ members: [introDone()] });          // booked: null
  assert.ok(app.html("todayList").includes("No date yet"), "the row says the date is missing");
  app.ctx.markFirstSession("c1", true);
  assert.strictEqual(app.find("c1").day0, daysFromToday(0),
    "with no booked date, Day 0 falls back to today — unchanged behaviour");
}

/* ---------- 6: setting the date from the task sticks, and the row keeps up ---------- */
{
  const when = daysFromToday(4);
  const app = boot({ members: [introDone()] });
  app.ctx.setBookedDate("c1", dateInput(when));
  assert.strictEqual(app.find("c1").booked, when, "the booked date is saved");
  assert.strictEqual(app.find("c1").day0, null, "…and booking alone does not start the clock");
  assert.ok(app.html("todayList").includes("Booked "), "the row re-rendered with the new date");
  assert.ok(hasStartTask(app), "…and is still waiting");
  // starting now anchors to the date just set
  app.ctx.markFirstSession("c1", true);
  assert.strictEqual(app.find("c1").day0, when);
}

/* ---------- 7: it STAYS until the clock starts, and flags a date that has passed ---------- */
{
  const app = boot({ members: [introDone({ booked: daysFromToday(-9) })] });
  app.ctx.renderAll();
  app.ctx.renderAll();                                   // still there after any re-render
  assert.ok(hasStartTask(app), "the task does not time out or expire");
  assert.ok(/Session date passed/.test(app.html("todayList")),
    "a booked session that has been and gone is flagged — that is the drift being caught");
  // …and no flag when the date is still ahead
  const soon = boot({ members: [introDone({ booked: daysFromToday(3) })] });
  assert.ok(!/Session date passed/.test(soon.html("todayList")), "no flag before the date");
}

/* ---------- 8: who does NOT get the task ---------- */
{
  const cases = [
    ["no intro yet", fresh(), false],
    ["intro marked MISSED, not done", fresh({ missed: ["intro"] }), false],
    ["already started", introDone({ booked: daysFromToday(-5), day0: daysFromToday(-5), firstSessionDone: true }), false],
    ["left the challenge", introDone({ outcome: "left" }), false],
    ["intro done, not started", introDone(), true],
  ];
  for (const [label, member, expected] of cases) {
    const app = boot({ members: [member] });
    assert.strictEqual(app.ctx.awaitingStart(app.find("c1")), expected, label);
    assert.strictEqual(hasStartTask(app), expected, label + " (on Today's moves)");
  }
  // an intro marked missed clears the intro card without conjuring a start-clock task,
  // so Today is genuinely empty for them
  const missed = boot({ members: [fresh({ missed: ["intro"] })] });
  assert.ok(missed.html("todayList").includes("All caught up"),
    "a missed intro leaves nothing behind — marking it missed is a record that it did not happen");
}

/* ---------- 9: it does not disturb anyone else on Today ---------- */
{
  const other = fresh({ id: "c2", name: "Katie Leicester", booked: daysFromToday(-3),
    day0: daysFromToday(-3), firstSessionDone: true, completed: ["intro"] });
  const app = boot({ members: [introDone({ booked: daysFromToday(1) }), other] });
  const today = app.html("todayList");
  assert.ok(hasStartTask(app), "the waiting challenger has her task");
  assert.ok(today.includes("Katie Leicester"), "…and the live challenger still has her touchpoints");
  assert.ok(today.indexOf("Waiting on a first session") < today.indexOf("Texts &amp; Trainerize")
    || today.indexOf("Waiting on a first session") < today.indexOf("Texts & Trainerize"),
    "the waiting group sits above the day's channel work, where it is easy to find");
  // the badge counts both kinds
  assert.ok(Number(app.el("todayCount").textContent) >= 2, "both are counted");
}

/* ---------- 10: the Challengers tab points at whichever card is actually showing ---------- */
{
  const before = boot({ members: [fresh()] });
  assert.ok(/Go to the intro on Today/.test(before.html("memberList")),
    "intro outstanding: the card sends you to the intro");
  const after = boot({ members: [introDone()] });
  const cards = after.html("memberList");
  assert.ok(/Go to their start-the-clock task/.test(cards),
    "intro done: the card sends you to the start-the-clock task instead");
  assert.ok(/start-the-clock task is waiting on Today/.test(cards),
    "…and says so, rather than pointing at an intro card that is no longer there");
}

console.log("start-clock.test.cjs: OK");
