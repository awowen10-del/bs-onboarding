// Data-model harness. Assertions: a roster written before follow-ups and notes existed
// loads, migrates and RENDERS without error; the new fields default to null/empty rather
// than undefined; migration never clobbers values that are already there; and a legacy
// challenger surfaces neither a follow-up task nor a "has notes" icon.
const assert = require("assert");
const { boot, daysFromToday } = require("./lib/env.cjs");

// Exactly what a device that hasn't loaded the new build has in its cache: no followUpOn,
// no followUpStatus, no notes. The first record also predates day0/booked (it used `start`).
const LEGACY = [
  { id: "leg1", name: "Jo Ancient", coach: "Dan", start: daysFromToday(-20), completed: ["intro"], doneMeta: {} },
  { id: "leg2", name: "Ray Older", coach: "Grace", day0: daysFromToday(-50), booked: daysFromToday(-50),
    firstSessionDone: true, outcome: "left", completed: [], doneMeta: {}, checks: {}, missed: [] },
];

/* ---------- 1: the new fields default, and nothing is undefined ---------- */
{
  const app = boot({ members: LEGACY });
  for (const m of app.members()) {
    assert.strictEqual(m.followUpOn, null, m.name + " followUpOn should default to null");
    assert.strictEqual(m.followUpStatus, null, m.name + " followUpStatus should default to null");
    assert.strictEqual(m.notes, "", m.name + " notes should default to an empty string");
    assert.ok(!("undefined" in m), "no undefined keys");
  }
  // the pre-existing `start` migration still runs alongside the new defaults
  const jo = app.find("leg1");
  assert.strictEqual(jo.day0, LEGACY[0].start, "legacy start -> day0 still migrates");
  assert.strictEqual(jo.firstSessionDone, true);
}

/* ---------- 2: a legacy roster renders every surface without throwing ---------- */
{
  const app = boot({ members: LEGACY });
  // renderAll ran during boot; drive the table too (it is only rendered on demand)
  app.ctx.renderMemberTable();
  const today = app.html("todayList");
  const cards = app.html("memberList");
  const table = app.html("todayTable");
  assert.ok(cards.includes("Jo Ancient"), "legacy challenger renders on a card");
  assert.ok(table.includes("Ray Older"), "legacy challenger renders in the table");
  assert.ok(!today.includes("Follow-ups to make"), "no follow-up group for legacy data");
  assert.ok(!/notes-btn[^"]*has/.test(cards + today + table), "no legacy record reads as having notes");
  assert.strictEqual(app.ctx.hasNotes(app.find("leg1")), false);
  assert.strictEqual(app.ctx.followUpPending(app.find("leg2")), false, "a plain legacy Left is not a follow-up");
  assert.strictEqual(app.ctx.followUpDue(app.find("leg2")), false);
}

/* ---------- 3: migration is idempotent and never clobbers real values ---------- */
{
  const when = daysFromToday(12);
  const app = boot({ members: [] });
  const once = app.ctx.migrateList([
    { id: "x", name: "Al", coach: "Ash", followUpOn: when, followUpStatus: "pending", notes: "<b>keep me</b>" },
  ]);
  const twice = app.ctx.migrateList(JSON.parse(JSON.stringify(once)));
  assert.strictEqual(twice[0].followUpOn, when, "an existing follow-up date survives migration");
  assert.strictEqual(twice[0].followUpStatus, "pending");
  assert.strictEqual(twice[0].notes, "<b>keep me</b>", "existing notes survive migration");
  // and a 'done' follow-up is not resurrected
  const done = app.ctx.migrateList([{ id: "y", name: "Bo", coach: "Ash", followUpOn: daysFromToday(-3), followUpStatus: "done" }]);
  assert.strictEqual(done[0].followUpStatus, "done");
  assert.strictEqual(app.ctx.followUpDue(done[0]), false, "a done follow-up never comes back");
}

/* ---------- 4: newly added challengers carry the fields from birth ---------- */
{
  const app = boot({ members: [] });
  app.el("f-name").value = "Nina New";
  app.el("f-coach").value = "Dan";
  app.el("f-personal").value = "trains before work";
  app.ctx.saveMember();
  const m = app.members()[0];
  assert.strictEqual(m.followUpOn, null);
  assert.strictEqual(m.followUpStatus, null);
  assert.strictEqual(m.notes, "");
  // and the saved blob (what syncs to everyone else) carries them too
  assert.deepStrictEqual(
    Object.keys(app.cached()[0]).filter((k) => ["followUpOn", "followUpStatus", "notes"].includes(k)).sort(),
    ["followUpOn", "followUpStatus", "notes"]
  );
}

console.log("migration.test.cjs: OK");
