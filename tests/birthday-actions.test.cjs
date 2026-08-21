// The Birthdays tab's three housekeeping features: Ignore, milestones, and Actioned.
//
// Two of the three are about a DATE that moves, so the fixtures here are all built relative
// to today rather than written out. A test that says "1976-08-28 is a 50th" is a test that
// stops being true in January, and a suite that only holds in August is worse than no suite:
// it passes for eleven months by not being run and then fails for a reason nobody remembers.
//
// The third — Actioned — is the one with a real trapdoor in it. It has to expire on its own
// when next year's birthday comes round, and the only way to be sure of that is to check the
// stored year against the year of the birthday now being asked about, so that is what is
// asserted: not "it resets", but "a stored year that is not this birthday's does nothing".
const assert = require("assert");
const { boot, daysFromToday } = require("./lib/env.cjs");

const NOW = new Date();
const CUR_Y = NOW.getFullYear();
const CUR_M = NOW.getMonth() + 1;
const CUR_D = NOW.getDate();
const DAYS_IN_CUR_M = new Date(CUR_Y, CUR_M, 0).getDate();
const NEXT_M = (CUR_M % 12) + 1;

// The tab carries two demo cards at the top — a prop for showing the team, covered by
// birthday-examples.test.cjs. They are not data, and they would otherwise sit in front of
// every assertion in this file (their block has its own gcount, its own bday-acts), so every
// boot here starts with them already cleared away.
const NO_EXAMPLES = JSON.stringify({ dismissed: ["eg-soon", "eg-milestone"], actioned: [] });
const bootTab = (opts) => boot(Object.assign({ stored: { bsj_bday_examples: NO_EXAMPLES } }, opts || {}));

const person = (id, name, dob, extra) => Object.assign({
  id, name, coach: "Dan", dob, personal: "",
  day0: daysFromToday(-8), booked: daysFromToday(-8), firstSessionDone: true,
  completed: ["intro"], doneMeta: {}, checks: {}, missed: [],
  outcome: null, signedUp: false, extraDays: 0, pausedDays: 0, pausedAt: null,
  followUpOn: null, followUpStatus: null, notes: "",
}, extra || {});

// a date of birth that makes somebody turn exactly `age` on their NEXT birthday, on a day of
// this month that has not been yet (so "next" is this year and the row is in the lead group).
// Capped at the 28th in February: on 28 February of a LEAP year the day after is the 29th,
// and "YYYY-02-29" is not a date in most birth years — dobParts would reject the fixture and
// the whole file would fail one day in four, for a reason that has nothing to do with it.
const LATER_D = CUR_M === 2 ? Math.min(CUR_D + 1, 28) : Math.min(CUR_D + 1, DAYS_IN_CUR_M);
// the birth year is worked back from the year their next birthday actually falls in, not
// assumed to be this one — on 29 February the capped day above is behind us, so it is next
// year's birthday and a birth year of CUR_Y - age would make them turn age + 1
const turning = (age) => ((LATER_D < CUR_D ? CUR_Y + 1 : CUR_Y) - age)
  + "-" + String(CUR_M).padStart(2, "0") + "-" + String(LATER_D).padStart(2, "0");
// …and one whose birthday is next month, for the same age
const turningNextMonth = (age) => {
  const y = NEXT_M === 1 ? CUR_Y - age + 1 : CUR_Y - age;   // December wraps into next year
  return y + "-" + String(NEXT_M).padStart(2, "0") + "-01";
};

