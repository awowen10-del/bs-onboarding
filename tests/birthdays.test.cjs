// Birthdays harness. Assertions: dob defaults to null on a roster written before it existed
// and never throws; the Edit form round-trips a date of birth through the normal save path
// and refuses nonsense; the tab groups by birth month, orders by day of month, leads with
// the current month, hides quiet months but keeps the current one, formats the day as an
// ordinal, carries the notes icon, and leaves out anyone without a date of birth.
const assert = require("assert");
const { boot, daysFromToday } = require("./lib/env.cjs");

const NOW = new Date();
const CUR_M = NOW.getMonth() + 1;               // 1-12
const CUR_D = NOW.getDate();
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
const pad = (n) => String(n).padStart(2, "0");
// a month that is definitely not this one, and the one after this one
const OTHER_M = CUR_M === 1 ? 7 : 1;
const NEXT_M = (CUR_M % 12) + 1;

function person(id, name, dob, extra) {
  return Object.assign({
    id, name, coach: "Dan", dob,
    day0: daysFromToday(-7), booked: daysFromToday(-7), firstSessionDone: true,
    completed: [], doneMeta: {}, checks: {}, missed: [], outcome: null, signedUp: false,
    extraDays: 0, pausedDays: 0, pausedAt: null,
  }, extra || {});
}

/* ---------- 1: legacy rosters default to null and still render ---------- */
{
  const app = boot({ members: [
    { id: "old", name: "Jo Ancient", coach: "Dan", day0: daysFromToday(-30), firstSessionDone: true },
  ] });
  assert.strictEqual(app.find("old").dob, null, "dob defaults to null");
  assert.ok(app.html("birthdayList").includes("No birthdays on file yet"),
    "a roster with no dobs shows the empty state, not a broken tab");
  assert.ok(app.html("memberList").includes("Jo Ancient"), "and everything else still renders");

  // migration keeps a dob that is already there, and is idempotent
  const once = app.ctx.migrateList([{ id: "z", name: "Zed", coach: "Ash", dob: "1988-02-29" }]);
  const twice = app.ctx.migrateList(JSON.parse(JSON.stringify(once)));
  assert.strictEqual(twice[0].dob, "1988-02-29", "a real leap-day birthday survives migration");
}

/* ---------- 2: only real calendar dates are stored ---------- */
{
  const app = boot({ members: [] });
  const { normalizeDob, dobParts } = app.ctx;
  assert.strictEqual(normalizeDob("1990-04-23"), "1990-04-23");
  assert.strictEqual(normalizeDob("1988-02-29"), "1988-02-29", "1988 was a leap year");
  for (const bad of ["", null, undefined, "not a date", "1990-02-30", "1990-13-01",
    "1990-00-10", "1990-04-31", "23/04/1990", "1990-4", "0000-01-01"]) {
    assert.strictEqual(normalizeDob(bad), null, JSON.stringify(bad) + " must not be stored");
  }
  assert.deepStrictEqual({ ...dobParts("1990-04-23") }, { y: 1990, m: 4, d: 23 });
  assert.strictEqual(dobParts("1990-02-30"), null, "30 February is not a date");
}

/* ---------- 3: the Edit form round-trips a dob through the normal save path ---------- */
{
  const app = boot({ members: [person("sam", "Sam Doyle", null)] });

  app.ctx.openEdit("sam");
  assert.strictEqual(app.el("f-dob").value, "", "no dob yet, so the field is empty");
  assert.strictEqual(app.el("f-name").value, "Sam Doyle", "…and the rest of the form still loads");

  app.el("f-dob").value = "1990-04-23";
  app.ctx.saveMember();
  assert.strictEqual(app.find("sam").dob, "1990-04-23", "typed by hand and stored");
  assert.strictEqual(app.cached()[0].dob, "1990-04-23", "…and pushed through the sync path");
  assert.strictEqual(app.el("modalBg").classList.contains("show"), false, "the modal closes");

  // correcting it
  app.ctx.openEdit("sam");
  assert.strictEqual(app.el("f-dob").value, "1990-04-23", "reopening shows what was saved");
  app.el("f-dob").value = "1991-12-01";
  app.ctx.saveMember();
  assert.strictEqual(app.find("sam").dob, "1991-12-01", "corrected by hand");

  // clearing it
  app.ctx.openEdit("sam");
  app.el("f-dob").value = "";
  app.ctx.saveMember();
  assert.strictEqual(app.find("sam").dob, null, "cleared back to null, not to an empty string");

  // editing somebody else's details must not touch their dob by accident
  app.ctx.openEdit("sam");
  app.el("f-dob").value = "1990-04-23";
  app.ctx.saveMember();
  app.ctx.openEdit("sam");
  app.el("f-name").value = "Samantha Doyle";
  app.ctx.saveMember();
  assert.strictEqual(app.find("sam").dob, "1990-04-23", "a name change leaves the dob alone");
  assert.strictEqual(app.find("sam").name, "Samantha Doyle");

  // adding a brand new challenger with a dob
  app.ctx.openAdd();
  assert.strictEqual(app.el("f-dob").value, "", "the Add form starts blank");
  app.el("f-name").value = "Nina New";
  app.el("f-dob").value = "2001-07-09";
  app.ctx.saveMember();
  assert.strictEqual(app.members().find((m) => m.name === "Nina New").dob, "2001-07-09");
}

