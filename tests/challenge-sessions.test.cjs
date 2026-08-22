// Challenge sessions completed — one number, typed in by a coach.
//
// How many sessions somebody actually did during their six weeks is a thing a coach knows and
// the tracker does not. A challenge is six weeks until somebody pauses it, extends it, or
// comes back three weeks later — so counting it from the journey would produce a number that
// is confidently wrong for exactly the people it matters most for. It is typed.
//
// The distinction this file exists to hold is NULL versus ZERO. Null is "nobody has said";
// zero is "they did none". Anything that reads this number later — and something will — has
// to be able to tell those apart, because they point at opposite conclusions about the same
// person. A blank box therefore stays blank, and never quietly becomes a nought.
//
// Stage 1 captures and stores it. Nothing reads it yet, and that is the whole scope.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { boot, daysFromToday, settle } = require("./lib/env.cjs");

const HTML = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

const member = (id, name, extra) => Object.assign({
  id, name, coach: "Gaz", email: id + "@example.com", dob: null, personal: "", notes: "",
  joined: daysFromToday(-100), fromChallenger: null,
  completed: [], missed: [], doneMeta: {}, attendance: {},
}, extra || {});

// fill the member form and press Save, the way a coach does
function saveForm(app, fields) {
  Object.keys(fields).forEach((k) => { app.el("rf-" + k).value = fields[k]; });
  app.ctx.saveRetMember();
}

/* ---------- 1: the field exists on every member, and defaults to "nobody has said" ---------- */
{
  const app = boot({ retention: [member("r1", "Mo Member")] });
  const m = app.findMember("r1");
  assert.ok("challengeSessions" in m, "the field is on the record");
  assert.strictEqual(m.challengeSessions, null,
    "…as null: nobody has said, which is not the same as none");

  // a record from before this existed picks it up on the next load, and nothing else moves
  const old = { id: "old", name: "Wendy Booth", coach: "Dan", joined: daysFromToday(-300),
    notes: "<b>knee</b>", attendance: { "2026-W20": { attendedPT: 3 } } };
  const migrated = app.ctx.migrateRetentionList([JSON.parse(JSON.stringify(old))])[0];
  assert.strictEqual(migrated.challengeSessions, null, "an existing member defaults cleanly");
  assert.strictEqual(migrated.notes, "<b>knee</b>", "…with everything they had intact");
  assert.strictEqual(migrated.attendance["2026-W20"].attendedPT, 3, "…including their attendance");

  // and a number already on file is not clobbered by re-running migration
  const set = app.ctx.migrateRetentionList([{ id: "s", name: "Set", challengeSessions: 14 }])[0];
  assert.strictEqual(set.challengeSessions, 14, "a number already there is left alone");
  const twice = app.ctx.migrateRetentionList([JSON.parse(JSON.stringify(set))])[0];
  assert.strictEqual(twice.challengeSessions, 14, "…however many times it runs");
  const zero = app.ctx.migrateRetentionList([{ id: "z", name: "Zero", challengeSessions: 0 }])[0];
  assert.strictEqual(zero.challengeSessions, 0,
    "and a stored ZERO survives — it is an answer, not an empty field");
}

/* ---------- 2: the box on the member form ---------- */
{
  assert.ok(/id="rf-sessions"/.test(HTML), "the form has the input");
  const field = /<div class="field">(?:(?!<\/div>)[\s\S])*?id="rf-sessions"[\s\S]*?<\/div>/.exec(HTML)[0];
  assert.ok(/type="number"/.test(field), "…as a number input");
  assert.ok(/min="0"/.test(field), "…that cannot go below nothing");
  assert.ok(/Challenge sessions completed/.test(field), "…labelled in words a coach would use");
  assert.ok(/optional/.test(field), "…and marked optional, because it often is not known yet");
}

/* ---------- 3: typing a number stores a number ---------- */
{
  const app = boot({ retention: [] });
  app.ctx.openRetAdd();
  saveForm(app, { name: "Nina New", email: "nina@example.com", coach: "Gaz", dob: "", sessions: "14" });
  const m = app.retention()[0];
  assert.strictEqual(m.challengeSessions, 14, "typed in on the way in");
  assert.strictEqual(typeof m.challengeSessions, "number", "…as a number, not the string of one");

  // it comes back into the box when you re-open them, and survives a save that does not touch it
  app.ctx.openRetEdit(m.id);
  assert.strictEqual(app.el("rf-sessions").value, "14", "…and back out again when you edit them");
  saveForm(app, { name: "Nina New", email: "nina@example.com", coach: "Gaz", dob: "", sessions: "14" });
  assert.strictEqual(app.findMember(m.id).challengeSessions, 14, "…unchanged by an edit of anything else");

  // and it is editable: a coach who miscounted can fix it
  app.ctx.openRetEdit(m.id);
  saveForm(app, { name: "Nina New", email: "nina@example.com", coach: "Gaz", dob: "", sessions: "17" });
  assert.strictEqual(app.findMember(m.id).challengeSessions, 17, "changed to 17");
}

