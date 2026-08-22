// Onboarding → Retention handoff harness.
//
// Marking a challenger "Stayed on" makes them a member on the other tracker. The two things
// that have to hold are that everything about them travels — details, date of birth, and the
// shared notes a coach has been keeping — and that it can only ever happen ONCE. setOutcome
// runs on every tap of that button, including taps that undo and redo the decision, so the
// link on the member (fromChallenger) is the only thing standing between a converted
// challenger and a duplicate member. Half of this file is that.
//
// The other invariant: the challenger is copied, never moved. They stay on the roster, still
// counted by the conversion bar, and undoing the decision does not take the member away —
// they joined the gym; an outcome toggle on the other tracker cannot un-join them.
const assert = require("assert");
const { boot, daysFromToday } = require("./lib/env.cjs");

const TODAY = daysFromToday(0);

function challenger(id, name, extra) {
  return Object.assign({
    id, name, coach: "Dan", dob: null,
    day0: daysFromToday(-40), booked: daysFromToday(-40), firstSessionDone: true,
    completed: [], doneMeta: {}, checks: {}, missed: [], outcome: null, signedUp: false,
    extraDays: 0, pausedDays: 0, pausedAt: null, notes: "", personal: "",
  }, extra || {});
}
const SAM = () => challenger("sam", "Sam Doyle", {
  coach: "Grace", dob: "1990-04-23", email: "sam@example.com",
  personal: "wedding in June", notes: "<h3>Injuries</h3><div>Left <b>knee</b> — no jumping.</div>",
});

/* ---------- 1: staying on makes them a member, with everything they had ---------- */
{
  const app = boot({ members: [SAM()] });
  assert.strictEqual(app.retention().length, 0, "nobody on the retention tracker yet");

  app.ctx.setOutcome("sam", "stayed");

  assert.strictEqual(app.retention().length, 1, "exactly one member was created");
  const m = app.retention()[0];
  assert.strictEqual(m.name, "Sam Doyle");
  assert.strictEqual(m.email, "sam@example.com");
  assert.strictEqual(m.coach, "Grace");
  assert.strictEqual(m.dob, "1990-04-23");
  assert.strictEqual(m.personal, "wedding in June");
  assert.ok(m.notes.includes("knee"), "the shared notes travelled with them");
  assert.strictEqual(m.notes, app.find("sam").notes, "…exactly as the coach wrote them");
  assert.strictEqual(m.fromChallenger, "sam", "linked back to the challenger they came from");
  assert.strictEqual(m.joined, TODAY, "joined today — the anchor for day-30, day-60, anniversaries");
  assert.ok(m.id && m.id !== "sam", "and a member id of their own");

  // it went through the member list's own sync path, not the roster's
  assert.strictEqual(app.retentionCached().length, 1);
  assert.strictEqual(app.retentionCached()[0].fromChallenger, "sam");

  // they are on both retention surfaces
  assert.ok(app.html("retMemberList").includes("Sam Doyle"), "on the Members tab");
  assert.ok(app.html("retMemberList").includes("Member since"), "…with the day they joined");
  assert.ok(app.html("retBirthdayList").includes("Sam Doyle"), "and on the Birthdays tab");
  assert.ok(app.html("retBirthdayList").includes(">23rd<"), "…on the right day");
  assert.strictEqual(app.el("retCount").textContent, "1", "and counted on the tab");
}

/* ---------- 2: the challenger stays put, and the onboarding numbers do not move ---------- */
{
  // the same roster, converted vs. not, so the onboarding surfaces can be compared directly
  const before = boot({ members: [SAM(), challenger("lee", "Lee Left", { outcome: "left" })] });
  const beforeConv = before.html("convBar");

  const app = boot({ members: [SAM(), challenger("lee", "Lee Left", { outcome: "left" })] });
  app.ctx.setOutcome("sam", "stayed");

  // still a challenger, in the roster, exactly as the Stayed on button always left them
  const sam = app.find("sam");
  assert.ok(sam, "the challenger was copied, not moved");
  assert.strictEqual(app.members().length, 2, "the roster is the same size");
  assert.strictEqual(sam.outcome, "stayed");
  assert.strictEqual(sam.signedUp, true, "…which still unlocks the welcome card and month follow-ups");
  assert.strictEqual(sam.day0, SAM().day0, "their clock is untouched");
  assert.strictEqual(sam.notes, SAM().notes, "…and so are their notes");
  // they are on the Stayed On tab now rather than Currently Active — converting is what
  // moves them there, and it is the same card either way
  app.ctx.setMemberFilter("stayed");
  assert.ok(app.html("memberList").includes("Sam Doyle"), "they still render on a challenger card");
  assert.ok(app.html("memberList").includes("Stayed ✓"), "…still marked as stayed");
  // Currently Active is the masthead's on-the-journey rule now, and that rule does not care
  // about a decision having been recorded — only about the clock. Sam converted with days
  // still to run, so he is on both tabs until his 42 days are up.
  app.ctx.setMemberFilter("active");
  assert.ok(app.html("memberList").includes("Sam Doyle"),
    "…and their clock is still running, so they are still on Currently Active too");

  // the conversion bar reads exactly what it would have without a retention tracker at all
  before.ctx.setOutcome("sam", "stayed");
  before.ctx.__t.retention = [];                 // strip the member, leave the roster alone
  before.ctx.renderAll();
  assert.strictEqual(app.html("convBar"), before.html("convBar"),
    "the conversion figure is blind to the retention tracker");
  assert.ok(app.html("convBar").includes("50%"), "sanity: one stayed, one left");
  assert.notStrictEqual(app.html("convBar"), beforeConv, "sanity: converting did move the figure");

  // and the roster blob that syncs carries no trace of the handoff
  assert.deepStrictEqual(Object.keys(app.cached()[0]).filter((k) => /^(fromChallenger|joined)$/.test(k)), [],
    "nothing was bolted onto the challenger record");
}

