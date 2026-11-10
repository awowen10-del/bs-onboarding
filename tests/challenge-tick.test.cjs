// challenge-tick: what is due is worked out from the tracker's own clock.
const assert = require("assert");
const { plan } = require("../netlify/functions/challenge-tick.js");
const DAY = 86400000, t0 = Date.UTC(2026, 10, 30);
const m = (d, o = {}) => Object.assign({ email: "a@b.c", completed: ["intro"], firstSessionDone: true, day0: t0 - d * DAY }, o);
const F = "6wc finished", L = "6wc day 41", J = "6wc joined";
assert.deepEqual(plan(m(0), [], t0).add, ["6wc day 0"]);
assert.deepEqual(plan(m(1), ["6wc day 0"], t0).add, []);
let p = plan(m(7), ["6wc day 2"], t0);
assert.deepEqual(p.add, ["6wc day 7"]); assert.deepEqual(p.remove, ["6wc day 2"]);          // one tag at a time
assert.equal(plan({ email: "a@b.c", completed: [] }, [], t0).skip, "intro not done");
assert.deepEqual(plan({ email: "a@b.c", completed: ["intro"] }, [], t0).add, ["6wc day 0"]);                 // Intro done, no dates yet
assert.deepEqual(plan({ email: "a@b.c", completed: ["intro"] }, ["6wc day 0"], t0).add, []);                 // then it waits
assert.deepEqual(plan({ email: "a@b.c", completed: ["intro"], booked: t0 + 5 * DAY }, ["6wc day 0"], t0).add, []);  // start date still to come
assert.deepEqual(plan({ email: "a@b.c", completed: ["intro"], booked: t0 - 2 * DAY }, ["6wc day 0"], t0).add, ["6wc day 2"]);
assert.deepEqual(plan({ email: "a@b.c", completed: ["intro"], booked: t0 - 49 * DAY }, ["6wc day 41"], t0).add, []);  // no finish until the clock has run
assert.equal(plan(m(9, { pausedAt: t0 - DAY }), [], t0).skip, "not eligible");
assert.equal(plan(m(9, { outcome: "left" }), [], t0).skip, "not eligible");
assert.deepEqual(plan(m(14, { pausedDays: 7 }), ["6wc day 2"], t0).add, ["6wc day 7"]);     // a banked pause moves the email
// Joined: the coaching emails carry on, the sign-up emails (37, 39, 41) don't.
assert.deepEqual(plan(m(14), ["members", "6wc day 7"], t0).add, ["6wc joined", "6wc day 14"]); // paid through the link: tagged joined first
assert.deepEqual(plan(m(14, { outcome: "stayed" }), [J, "6wc day 7"], t0).add, ["6wc day 14"]); // a coach marked them stayed on
assert.deepEqual(plan(m(14), [J, "member", "6wc day 7"], t0).add, ["6wc day 14"]);          // the old tag still counts
assert.deepEqual(plan(m(14, { outcome: "stayed" }), ["6wc day 7"], t0).add, [J, "6wc day 14"]); // a coach marking them stayed on tags them too
assert.deepEqual(plan(m(37), ["6wc day 35"], t0).add, ["6wc day 37"]);                      // not joined: the sign-up email goes
assert.deepEqual(plan(m(37), [J, "members", "6wc day 35"], t0).add, []);                       // joined: it doesn't
assert.deepEqual(plan(m(41, { outcome: "stayed" }), [J, "6wc day 35"], t0).add, []);
// Their membership starts the day the challenge ends: that's 'member start'.
assert.deepEqual(plan(m(42), [J, L, "members"], t0).add, [F, "member start"]);                 // the finish still fires, and they move across
assert.deepEqual(plan(m(42), [J, "6wc day 35", "members", F, "member start"], t0).add, []);     // once
assert.deepEqual(plan(m(41, { outcome: "stayed" }), ["6wc day 35"], t0).add.includes("member start"), false);
assert.deepEqual(plan(m(42, { outcome: "stayed", pausedDays: 3 }), [J, "6wc day 35"], t0).add, []); // a pause moves it
assert.deepEqual(plan(m(30, { outcome: "stayed", memberStart: t0 }), [J, "6wc day 28"], t0).add, ["member start"]); // a date a coach typed wins
assert.deepEqual(plan(m(30, { outcome: "stayed", memberStart: t0 + DAY }), [J, "6wc day 28"], t0).add, []);
assert.deepEqual(plan(m(42), [L], t0).add, [F]);                                            // not joined: no member start
// Paid through the link part way through, before a coach marked them stayed on: the coach gets a task.
assert.equal(plan(m(30), ["members", "6wc day 28"], t0).paidMidChallenge, true);
assert.equal(plan(m(30, { outcome: "stayed" }), ["members", "6wc day 28"], t0).paidMidChallenge, true);  // paid AND tapped Stayed on: still a task
assert.equal(plan(m(42), ["members", L], t0).paidMidChallenge, false);                      // first payment on the end date
assert.equal(plan(m(30), ["6wc day 28"], t0).paidMidChallenge, false);
assert.deepEqual(plan(m(42, { extraDays: 7 }), [L], t0).add, []);                           // an extension moves the end
assert.deepEqual(plan(m(48), [L, F], t0).add, []);
p = plan(m(49), [L, F], t0); assert.deepEqual(p.add, ["6wc lapsed", "email list"]); assert.equal(p.lapse, true); // onto Ash's email list
assert.deepEqual(plan(m(49), [L, F, "email list"], t0).add, ["6wc lapsed"]);                // already on it
assert.deepEqual(plan(m(49), [J, L, F, "members", "member start"], t0).add, []);                // joined: never lapsed
assert.equal(plan(m(3), [], t0, t0).skip, "started before launch");

