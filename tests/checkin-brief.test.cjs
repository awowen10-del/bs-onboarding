// Check-in briefs: who gets one, the food maths, the coaches' notes, and the tracker wiring.
const assert = require("assert");
const fs = require("fs"); const path = require("path");
const { onJourney, journeyDay, trainingSessions, foodWeek, checklistLines, mentionsOf, plausible, weekJob, factsFor } = require("../netlify/functions/checkin-brief-background.js")._test;
const HTML = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const D = 86400000, NOW = new Date(2026, 10, 26, 10).getTime(), T0 = new Date(2026, 10, 26).getTime();

// who: clock running (through day 43), free weeks, never left/paused/not started
const m = (o) => Object.assign({ id: "a", name: "Jo Bloggs", firstSessionDone: true, day0: T0 - 10 * D }, o);
assert.ok(onJourney(m({}), NOW));
assert.ok(onJourney(m({ day0: T0 - 43 * D }), NOW));
assert.ok(!onJourney(m({ day0: T0 - 50 * D }), NOW));
assert.ok(onJourney(m({ day0: T0 - 50 * D, extraDays: 7 }), NOW));
assert.ok(!onJourney(m({ left: true }), NOW));
assert.ok(!onJourney(m({ outcome: "left" }), NOW));
assert.ok(!onJourney(m({ pausedAt: T0 - D }), NOW));
assert.ok(!onJourney(m({ firstSessionDone: false }), NOW));
assert.ok(onJourney(m({ sixStart: T0 + 30 * D }), NOW));                 // free weeks
assert.deepEqual(journeyDay(m({ sixStart: T0 + 30 * D }), NOW), { free: true, day: 10 });
assert.deepEqual(journeyDay(m({ pausedDays: 3 }), NOW), { free: false, day: 7 });

// sessions: training only, oldest first
const ss = trainingSessions([
  { event: { starts_at: "2026-11-24T18:00:00Z", offering_type: { name: "BodySculpt PT" } } },
  { event: { starts_at: "2026-11-20T18:00:00Z", offering_type: { name: "Intro Session" } } },
  { event: { starts_at: "2026-11-21T09:00:00Z", offering_type: { name: "BUILD" } } },
]);
assert.deepEqual(ss.map((s) => s.type), ["BUILD", "BodySculpt PT"]);

// food: half-logged days don't flatter the average
const f = foodWeek([{ calories: 1700, proteinGrams: 150 }, { calories: 2300, proteinGrams: 100 }, { calories: 56 }, { calories: 0 }],
  { caloricGoal: 1800, proteinGrams: 150, nutritionDeviation: 20 });
assert.equal(f.daysLogged, 3); assert.equal(f.fullDays, 2); assert.equal(f.partDays, 1);
assert.equal(f.avgCal, 2000); assert.equal(f.onCalDays, 1); assert.equal(f.overCalDays, 1); assert.equal(f.proHitDays, 1);
assert.equal(foodWeek([], null).daysLogged, 0);

// Slack: checklist lines, the person's mentions, another Emma left out
const posts = [{ ts: String(Date.parse("2026-11-24T21:00:00Z") / 1000), text: "Post-Shift Checklist\n*Gaz*  •  Tue\n> :white_check_mark:  *Any new trialists on their first week?*  Yes\n> &gt; Emma - 30kg squat, good form\n> &gt; Emma G was off sick\n> :x:  *Anyone at risk?*  Yes\n> &gt; Emma - might leave" },
  { ts: "1", text: "just chat about Emma" }];
const lines = checklistLines(posts);
assert.equal(lines[0].coach, "Gaz");
const em = mentionsOf(lines, "Emma", "Dalby");
assert.deepEqual(em.map((x) => x.text), ["Emma - 30kg squat, good form"]);
// only the 6 Week Challenge part is read: the members section (where another Emma lives) is not
const real = checklistLines([{ ts: String(Date.parse("2026-11-24T11:36:00Z") / 1000), text: [
  ":white_check_mark: Post-Shift Checklist", "*Gaz*  •  Tue 24 Nov, 11:36, Monday - Late",
  ":white_check_mark:  *Everyone ticked off their session*", ":x:  *Anyone at risk?*  No",
  ":white_check_mark:  _Anything the late team needs updating on?_  Yes", "&gt; Emma asked about pausing",
  ":white_check_mark:  *Any new trialists on their first week?*  Yes", "&gt; Paul - sit to stand, body weight",
  ":white_check_mark:  *Any 6 Week Challenge updates?*  Yes", "&gt; Charlotte - 40kg squat, week 3",
  ":white_check_mark:  *Any post-session updates on members?*  Yes", "&gt; Emma - 30kg squat", "&gt; Charlotte - back in after holiday",
  ":white_check_mark:  *Hoovered, gym reset*"].join("\n") }]);
assert.deepEqual(real.map((x) => x.text), ["Paul - sit to stand, body weight", "Charlotte - 40kg squat, week 3"]);
assert.equal(mentionsOf(real, "Emma", "Dalby").length, 0);
assert.equal(real[0].coach, "Gaz");
// a line about someone else that only mentions them is not theirs; a note TO a coach about them is
const L2 = (t) => ({ day: "2026-11-19", coach: "Gaz", text: t });
assert.deepEqual(mentionsOf([L2("Niambh - done well and chatted with Charlotte."), L2("Ash - Charlotte asked about membership"), L2("Sarah, Clare & Charlotte - week 3"), L2("Charlotte - 40kg squat")], "Charlotte", "Halliday").map((x) => x.text),
  ["Ash - Charlotte asked about membership", "Sarah, Clare & Charlotte - week 3", "Charlotte - 40kg squat"]);
// a first-name note is kept only if they trained that day or the day before
assert.equal(plausible(em, ["2026-11-24"]).length, 1);
assert.equal(plausible(em, ["2026-11-23"]).length, 1);
assert.equal(plausible(em, ["2026-11-20"]).length, 0);
assert.equal(plausible(em, null)[0].check, true);
assert.equal(plausible([{ ...em[0], full: true }], []).length, 1);

// what Claude is told: no week numbers, week 3 leaves the voice note's ending to the coach
const facts = factsFor(m({}), { free: false, day: 10 }, { found: true, lastWeek: 2, total: 4, booked: 0, last: "2026-11-24T18:00:00Z" },
  { found: false }, []);
assert.ok(!/week \d/i.test(facts.where));
assert.ok(/set line/.test(weekJob({ free: false, day: 15 })));
assert.ok(/where next/.test(weekJob({ free: false, day: 36 })));

// tracker: loads the row, shows it on check-in cards only, keeps cards open
assert.ok(HTML.includes("const CB_ROW_KEY = 'checkin-briefs';"));
assert.ok(HTML.includes("CU_BLOCK_KEY, CB_ROW_KEY]);"));
assert.ok(HTML.includes("filter:'key=eq.'+CB_ROW_KEY"));
assert.ok(HTML.includes("function isCheckinItem(item){ return !!item && (/^wk\\d$/.test(item.id) || item.free===true); }"));
assert.ok(HTML.includes("${ci ? cbDetailHtml(m, item) : ''}"));
assert.ok(HTML.includes("cbOpen.has(m.id+'-'+item.id)"));
// scheduled every morning after the attendance sync
assert.ok(/\[functions\."checkin-brief-daily"\]\s+schedule = "50 6 \* \* \*"/.test(fs.readFileSync(path.join(__dirname, "..", "netlify.toml"), "utf8")));
console.log("checkin-brief: OK");
