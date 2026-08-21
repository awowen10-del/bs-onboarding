// Birthdays as WORK, on Today's moves.
//
// The Birthdays tab is for planning — twelve months, read when you go looking. Today's moves
// is what a coach opens every morning, so a birthday has to arrive there or it arrives on the
// day itself with nothing bought and nothing written.
//
// The claim this file exists to hold is the one about state: there is NO separate notion of a
// birthday task being done. Pressing Done here is pressing Actioned on the Birthdays tab, the
// same field, the same year. Every way of getting that wrong — a parallel flag, a boolean, a
// tick that does not survive to the other screen — shows up as a failure below.
const assert = require("assert");
const { boot, daysFromToday } = require("./lib/env.cjs");

// a date of birth putting somebody's NEXT birthday exactly `n` days out, turning `age`
const at = (n, age) => {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + n);
  const p = (x) => String(x).padStart(2, "0");
  return (d.getFullYear() - age) + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
};
// the calendar year that birthday falls in — what Actioned has to be stored against
const yearOf = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return d.getFullYear(); };

const person = (id, name, dob, extra) => Object.assign({
  id, name, coach: "Gaz", dob, personal: "",
  day0: daysFromToday(-8), booked: daysFromToday(-8), firstSessionDone: true,
  completed: ["intro"], doneMeta: {}, checks: {}, missed: [],
  outcome: null, signedUp: false, extraDays: 0, pausedDays: 0, pausedAt: null,
  followUpOn: null, followUpStatus: null, notes: "",
}, extra || {});