// Guides: all three are due once the Intro is done, and a tag stops one being added twice.
const G = ["6wc guide welcome", "6wc guide nutracheck", "6wc guide myfitnesspal"];
assert.deepEqual(plan(m(0), [], t0).guides.map((g) => g.tag), G);
assert.deepEqual(plan(m(1), [G[0]], t0).guides.map((g) => g.tag), G.slice(1));
assert.deepEqual(plan(m(1), G, t0).guides, []);
assert.equal(plan({ email: "a@b.c", completed: [] }, [], t0).guides, undefined);            // no Intro, no guides

// Member start for anyone who has paid: now, unless they're still on a challenge on the tracker.
const { startDecision } = require("../netlify/functions/challenge-tick.js");
const paidC = (extra = []) => ({ tags: ["members", ...extra] });
assert.equal(startDecision(paidC(), undefined, t0), "start");                                // joined straight off the website
assert.equal(startDecision(paidC(["member start"]), undefined, t0), "done");                // once
assert.equal(startDecision(paidC(), m(20), t0), "wait");                                     // mid-challenge: the end date does it
assert.equal(startDecision(paidC(), m(42), t0), "start");                                    // challenge over
assert.equal(startDecision(paidC(), m(42, { extraDays: 7 }), t0), "wait");                   // added days
assert.equal(startDecision(paidC(), m(20, { pausedAt: t0 - DAY }), t0), "wait");            // paused
assert.equal(startDecision(paidC(), m(20, { memberStart: t0 }), t0), "start");              // a typed date has arrived
assert.equal(startDecision(paidC(), m(20, { outcome: "left" }), t0), "start");              // marked left but paid: they're a member
assert.equal(startDecision(paidC(), { email: "a@b.c", completed: ["intro"] }, t0), "wait"); // clock not started yet