/* ---------- 3: idempotent — however many times the button is tapped ---------- */
{
  const app = boot({ members: [SAM()] });

  app.ctx.setOutcome("sam", "stayed");
  const first = app.retention()[0].id;
  app.ctx.setOutcome("sam", "stayed");
  app.ctx.setOutcome("sam", "stayed");
  assert.strictEqual(app.retention().length, 1, "tapping Stayed on again creates nobody new");
  assert.strictEqual(app.retention()[0].id, first, "…it is the same member record");

  // re-rendering, re-saving and reloading never duplicate them either
  app.ctx.renderAll();
  app.ctx.renderMembers();
  app.ctx.save();
  app.ctx.saveRetention();
  assert.strictEqual(app.retention().length, 1, "rendering and saving are not the trigger");

  // a returning device — the member list comes back through migration untouched
  const reloaded = boot({ members: app.cached(), retention: app.retentionCached() });
  assert.strictEqual(reloaded.retention().length, 1, "reloading does not re-run the handoff");
  assert.strictEqual(reloaded.retention()[0].fromChallenger, "sam", "…and the link survives");
  assert.strictEqual(reloaded.retention()[0].joined, TODAY);
  reloaded.ctx.setOutcome("sam", "stayed");
  assert.strictEqual(reloaded.retention().length, 1,
    "…so a fresh device pressing Stayed on again still makes no second copy");
}

/* ---------- 4: undoing the decision leaves the member alone ---------- */
{
  for (const undo of [null, "left"]) {
    const app = boot({ members: [SAM()] });
    app.ctx.setOutcome("sam", "stayed");
    const memberId = app.retention()[0].id;

    app.ctx.setOutcome("sam", undo);
    assert.strictEqual(app.retention().length, 1,
      "setOutcome(" + JSON.stringify(undo) + ") must not delete the member — they joined the gym");
    assert.strictEqual(app.retention()[0].id, memberId, "…the same one, untouched");
    assert.strictEqual(app.find("sam").outcome, undo, "…while the challenger takes the new outcome");
    assert.strictEqual(app.find("sam").signedUp, false);

    // and setting it back does not make a second one
    app.ctx.setOutcome("sam", "stayed");
    assert.strictEqual(app.retention().length, 1, "redeciding creates nobody new");
    assert.strictEqual(app.retention()[0].id, memberId);

    // …round and round, without throwing
    for (const o of ["stayed", null, "left", "stayed", "stayed", null]) app.ctx.setOutcome("sam", o);
    assert.strictEqual(app.retention().length, 1, "still exactly one after a dozen taps");
  }
}

/* ---------- 5: the challenger card says they have moved across ---------- */
{
  const app = boot({ members: [SAM()] });
  assert.ok(!app.html("memberList").includes("→ Member"), "no badge before they convert");

  app.ctx.setOutcome("sam", "stayed");
  app.ctx.setMemberFilter("stayed");             // follow them to the tab converting moved them to
  assert.ok(app.html("memberList").includes("→ Member"), "the badge appears on their card");
  assert.ok(app.html("memberList").includes("Stayed ✓"), "…alongside the outcome tag, not instead of it");

  // it tracks the member, not the outcome: undoing the decision leaves both in place. Undoing
  // it puts them back among the open cases, so the tab follows them back too.
  app.ctx.setOutcome("sam", null);
  app.ctx.setMemberFilter("active");
  assert.ok(app.html("memberList").includes("→ Member"),
    "they are still a member, so the badge stays");

  // …and it is gone if the member is removed from the retention tracker
  app.ctx.removeRetMember(app.retention()[0].id);
  assert.strictEqual(app.retention().length, 0);
  assert.ok(!app.html("memberList").includes("→ Member"), "badge goes with them");

  // a challenger who never converted never shows it
  const plain = boot({ members: [challenger("nel", "Nel Never")] });
  plain.ctx.setOutcome("nel", "left");
  assert.ok(!plain.html("memberList").includes("→ Member"));
  assert.strictEqual(plain.retention().length, 0, "leaving creates no member");
}

