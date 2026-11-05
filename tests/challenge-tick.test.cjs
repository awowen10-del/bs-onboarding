// challenge-tick: what is due is worked out from the tracker's own clock.
const assert = require("assert");
const { plan } = require("../netlify/functions/challenge-tick.js");
const DAY = 86400000, t0 = Date.UTC(2026, 10, 30);
const m = (d, o = {}) => Object.assign({ email: "a@b.c", firstSessionDone: true, day0: t0 - d * DAY }, o);
const S = "6wc started", F = "6wc finished";
assert.deepEqual(plan(m(0), [], t0).add, [S]);
assert.deepEqual(plan(m(1), [S], t0).add, []);
assert.equal(plan(m(3, { firstSessionDone: false }), [], t0).skip, "not started");
assert.equal(plan(m(9, { pausedAt: t0 - DAY }), [], t0).skip, "not eligible");
assert.equal(plan(m(9, { outcome: "left" }), [], t0).skip, "not eligible");
assert.deepEqual(plan(m(14, { outcome: "stayed" }), [S], t0).add, ["member"]);
assert.deepEqual(plan(m(42), [S, "member"], t0).add, [F]);                        // the finish still fires for members
assert.deepEqual(plan(m(42, { extraDays: 7 }), [S], t0).add, []);                 // an extension moves the end
assert.deepEqual(plan(m(48), [S, F], t0).add, []);
let p = plan(m(49), [S, F], t0); assert.deepEqual(p.add, ["6wc lapsed"]); assert.equal(p.lapse, true);
assert.deepEqual(plan(m(49), [S, F, "member"], t0).add, []);
assert.equal(plan(m(3), [], t0, t0).skip, "started before launch");
console.log("challenge-tick: ok");