// the "Birthdays this week" group, sliced out of Today's moves
const group = (app) => {
  const h = app.html("todayList");
  const i = h.indexOf("Birthdays this week");
  if (i === -1) return "";
  const end = h.indexOf('<div class="board">', i);
  return end === -1 ? h.slice(i) : h.slice(i, end);
};
const rows = (app) => group(app).split('<div class="action').slice(1);
const rowFor = (app, name) => rows(app).find((r) => r.includes(name)) || "";
const onToday = (app, name) => group(app).includes(name);
const field = (row, cls) => (new RegExp('class="' + cls + '">([^<]*)').exec(row) || [, ""])[1];
// rows() splits on `<div class="action`, so a row's own classes are what follows that
const classesOf = (row) => ("action" + (/^([^"]*)"/.exec(row) || [, ""])[1]).trim();
// the Birthdays tab's own row for the same person
const tabRow = (app, name) =>
  app.html("birthdayList").split('<div class="bday-row').find((r) => r.includes(name)) || "";

/* ---------- 1: inside the week it appears, outside it does not ----------
   Both ends are inclusive: the day itself is very much a day there is work to do, and the
   seventh day out is the first morning the card can sensibly be written. */
{
  const app = boot({ members: [
    person("t", "Tara Today", at(0, 29)),
    person("m", "Milo Midweek", at(3, 31)),
    person("e", "Edge Eddie", at(7, 26)),
    person("j", "Just Missed Jo", at(8, 27)),
    person("f", "Far Fred", at(90, 33)),
  ] });

  assert.strictEqual(rows(app).length, 3, "three inside the window");
  for (const n of ["Tara Today", "Milo Midweek", "Edge Eddie"]) {
    assert.ok(onToday(app, n), n + " is on Today's moves");
  }
  assert.ok(!onToday(app, "Just Missed Jo"), "eight days out is not this week");
  assert.ok(!onToday(app, "Far Fred"), "…and neither is three months");

  // soonest first, so the one you have least time for leads
  const order = rows(app).map((r) => field(r, "nm"));
  assert.deepStrictEqual(order, ["Tara Today", "Milo Midweek", "Edge Eddie"], "soonest first");

  // somebody with no date of birth cannot raise one, and asking does not throw
  const none = boot({ members: [person("n", "Nell None", null)] });
  assert.strictEqual(group(none), "", "no dob, no birthday task");
  assert.strictEqual(none.ctx.birthdayDue(none.find("n")), false);
}

/* ---------- 2: the card says whose, and when, in words ---------- */
{
  const app = boot({ members: [
    person("t", "Tara Today", at(0, 29)),
    person("w", "Will Tomorrow", at(1, 31)),
    person("m", "Milo Midweek", at(3, 32)),
  ] });

  assert.strictEqual(field(rowFor(app, "Tara Today"), "day"), "today");
  assert.strictEqual(field(rowFor(app, "Will Tomorrow"), "day"), "tomorrow");
  assert.strictEqual(field(rowFor(app, "Milo Midweek"), "day"), "in 3 days");

  // …and the date itself, named by its weekday
  const d = new Date(); d.setDate(d.getDate() + 3);
  const expect = "Birthday — " + d.toLocaleDateString("en-GB", { weekday: "long" })
    + " " + app.ctx.ordinal(d.getDate());
  assert.strictEqual(field(rowFor(app, "Milo Midweek"), "ttl"), expect, "the day is named");

  // today's is marked on the chip as well, because it is the one that cannot wait
  assert.ok(/class="ch birthday">Today 🎂</.test(rowFor(app, "Tara Today")), "today says so");
  assert.ok(/class="ch birthday">Birthday</.test(rowFor(app, "Milo Midweek")), "the rest read Birthday");
  assert.ok(/notes-btn/.test(rowFor(app, "Tara Today")), "the notes icon is on the card");
}

/* ---------- 3: the four steps are on every card ---------- */
{
  const app = boot({ members: [person("t", "Tara Today", at(2, 29))] });
  const STEPS = ["Write birthday card", "Give birthday card", "Protein bar with ribbon",
    "Balloons in their station"];
  assert.deepStrictEqual([...app.ctx.__t.BIRTHDAY_STEPS], STEPS, "the steps are the ones asked for");

  const row = rowFor(app, "Tara Today");
  const listed = (row.match(/<div class="ci"><span class="box"[^>]*><\/span><span>([^<]+)<\/span>/g) || [])
    .map((s) => /<span>([^<]+)<\/span>$/.exec(s)[1]);
  assert.deepStrictEqual(listed, STEPS, "all four, in order, as a checklist");
  assert.ok(/class="detail"/.test(row), "…inside the detail the card expands to");
  assert.ok(/toggleExpand\('t','birthday'\)/.test(row), "…which the card knows how to open");
}

/* ---------- 4: milestones are marked, consistently with the Birthdays tab ---------- */
{
  const MILESTONES = [18, 21, 30, 40, 50, 60, 65, 70, 80];
  for (const age of MILESTONES) {
    const app = boot({ members: [person("x", "Milestone Mo", at(4, age))] });
    const row = rowFor(app, "Milestone Mo");
    assert.ok(row.includes("🎉 Turning " + age), "turning " + age + " is flagged on the task");
    assert.strictEqual(classesOf(row), "action birthday milestone", "…and the row carries the accent");
    assert.ok(/above and beyond/.test(row), "…and says what that means");
    // the same badge the Birthdays tab prints, so the two screens agree on sight
    assert.ok(tabRow(app, "Milestone Mo").includes("🎉 Turning " + age), "…the same on the tab");
  }
  // and an ordinary age is an ordinary card
  const plain = boot({ members: [person("x", "Ordinary Ollie", at(4, 51))] });
  const row = rowFor(plain, "Ordinary Ollie");
  assert.ok(!/🎉/.test(row), "51 gets no badge");
  assert.strictEqual(classesOf(row), "action birthday", "…and no accent");
  assert.ok(/Get it ready before the day/.test(row), "…just the ordinary prompt");
}

/* ---------- 5: the two Birthdays-tab flags gate the task ---------- */
{
  const ignored = boot({ members: [person("i", "Ivy Ignored", at(2, 33), { birthdayIgnored: true })] });
  assert.strictEqual(group(ignored), "", "an ignored challenger never raises a task");
  assert.strictEqual(ignored.ctx.birthdayDue(ignored.find("i")), false);

  const done = boot({ members: [
    person("a", "Ann Actioned", at(4, 35), { birthdayActionedYear: yearOf(4) }),
  ] });
  assert.strictEqual(group(done), "", "a birthday already handled this year does not come back");
  assert.strictEqual(done.ctx.birthdayDue(done.find("a")), false);

  // LAST year's tick is not this year's — the task has to come round again
  const stale = boot({ members: [
    person("s", "Stale Sue", at(4, 35), { birthdayActionedYear: yearOf(4) - 1 }),
  ] });
  assert.ok(onToday(stale, "Stale Sue"), "last year's handling does not suppress this year's task");

  // and ignoring somebody from the Birthdays tab clears their task from Today's moves
  const both = boot({ members: [person("k", "Kim Keep", at(2, 30))] });
  assert.ok(onToday(both, "Kim Keep"), "she starts on Today's moves");
  both.ctx.setBirthdayIgnored("k", true);
  assert.strictEqual(group(both), "", "…and ignoring her on the other tab takes her off it");
  both.ctx.setBirthdayIgnored("k", false);
  assert.ok(onToday(both, "Kim Keep"), "…and un-ignoring brings the task back");
}

/* ---------- 6: ONE state — Done here is Actioned there, and the reverse ----------
   The load-bearing block. Each direction is driven through the button a coach would press and
   read back on the other screen, so a parallel completion flag could not pass it. */
{
  // Today's moves -> the Birthdays tab
  const app = boot({ members: [person("t", "Tara Today", at(2, 29))] });
  assert.strictEqual(app.find("t").birthdayActionedYear, null, "nothing is handled to start with");
  assert.ok(onToday(app, "Tara Today"));

  app.ctx.toggleBirthdayActioned("t");                     // exactly what the Done button calls
  assert.strictEqual(app.find("t").birthdayActionedYear, yearOf(2),
    "Done stores the YEAR of the birthday it settles — not a boolean, not a separate field");
  assert.strictEqual(app.ctx.birthdayActioned(app.find("t")), true);
  assert.strictEqual(group(app), "", "the task clears from Today's moves");
  assert.ok(/\bactioned\b/.test(tabRow(app, "Tara Today")), "…and the tab shows it handled");
  assert.ok(/✓ Actioned/.test(tabRow(app, "Tara Today")), "…with the tick on its button");

  // the Birthdays tab -> Today's moves
  const back = boot({ members: [person("t", "Tara Today", at(2, 29))] });
  back.ctx.toggleBirthdayActioned("t");                    // the tab's Actioned button
  assert.strictEqual(group(back), "", "pressing Actioned on the tab clears the task on Today");
  back.ctx.toggleBirthdayActioned("t");                    // and undoing it
  assert.ok(onToday(back, "Tara Today"), "…and un-actioning brings the task back");

  // there is exactly one field carrying this, and it is the roster's own
  const fields = Object.keys(app.find("t")).filter((k) => /birthday/i.test(k));
  assert.deepStrictEqual(fields.sort(), ["birthdayActionedYear", "birthdayIgnored"],
    "no third birthday field appeared to track the task separately");
  assert.strictEqual(app.cached().find((m) => m.id === "t").birthdayActionedYear, yearOf(2),
    "and it is in the blob that syncs, so the other coach's phone agrees");
}

/* ---------- 7: it counts as work, and an otherwise clear day is not "all caught up" ------ */
{
  // somebody long finished, so no journey touchpoint is due — only the birthday
  const quiet = person("q", "Quiet Quinn", at(3, 30), {
    day0: daysFromToday(-90), booked: daysFromToday(-90), outcome: "stayed", signedUp: true,
    completed: ["intro", "d1_text", "d3_postcard", "wk2", "wk3", "wk4", "wk5", "wk6"],
  });
  const app = boot({ members: [quiet] });
  assert.deepStrictEqual([...app.ctx.dueToday(app.find("q"))], [], "sanity: no touchpoint is due");
  assert.ok(!app.html("todayList").includes("All caught up"),
    "a birthday coming up means the day is not clear");
  assert.ok(onToday(app, "Quiet Quinn"), "…because their birthday is on it");
  assert.strictEqual(app.el("todayCount").textContent, "1", "and the tab badge counts it");

  app.ctx.toggleBirthdayActioned("q");
  assert.ok(app.html("todayList").includes("All caught up"), "handling it clears the day");
  assert.strictEqual(app.el("todayCount").textContent, "0", "…and the badge with it");
}

/* ---------- 8: the group is its own thing, and the board is untouched ----------
   A birthday goes out through none of the three channels the board's columns are, so it is a
   labelled group of its own rather than a fourth column or a card filed under "Postcards". */
{
  const app = boot({ members: [
    person("t", "Tara Today", at(1, 29)),
    person("j", "Jake Journey", null),                 // day 8, so touchpoints are due
  ] });
  const h = app.html("todayList");

  assert.ok(/<div class="group-label">Birthdays this week<span class="gcount">1<\/span>/.test(h),
    "the group is labelled and counted like the others");
  assert.ok(h.indexOf("Birthdays this week") < h.indexOf('<div class="board">'),
    "…and sits above the board rather than inside it");

  // the board still has its three columns and its cards, in order
  const board = h.slice(h.indexOf('<div class="board">'));
  assert.deepStrictEqual((board.match(/data-col="([^"]+)"/g) || []),
    ['data-col="intro"', 'data-col="digital"', 'data-col="physical"'], "the columns are unchanged");
  // Tara's NAME is legitimately in a column — she is eight days into her journey and has
  // touchpoints due. What must not be there is her birthday TASK.
  assert.ok(!/-birthday"/.test(board), "no birthday task leaked into a column");
  assert.ok(!/ch birthday/.test(board), "…and no birthday chip");
  assert.ok(board.includes("Jake Journey"), "…and the journey work is still there");

  // the row is not a journey touchpoint: no Missed, because a birthday cannot be half-done
  const row = rowFor(app, "Tara Today");
  assert.ok(/>Done</.test(row), "there is a Done");
  assert.ok(!/markMissed/.test(row), "…and no Missed: the day happens whether or not you act");
}

/* ---------- 9: challengers only, for now ---------- */
{
  const app = boot({
    members: [person("t", "Tara Today", at(2, 29))],
    retention: [{ id: "r1", name: "Mo Member", coach: "Dan", dob: at(2, 29),
      email: "", personal: "", notes: "", joined: daysFromToday(-90) }],
  });
  assert.ok(onToday(app, "Tara Today"), "the challenger's birthday is on Today's moves");
  assert.ok(!app.html("retTodayList").includes("Birthdays this week"),
    "the retention Today has no birthday group yet — members are mirrored later");
  assert.ok(!app.html("retTodayList").includes("Mo Member's birthday"));
}

console.log("birthday-today.test.cjs: OK");