// The morning run, against pretend services.
const tick = require("../netlify/functions/challenge-tick.js");
async function morning({ tags = [], onTrainerize = true, failOn = null }) {
  Object.assign(process.env, { CHALLENGE_LIVE: "1", URL: "https://site.test", GHL_TOKEN: "x", SUPABASE_URL: "https://db.test",
    SUPABASE_SERVICE_KEY: "x", TRAINERIZE_GROUP_ID: "1", TRAINERIZE_API_ACCESS: "x" });
  const log = [];
  const ok = (body) => new Response(JSON.stringify(body), { status: 200 });
  global.fetch = async (url, opts = {}) => {
    if (url.includes("/rest/v1/")) return ok([{ value: [{ id: "1", name: "A", email: "a@b.c", completed: ["intro"] }] }]);
    if (url.includes("/contacts/?")) return ok({ contacts: [{ id: "c1", email: "a@b.c", tags }] });
    if (url.endsWith("/contacts/search")) return ok({ contacts: tags.includes("members") ? [{ id: "c1", email: "a@b.c", tags }] : [] });
    if (url.endsWith("/contacts/c1/tags")) { log.push(opts.method + " " + JSON.parse(opts.body).tags.join()); return ok({}); }
    if (url.endsWith("/user/find")) return ok({ users: onTrainerize ? [{ id: 7, email: "a@b.c" }] : [] });
    if (url.endsWith(".pdf")) return new Response("pdf", { status: 200 });
    if (url.endsWith("/file/upload")) {
      const d = JSON.parse(opts.body.get("data"));
      if (d.fileName === failOn) return new Response("no", { status: 500 });
      assert.equal(d.attachType, "userAttachment"); assert.equal(d.attachTo, 7); assert.ok(opts.body.get("file"));
      log.push("upload " + d.fileName);
      return ok({ id: 1 });
    }
    throw new Error("unexpected " + url);
  };
  const quiet = console.log; console.log = () => {};
  const report = await tick.run({ dryRun: false });
  console.log = quiet;
  return { log, report };
}
(async () => {
  let r = await morning({});
  assert.deepEqual(r.log, [
    "upload Bodysculpt Welcome Guide.pdf", "POST 6wc guide welcome",
    "upload Bodysculpt Nutracheck Guide.pdf", "POST 6wc guide nutracheck",
    "upload Bodysculpt MyFitnessPal Guide.pdf", "POST 6wc guide myfitnesspal",
    "POST 6wc day 0"]);                                                                     // guides first, then the email
  r = await morning({ failOn: "Bodysculpt Nutracheck Guide.pdf" });
  assert.deepEqual(r.log, ["upload Bodysculpt Welcome Guide.pdf", "POST 6wc guide welcome", "POST 6wc guide failed"]); // a failure holds the email and texts Ash
  assert.equal(r.report.errors.length, 1);
  r = await morning({ tags: [G[0]] });
  assert.equal(r.log[0], "upload Bodysculpt Nutracheck Guide.pdf");                          // and it picks up from there
  r = await morning({ onTrainerize: false });
  assert.deepEqual(r.log, ["POST 6wc guide failed"]); assert.equal(r.report.errors.length, 1); // not on Trainerize: no email
  r = await morning({ tags: ["6wc guide failed"], onTrainerize: false });
  assert.deepEqual(r.log, []);                                                               // one text, not one a day
  r = await morning({ tags: ["6wc guide failed"] });
  assert.ok(r.log.includes("DELETE 6wc guide failed"));                                      // cleared once they're in
  assert.equal(r.log[r.log.length - 1], "POST 6wc day 0");
  r = await morning({});
  assert.equal(await tick.guidesNow("nobody"), "not on the roster");
  assert.equal(await tick.guidesNow("1"), "3 added");                                        // pressing Done
  process.env.CHALLENGE_LIVE = "0";
  assert.equal(await tick.guidesNow("1"), "not live");                                       // off means off
  r = await morning({ tags: [...G, "6wc day 0"] });
  assert.deepEqual(r.log, []);                                                               // nothing repeats
  console.log("challenge-tick: ok");
})().catch((e) => { console.error(e); process.exit(1); });

