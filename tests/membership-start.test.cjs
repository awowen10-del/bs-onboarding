// Membership start: the day a challenger's six weeks end is the day their membership starts.
//
// It is shown on their card so a coach can tell them, it moves with pauses and added days, and a
// coach can type a different date on the Edit form. Somebody who pays through the memberships link
// part way through gets a task to move their next payment in GHL, which comes from the morning
// job's 'challenge-flags' row. Tapping "Done, payment moved" marks them as stayed on, and their
// member journey starts on the membership start date, not the day of the tap.
const assert = require("assert");
const { boot, daysFromToday, dateInput } = require("./lib/env.cjs");

const fmt = (ts) => new Date(ts).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const monthAfter = (ts) => { const d = new Date(ts); d.setMonth(d.getMonth() + 1); d.setHours(0, 0, 0, 0); return d.getTime(); };
const challenger = (id, name, day, extra) => Object.assign({
  id, name, coach: "Dan", dob: null, personal: "", email: id + "@example.com",
  day0: daysFromToday(-day), booked: daysFromToday(-day), firstSessionDone: true,
  completed: ["intro"], doneMeta: {}, checks: {}, missed: [],
  outcome: null, signedUp: false, extraDays: 0, pausedDays: 0, pausedAt: null,
  followUpOn: null, followUpStatus: null, notes: "",
}, extra || {});

/* ---------- the date on the card ---------- */
{
  const app = boot({ members: [challenger("a", "Annie", 30)] });
  const end = daysFromToday(12);                                    // day 30 of 42
  assert.strictEqual(app.ctx.challengeEnd(app.find("a")), end);
  assert.ok(app.html("memberList").includes("Membership starts " + fmt(end)), "shown on their card");
}
{
  const app = boot({ members: [challenger("a", "Annie", 30, { extraDays: 7 })] });
  assert.strictEqual(app.ctx.challengeEnd(app.find("a")), daysFromToday(19), "added days move it");
}
{
  const typed = daysFromToday(20);
  const app = boot({ members: [challenger("a", "Annie", 30, { memberStart: typed })] });
  assert.strictEqual(app.ctx.challengeEnd(app.find("a")), typed, "a date a coach typed wins");
  assert.ok(app.html("memberList").includes("(set by hand)"));
}
{
  const app = boot({ members: [challenger("a", "Annie", 0, { firstSessionDone: false, day0: null })] });
  assert.strictEqual(app.ctx.challengeEnd(app.find("a")), null, "no date until the clock starts");
}

/* ---------- the Edit form ---------- */
{
  const app = boot({ members: [challenger("a", "Annie", 30)] });
  app.ctx.openEdit("a");
  assert.strictEqual(app.el("f-mstart").value, "", "blank means the challenge end date");
  app.el("f-mstart").value = dateInput(daysFromToday(21));
  app.ctx.saveMember();
  assert.strictEqual(app.find("a").memberStart, daysFromToday(21));
  app.ctx.openEdit("a");
  app.el("f-mstart").value = "";
  app.ctx.saveMember();
  assert.strictEqual(app.find("a").memberStart, null, "clearing it goes back to the end date");
}

/* ---------- paid through the link: the payment task ---------- */
async function cloudTests() {
  const app = boot({ cloud: { rows: {
    roster: [challenger("a", "Annie", 30), challenger("b", "Ben", 30)],
    retention: [],
    "challenge-flags": { a: { paid: true, seen: "2026-12-01" } },
    seeded: true,
  } } });
  await app.ctx.bootData();
  const end = daysFromToday(12);
  const cards = app.html("memberList");
  assert.ok(cards.includes("Paid for a membership through the link"), "Annie's card says so");
  assert.ok(cards.includes(fmt(monthAfter(end))), "…with the date to move the next payment to: a month after the end");
  assert.strictEqual((cards.match(/Paid for a membership through the link/g) || []).length, 1, "and only Annie's");
  assert.ok(app.html("todayList").includes("Move a membership payment"), "it's on Today's moves");

  app.ctx.paymentMoved("a");
  assert.strictEqual(app.find("a").paymentMoved, true);
  assert.strictEqual(app.find("a").outcome, "stayed", "paying means they stayed on");
  assert.ok(!app.html("todayList").includes("Move a membership payment"), "the task clears");
  assert.ok(!app.html("memberList").includes("Paid for a membership through the link"));
  assert.strictEqual(app.retention().length, 1, "they're on the members tracker");
  assert.strictEqual(app.retention()[0].joined, end, "…from the day their challenge ends");
}

cloudTests().then(() => console.log("membership-start: ok"), (e) => { console.error(e); process.exit(1); });