/* ---------- 6: the two records are independent once they part ---------- */
{
  const app = boot({ members: [SAM()] });
  app.ctx.setOutcome("sam", "stayed");
  const memberId = app.retention()[0].id;

  // notes are copied AT the handoff; keeping them in step afterwards is a later stage
  app.ctx.openNotes("sam");
  app.el("notesEd").innerHTML = "<div>Written after they converted.</div>";
  app.ctx.notesFlush();
  app.ctx.closeNotes();
  assert.ok(app.find("sam").notes.includes("after they converted"));
  assert.ok(!app.findMember(memberId).notes.includes("after they converted"),
    "the member keeps the copy taken at the handoff");
  assert.ok(app.findMember(memberId).notes.includes("knee"), "…which is the history they had");
  assert.strictEqual(app.cached()[0].notes, app.find("sam").notes, "roster note went to the roster row");
  assert.ok(!app.retentionCached()[0].notes.includes("after they converted"),
    "…and not into the member row");

  // editing the member does not reach back into the challenger
  app.ctx.openRetEdit(memberId);
  app.el("rf-coach").value = "Ash";
  app.ctx.saveRetMember();
  assert.strictEqual(app.findMember(memberId).coach, "Ash");
  assert.strictEqual(app.find("sam").coach, "Grace", "the challenger's coach is unchanged");

  // removing the challenger from onboarding does not un-member them
  app.ctx.removeMember("sam");
  assert.strictEqual(app.members().length, 0);
  assert.strictEqual(app.retention().length, 1, "they are a member in their own right now");
  app.ctx.renderAll();
  assert.ok(app.html("retMemberList").includes("Sam Doyle"), "…and still render");
}

/* ---------- 7: the thin edges ---------- */
{
  // a challenger with nothing filled in still converts cleanly
  const bare = boot({ members: [challenger("b", "Bo Bare")] });
  bare.ctx.setOutcome("b", "stayed");
  const m = bare.retention()[0];
  assert.strictEqual(m.email, "", "no email is an empty string, never undefined");
  assert.strictEqual(m.notes, "");
  assert.strictEqual(m.personal, "");
  assert.strictEqual(m.dob, null);
  assert.strictEqual(m.coach, "Dan");
  for (const k of ["id", "name", "email", "coach", "personal", "notes", "dob", "joined",
                   "fromChallenger", "left"]) {
    assert.notStrictEqual(m[k], undefined, k + " is never undefined on a handed-over member");
  }
  assert.ok(bare.html("retBirthdayList").includes("No birthdays on file yet"),
    "no dob means no birthday, not a broken tab");

  // migration leaves a handed-over member exactly as it found them
  const once = bare.ctx.migrateRetentionList(JSON.parse(JSON.stringify(bare.retention())));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(once)), JSON.parse(JSON.stringify(bare.retention())),
    "a handed-over member survives migration untouched");

  // two challengers convert to two distinct members
  const two = boot({ members: [challenger("a", "Ann A"), challenger("z", "Zed Z")] });
  two.ctx.setOutcome("a", "stayed");
  two.ctx.setOutcome("z", "stayed");
  assert.strictEqual(two.retention().length, 2);
  assert.deepStrictEqual(two.retention().map((x) => x.fromChallenger).sort(), ["a", "z"]);
  assert.notStrictEqual(two.retention()[0].id, two.retention()[1].id, "distinct member ids");

  // a member added by hand carries no link, and never blocks a real handoff
  const hand = boot({ members: [SAM()] });
  hand.ctx.openRetAdd();
  hand.el("rf-name").value = "Sam Doyle";          // same name, no link
  hand.ctx.saveRetMember();
  assert.strictEqual(hand.retention()[0].fromChallenger, null);
  hand.ctx.setOutcome("sam", "stayed");
  assert.strictEqual(hand.retention().length, 2,
    "matching by link, not by name — the hand-added one is a different person as far as this knows");
  assert.strictEqual(hand.retention().filter((x) => x.fromChallenger === "sam").length, 1);
}

console.log("handoff.test.cjs: OK");