/* ---------- 4: grouped by month, ordered by day, quiet months hidden ---------- */
{
  const app = boot({ members: [
    person("a", "Aaron Third", `1990-${pad(OTHER_M)}-03`),
    person("b", "Bella First", `1985-${pad(OTHER_M)}-01`),
    person("c", "Cara Twentieth", `1992-${pad(OTHER_M)}-20`),
    person("d", "Dev NextMonth", `1988-${pad(NEXT_M)}-15`),
    person("e", "Eve NoDob", null),
  ] });
  const h = app.html("birthdayList");

  // in day order within the month, not the order they were added
  const iB = h.indexOf("Bella First"), iA = h.indexOf("Aaron Third"), iC = h.indexOf("Cara Twentieth");
  assert.ok(iB < iA && iA < iC, "1st, then 3rd, then 20th");

  // ordinals
  assert.ok(h.includes(">1st<"), "1st");
  assert.ok(h.includes(">3rd<"), "3rd");
  assert.ok(h.includes(">20th<"), "20th");

  // months present / absent
  assert.ok(h.includes(MONTHS[OTHER_M - 1]), "the month with birthdays is shown");
  assert.ok(h.includes(MONTHS[NEXT_M - 1]), "so is next month");
  const shown = MONTHS.filter((name) => h.includes(">" + name));
  const expected = new Set([MONTHS[OTHER_M - 1], MONTHS[NEXT_M - 1], MONTHS[CUR_M - 1]]);
  shown.forEach((name) => assert.ok(expected.has(name),
    name + " has no birthdays and is not this month — it should be hidden"));

  // nobody without a dob leaks in, but we are told they are missing
  assert.ok(!h.includes("Eve NoDob"), "a challenger with no dob is not listed");
  // "person", not "challenger": the tab is merged now and counts everybody on it
  assert.ok(/1 person has no date of birth yet/.test(h), "…but is counted as missing");

  // the notes icon travels with the name here too
  assert.ok(h.includes("notes-btn"), "the notes icon is on the birthdays tab");
  assert.ok(/openNotes\((&#39;|')a\1\)/.test(h), "…and opens that client's notes");
}

/* ---------- 5: the current month leads, is marked, and is kept even when empty ---------- */
{
  // give nobody a birthday this month
  const app = boot({ members: [
    person("d", "Dev NextMonth", `1988-${pad(NEXT_M)}-15`),
    person("a", "Aaron Other", `1990-${pad(OTHER_M)}-03`),
  ] });
  const h = app.html("birthdayList");

  assert.ok(h.indexOf(MONTHS[CUR_M - 1]) === h.indexOf(MONTHS.find((m) => h.includes(">" + m))) ||
    h.indexOf(">" + MONTHS[CUR_M - 1]) < h.indexOf(">" + MONTHS[NEXT_M - 1]),
    "the current month comes first");
  assert.ok(h.includes("This month"), "…and is labelled");
  assert.ok(h.includes("bday-month now"), "…and carries the highlight class");
  assert.ok(h.includes("No birthdays in " + MONTHS[CUR_M - 1]),
    "an empty current month says so rather than vanishing");

  // the rest of the year runs on from here and wraps round
  if (NEXT_M !== OTHER_M) {
    const iNext = h.indexOf(">" + MONTHS[NEXT_M - 1]);
    const iOther = h.indexOf(">" + MONTHS[OTHER_M - 1]);
    const wrapped = ((NEXT_M - CUR_M + 12) % 12) < ((OTHER_M - CUR_M + 12) % 12);
    assert.ok(wrapped ? iNext < iOther : iOther < iNext,
      "months run forward from this one and wrap round the year");
  }
}

/* ---------- 6: a birthday today is called out ---------- */
{
  const app = boot({ members: [
    person("t", "Tara Today", `1990-${pad(CUR_M)}-${pad(CUR_D)}`),
    person("n", "Norm NotToday", `1990-${pad(CUR_M)}-${pad(CUR_D === 28 ? 1 : 28)}`),
  ] });
  const h = app.html("birthdayList");
  assert.ok(h.includes("Today 🎂"), "it is somebody's birthday today and the tab says so");
  // everything between her name and the next person's is her row (the inline notes SVG
  // makes a row several hundred characters long, so slice to the neighbour, not a guess)
  const names = [h.indexOf("Tara Today"), h.indexOf("Norm NotToday")].sort((a, b) => a - b);
  const taraRow = h.indexOf("Tara Today") < h.indexOf("Norm NotToday")
    ? h.slice(names[0], names[1]) : h.slice(names[1]);
  assert.ok(taraRow.includes("Today 🎂"), "…on the right person");
  assert.strictEqual((h.match(/Today 🎂/g) || []).length, 1, "…and only that person");
}

/* ---------- 7: the tab exists and nothing else moved ---------- */
{
  const fs = require("fs");
  const path = require("path");
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.ok(/data-view="birthdays"/.test(html), "there is a Birthdays tab button");
  assert.ok(/id="view-birthdays"/.test(html), "…and a section for it to switch to");
  ["today", "members", "playbook"].forEach((v) => {
    assert.ok(html.includes('data-view="' + v + '"'), "the " + v + " tab is still there");
    assert.ok(html.includes('id="view-' + v + '"'), "…with its section");
  });

  // and the rest of the app is unaffected by a roster that now carries dobs
  const app = boot({ members: [person("sam", "Sam Doyle", "1990-04-23")] });
  app.ctx.renderMemberTable();
  assert.ok(app.html("todayList").includes("Sam Doyle"), "Today still lists them");
  assert.ok(app.html("memberList").includes("Sam Doyle"), "the card still renders");
  assert.ok(app.html("todayTable").includes("Sam Doyle"), "the journey table still renders");
  assert.strictEqual(app.find("sam").dob, "1990-04-23", "and the dob survived it all");
}

console.log("birthdays.test.cjs: OK");