// the rendered row for one person, classes and all
const rowFor = (app, name) => {
  const parts = app.html("birthdayList").split('<div class="bday-row');
  return parts.find((r) => r.includes(">" + name + "<") || r.includes(name)) || "";
};
const classesOf = (row) => (/^([^>]*)>/.exec(row) || [, ""])[1].replace(/"/g, "").trim();
const onTab = (app, name) => app.html("birthdayList").includes(name);

/* ---------- 1: the two fields default correctly, and migration is idempotent ---------- */
{
  const app = bootTab({ members: [
    { id: "old", name: "Jo Ancient", coach: "Dan", day0: daysFromToday(-30), firstSessionDone: true },
  ] });
  const jo = app.find("old");
  assert.strictEqual(jo.birthdayIgnored, false, "nobody is ignored by default");
  assert.strictEqual(jo.birthdayActionedYear, null, "and nothing is actioned by default");

  // a record that already carries them is left exactly as it is
  const set = app.ctx.migrateList([{ id: "z", name: "Zed", coach: "Ash", dob: turning(30),
    birthdayIgnored: true, birthdayActionedYear: 2019 }]);
  const twice = app.ctx.migrateList(JSON.parse(JSON.stringify(set)));
  assert.strictEqual(twice[0].birthdayIgnored, true, "an existing ignore survives migration");
  assert.strictEqual(twice[0].birthdayActionedYear, 2019, "…and so does an existing actioned year");

  // and a legacy roster with neither field still renders the tab
  assert.ok(app.html("birthdayList").includes("No birthdays on file yet"), "the tab still renders");
}

/* ---------- 2: which birthday a card is about ----------
   Everything else reads this, so it is pinned on its own. The day itself is DUE, not gone —
   that is the day you are supposed to be doing something. */
{
  const app = bootTab({ members: [] });
  const nb = (dob) => app.ctx.nextBirthday({ dob });

  assert.strictEqual(nb(null), null, "no dob, no birthday to talk about");
  assert.strictEqual(nb("not-a-date"), null, "…nor a malformed one");

  // today's own birthday is this year's, and they are turning the age today makes them
  const today = String(CUR_Y - 40) + "-" + String(CUR_M).padStart(2, "0")
    + "-" + String(CUR_D).padStart(2, "0");
  assert.strictEqual(nb(today).year, CUR_Y, "today's birthday is still this year's");
  assert.strictEqual(nb(today).age, 40, "…and it is the one they turn today");

  // one that has already been rolls to next year, and the age with it
  if (CUR_D > 1) {
    const gone = String(CUR_Y - 40) + "-" + String(CUR_M).padStart(2, "0") + "-01";
    assert.strictEqual(nb(gone).year, CUR_Y + 1, "a birthday that has been is next year's");
    assert.strictEqual(nb(gone).age, 41, "…and they will be a year older on it");
  }
  // one later this month is this year's
  if (CUR_D < DAYS_IN_CUR_M) {
    assert.strictEqual(nb(turning(30)).year, CUR_Y, "later this month is this year's");
    assert.strictEqual(nb(turning(30)).age, 30);
  }
}

/* ---------- 3: milestone detection, on the exact ages and no others ---------- */
{
  const app = bootTab({ members: [] });
  const MILESTONES = [18, 21, 30, 40, 50, 60, 65, 70, 80];
  assert.deepStrictEqual([...app.ctx.__t.BIRTHDAY_MILESTONES], MILESTONES,
    "the list is the one that was asked for");

  for (const age of MILESTONES) {
    assert.strictEqual(app.ctx.birthdayMilestone({ dob: turning(age) }), age,
      "turning " + age + " is a milestone");
    // …and it is the UPCOMING age that counts, wherever in the year the birthday falls
    assert.strictEqual(app.ctx.birthdayMilestone({ dob: turningNextMonth(age) }), age,
      "turning " + age + " next month is one too");
  }

  // every age from 1 to 90 that is NOT on the list must come back null — the neighbours of a
  // milestone are the ones that would slip through an off-by-one
  for (let age = 1; age <= 90; age++) {
    if (MILESTONES.indexOf(age) !== -1) continue;
    assert.strictEqual(app.ctx.birthdayMilestone({ dob: turning(age) }), null,
      "turning " + age + " is not a milestone");
  }
  assert.strictEqual(app.ctx.birthdayMilestone({ dob: null }), null, "no dob, no milestone");
}

/* ---------- 4: the milestone is visible on the card, and only on that card ---------- */
{
  const app = bootTab({ members: [
    person("m", "Meg Milestone", turning(50)),
    person("o", "Ollie Ordinary", turning(51)),
  ] });
  const meg = rowFor(app, "Meg Milestone");
  assert.ok(/🎉 Turning 50/.test(meg), "the card says which milestone, not just that it is one");
  assert.ok(/\bmilestone\b/.test(classesOf(meg)), "…and the row is marked for the accent");

  const ollie = rowFor(app, "Ollie Ordinary");
  assert.ok(!/🎉/.test(ollie), "51 is an ordinary birthday and looks like one");
  assert.ok(!/\bmilestone\b/.test(classesOf(ollie)), "…with no accent on the row");

  // the rest of the card is untouched by any of this
  assert.ok(/bday-day/.test(meg), "the ordinal stays");
  assert.ok(/notes-btn/.test(meg), "…and the notes icon");
  assert.ok(/bday-meta">on the journey<\/div>/.test(meg),
    "…and the meta line, which is the status ALONE now — no coach in front of it");
  assert.ok(!/Coach/.test(meg), "the coach's name is off the card entirely");
}

/* ---------- 5: Ignore hides them from the groups AND the counts, and is reversible ------- */
{
  const app = bootTab({ members: [
    person("k", "Kim Keep", turning(30)),
    person("i", "Ivy Ignore", turning(31)),
  ] });
  const monthCount = () => Number(/<span class="gcount">(\d+)<\/span>/.exec(app.html("birthdayList"))[1]);
  assert.strictEqual(monthCount(), 2, "both are in this month's group to begin with");

  app.ctx.setBirthdayIgnored("i", true);
  assert.strictEqual(app.find("i").birthdayIgnored, true, "the flag is on the challenger");
  assert.ok(!onTab(app, "Ivy Ignore"), "she is off the tab");
  assert.ok(onTab(app, "Kim Keep"), "…and nobody else moved");
  assert.strictEqual(monthCount(), 1, "the month count drops with her — not hidden in place");

  // the way back: a count and a toggle at the bottom
  const note = /<div class="bday-ignored-note">([\s\S]*?)<\/div>/.exec(app.html("birthdayList"));
  assert.ok(note, "there is an ignored line at the bottom");
  assert.ok(/1 ignored/.test(note[1]), "…saying how many");
  assert.ok(/toggleIgnoredBirthdays\(\)/.test(note[1]) && />show</.test(note[1]), "…and offering to show them");

  app.ctx.toggleIgnoredBirthdays();
  assert.ok(onTab(app, "Ivy Ignore"), "showing brings her back into view");
  assert.ok(/\bignored\b/.test(classesOf(rowFor(app, "Ivy Ignore"))), "…marked as ignored");
  assert.ok(/>hide</.test(app.html("birthdayList")), "…and the toggle offers to hide again");
  assert.ok(/Un-ignore/.test(rowFor(app, "Ivy Ignore")), "her row offers the undo");
  assert.ok(!/Actioned/.test(rowFor(app, "Ivy Ignore")),
    "…and not Actioned — there is nothing to handle for somebody off the tab");

  // undoing puts her back for good
  app.ctx.setBirthdayIgnored("i", false);
  app.ctx.toggleIgnoredBirthdays();                 // back to the default view
  assert.ok(onTab(app, "Ivy Ignore"), "un-ignoring returns her to the ordinary list");
  assert.strictEqual(monthCount(), 2, "…and to the count");
  assert.ok(!/bday-ignored-note/.test(app.html("birthdayList")),
    "with nobody ignored there is no line at the bottom to explain");
}

/* ---------- 6: ignoring also stops them nudging the tab's dot ---------- */
{
  const app = bootTab({ members: [person("i", "Ivy Ignore", turning(31))] });
  assert.strictEqual(app.el("bdayDot").classList.contains("on"), true, "her birthday lights the dot");
  app.ctx.setBirthdayIgnored("i", true);
  assert.strictEqual(app.el("bdayDot").classList.contains("on"), false,
    "ignored means ignored — she cannot nudge from a tab she is not on");
}

/* ---------- 7: Actioned parks THIS year's birthday and stays on the tab ---------- */
{
  const app = bootTab({ members: [person("a", "Ann Actioned", turning(30))] });
  assert.strictEqual(app.ctx.birthdayActioned(app.find("a")), false, "nothing starts actioned");
  assert.ok(!/\bactioned\b/.test(classesOf(rowFor(app, "Ann Actioned"))));

  app.ctx.toggleBirthdayActioned("a");
  assert.strictEqual(app.find("a").birthdayActionedYear, CUR_Y, "the YEAR is stored, not a flag");
  assert.strictEqual(app.ctx.birthdayActioned(app.find("a")), true);

  // still listed — that is the difference between Actioned and Ignore
  assert.ok(onTab(app, "Ann Actioned"), "an actioned person is still on the tab");
  const row = rowFor(app, "Ann Actioned");
  assert.ok(/\bactioned\b/.test(classesOf(row)), "…in a visibly handled state");
  assert.ok(/✓ Actioned/.test(row), "…with a tick on the button");
  assert.ok(/aria-pressed="true"/.test(row), "…and the button reads as pressed");

  // and it is reversible from the same button
  app.ctx.toggleBirthdayActioned("a");
  assert.strictEqual(app.find("a").birthdayActionedYear, null, "tapping again unparks it");
  assert.strictEqual(app.ctx.birthdayActioned(app.find("a")), false);
  assert.ok(!/✓ Actioned/.test(rowFor(app, "Ann Actioned")));
}

/* ---------- 8: it expires by itself when the next birthday comes round ----------
   The trapdoor. "Actioned" is not a boolean that somebody has to clear in January — it is a
   year, and it counts only against the birthday it was stored for. These are the three
   readings that matter, and the middle one is the whole feature. */
{
  const app = bootTab({ members: [person("a", "Ann Actioned", turning(30))] });
  const ann = app.find("a");

  ann.birthdayActionedYear = CUR_Y;
  assert.strictEqual(app.ctx.birthdayActioned(ann), true, "this year's birthday, handled this year");

  ann.birthdayActionedYear = CUR_Y - 1;
  assert.strictEqual(app.ctx.birthdayActioned(ann), false,
    "LAST year's handling does nothing for this year's birthday — it comes round again");

  ann.birthdayActionedYear = CUR_Y + 1;
  assert.strictEqual(app.ctx.birthdayActioned(ann), false,
    "…and a year that is not this birthday's does not count either, whichever side it is on");

  // the same challenger, seen from a birthday that has already been this year: the card is now
  // about NEXT year's, so this year's tick no longer applies to it
  if (CUR_D > 1) {
    const past = person("p", "Pete Past", String(CUR_Y - 30) + "-"
      + String(CUR_M).padStart(2, "0") + "-01", { birthdayActionedYear: CUR_Y });
    const b = bootTab({ members: [past] });
    assert.strictEqual(b.ctx.nextBirthday(b.find("p")).year, CUR_Y + 1, "their next one is next year");
    assert.strictEqual(b.ctx.birthdayActioned(b.find("p")), false,
      "…so this year's tick has already lapsed, with nothing having to reset it");
  }

  // somebody with no dob cannot be actioned at all, and asking does not throw
  const none = bootTab({ members: [person("n", "Nell None", null)] });
  none.ctx.toggleBirthdayActioned("n");
  assert.strictEqual(none.find("n").birthdayActionedYear, null, "no dob, nothing to action");
  assert.strictEqual(none.ctx.birthdayActioned(none.find("n")), false);
}

/* ---------- 9: the two states are independent, and both survive a save ---------- */
{
  const app = bootTab({ members: [person("x", "Xan Both", turning(40))] });
  app.ctx.toggleBirthdayActioned("x");
  app.ctx.setBirthdayIgnored("x", true);
  app.ctx.toggleIgnoredBirthdays();

  const row = rowFor(app, "Xan Both");
  const cls = classesOf(row);
  assert.ok(/\bmilestone\b/.test(cls) && /\bactioned\b/.test(cls) && /\bignored\b/.test(cls),
    "a milestone that is actioned and ignored carries all three, not the last one written");

  // both fields are in the blob that syncs, so another coach's device sees them
  const cached = app.cached().find((m) => m.id === "x");
  assert.strictEqual(cached.birthdayIgnored, true, "the ignore is persisted");
  assert.strictEqual(cached.birthdayActionedYear, CUR_Y, "…and so is the actioned year");
}

/* ---------- 10: the retention tab is untouched ----------
   birthdaysHtml is shared, and every one of these features is passed into it as an optional
   hook. The members tab now passes the same ones — see birthday-members.test.cjs for what it
   does with them — so what this block holds is the two things that stayed DIFFERENT. */
{
  const app = bootTab({
    members: [person("c", "Cal Challenger", turning(50))],
    retention: [{ id: "r1", name: "Mo Member", coach: "Dan", dob: turning(50),
      email: "", personal: "", notes: "", joined: daysFromToday(-90) }],
  });
  const ret = app.html("retBirthdayList");
  assert.ok(ret.includes("Mo Member"), "the member is on their own tab");
  assert.ok(/bday-acts/.test(ret), "with the same Ignore and Actioned buttons a challenger has");
  assert.ok(/🎉 Turning 50/.test(ret), "…and the same milestone badge");

  // …and the tab is MERGED, so the challenger is on it too, told apart by the tag
  assert.ok(ret.includes("Cal Challenger"), "the challenger is on the same tab");
  const moRow = ret.split('<div class="bday-row').find((r) => r.includes("Mo Member")) || "";
  const calRow = ret.split('<div class="bday-row').find((r) => r.includes("Cal Challenger")) || "";
  assert.ok(/bday-type member">Full member</.test(moRow), "the member is tagged as one");
  assert.ok(/bday-type challenge">6-week challenge</.test(calRow), "…and the challenger as one");

  // a member's line is their coach — there is no 42-day clock to report on — and only a
  // challenger's carries a journey status
  assert.ok(/<div class="bday-meta">Coach Dan<\/div>/.test(moRow), "a member's line is their coach");
  assert.ok(!/on the journey|not started yet|finished the 6 weeks/.test(moRow),
    "…and carries no challenger-only status");
  assert.ok(/<div class="bday-meta">on the journey<\/div>/.test(calRow), "the challenger's is their status");

  // the challenger tab beside it is unchanged by any of the mirroring
  assert.ok(/bday-acts/.test(app.html("birthdayList")) && /🎉 Turning 50/.test(app.html("birthdayList")),
    "sanity: the onboarding tab still has them");

  // …and the demo props are two made-up CHALLENGERS, so the toggle that reveals them must do
  // nothing at all on the member side. Booted without this file's usual dismissal, so the
  // toggle has something to reveal and "nothing happened" means something.
  const demo = boot({ retention: [{ id: "r1", name: "Mo Member", coach: "Dan", dob: turning(50),
    email: "", personal: "", notes: "", joined: daysFromToday(-90) }] });
  demo.ctx.toggleBirthdayExamples();
  // the Birthdays tab is merged, so all three props appear on it from either side. On the two
  // Today's moves they split the way real people do — see birthday-examples for that.
  assert.ok(/Example/.test(demo.html("birthdayList")), "sanity: the toggle did reveal them");
  assert.ok(/Example/.test(demo.html("retBirthdayList")), "…on the same merged tab from either side");
  assert.ok(!/Jo Example|Pat Example/.test(demo.html("retTodayList")),
    "the CHALLENGER props never reach the member Today's moves");
  assert.ok(!/Example/.test(demo.html("retMemberList")), "…and no prop reaches the member list");
}

console.log("birthday-actions.test.cjs: OK");