/* ---------- 4: blank is null, zero is zero, nonsense is null ----------
   The whole point of the field. */
{
  const app = boot({ retention: [member("r1", "Mo Member", { challengeSessions: 12 })] });
  const norm = app.ctx.normalizeSessions;

  assert.strictEqual(norm(""), null, "an empty box is “nobody has said”");
  assert.strictEqual(norm("   "), null, "…and so is a box of spaces");
  assert.strictEqual(norm(null), null);
  assert.strictEqual(norm("0"), 0, "zero is a real answer and is kept as one");
  assert.strictEqual(norm(0), 0, "…however it arrives");
  assert.strictEqual(norm("14"), 14);
  assert.strictEqual(norm(" 14 "), 14, "…trimmed");
  assert.strictEqual(norm("not a number"), null, "nonsense stores nothing rather than storing nonsense");
  assert.strictEqual(norm("-3"), 0, "a negative number of sessions is not a thing; it clamps");
  assert.strictEqual(norm("7.6"), 8, "…and half a session rounds to a whole one");

  // clearing the box on a member who had a number puts them back to "nobody has said"
  app.ctx.openRetEdit("r1");
  assert.strictEqual(app.el("rf-sessions").value, "12", "sanity: their number is in the box");
  saveForm(app, { name: "Mo Member", email: "mo@example.com", coach: "Gaz", dob: "", sessions: "" });
  assert.strictEqual(app.findMember("r1").challengeSessions, null,
    "cleared, it is null again — not zero, which would be a claim nobody made");

  // and zero really is storable through the form, distinct from clearing it
  app.ctx.openRetEdit("r1");
  saveForm(app, { name: "Mo Member", email: "mo@example.com", coach: "Gaz", dob: "", sessions: "0" });
  assert.strictEqual(app.findMember("r1").challengeSessions, 0, "zero sessions is a thing to record");
}

/* ---------- 5: a member handed over from onboarding arrives with it unanswered ----------
   The handoff copies what the tracker knows. It does not know this, and it must not guess:
   somebody who signed up in week 3 and somebody who did all six weeks look identical to the
   journey data, which is why this is typed in the first place. */
{
  const app = boot({ members: [{
    id: "c1", name: "Sam Doyle", coach: "Dan", email: "sam@example.com",
    day0: daysFromToday(-42), booked: daysFromToday(-42), firstSessionDone: true,
    completed: ["intro", "d1_text", "wk2", "wk3"], doneMeta: {}, checks: {}, missed: [],
    outcome: null, signedUp: false, extraDays: 0, pausedDays: 0, pausedAt: null,
  }] });
  app.ctx.setOutcome("c1", "stayed");
  const m = app.retention()[0];
  assert.strictEqual(m.name, "Sam Doyle", "sanity: they came across");
  assert.ok("challengeSessions" in m, "the field is on them from the moment they arrive");
  assert.strictEqual(m.challengeSessions, null,
    "…unanswered — four ticked touchpoints is not four sessions attended");

  // and a coach can then answer it
  app.ctx.openRetEdit(m.id);
  saveForm(app, { name: "Sam Doyle", email: "sam@example.com", coach: "Dan", dob: "", sessions: "16" });
  assert.strictEqual(app.findMember(m.id).challengeSessions, 16);
}

/* ---------- 6: it goes where every other member field goes ---------- */
(async () => {
  const app = boot({ cloud: { rows: { retention: [member("r1", "Mo Member")], seeded: true } } });
  await app.ctx.bootData();
  app.ctx.openRetEdit("r1");
  saveForm(app, { name: "Mo Member", email: "r1@example.com", coach: "Gaz", dob: "", sessions: "15" });
  await settle();

  const pushed = app.cloud.lastWriteTo("retention");
  assert.ok(pushed, "the edit was pushed");
  assert.strictEqual(pushed.value[0].challengeSessions, 15,
    "…with the number on it — the normal save path, no special case");
  assert.strictEqual(app.retentionCached()[0].challengeSessions, 15, "…and cached for offline");

  // another coach's edit arrives the same way
  app.cloud.emit("retention", [member("r1", "Mo Member", { challengeSessions: 21 })],
    new Date(Date.now() + 60000).toISOString());
  assert.strictEqual(app.findMember("r1").challengeSessions, 21, "…and lands on this screen");

  /* ---------- 7: Stage 1 stores it and stops there ----------
     Nothing reads this number yet. It is not on a card, not in a count, not in an alert — it
     is captured so that the stage that needs it has a year of it to work with. */
  {
    const shown = boot({ retention: [
      member("a", "Ann A", { challengeSessions: 14 }),
      member("b", "Bo B", { challengeSessions: null }),
    ] });
    for (const host of ["retMemberList", "retTodayList", "attList", "birthdayList"]) {
      assert.ok(!/challenge sessions/i.test(shown.html(host)),
        host + " says nothing about challenge sessions yet");
    }
    /* …and the same member renders identically with the number and without it, which is what
       "captured, not used" means: two apps, one member, differing in this field alone. */
    const withNumber = boot({ retention: [member("r1", "Mo Member", { challengeSessions: 14 })] });
    const without = boot({ retention: [member("r1", "Mo Member")] });
    for (const host of ["retMemberList", "retTodayList", "attList"]) {
      assert.strictEqual(withNumber.html(host), without.html(host),
        host + ": the number changes nothing on screen yet");
    }
  }

  console.log("challenge-sessions.test.cjs: OK");
})();
