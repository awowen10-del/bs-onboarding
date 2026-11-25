// Tracker -> GHL/TeamUp actions: only known actions, only members, only fresh, and capped.
const assert = require("assert");
const { describe, validRequest } = require("../netlify/functions/member-actions.js");
const members = [{ id: "g1", name: "Sarah" }];
const now = Date.parse("2026-11-25T12:00:00Z"), at = "2026-11-25T11:58:00Z";
assert.equal(validRequest({ type: "left", ghlId: "g1", at }, members, [], now), null);
assert.equal(validRequest({ type: "delete", ghlId: "g1", at }, members, [], now), "unknown action");
assert.equal(validRequest({ type: "pause", days: 45, ghlId: "g1", at }, members, [], now), "pause must be 30 or 60 days");
assert.equal(validRequest({ type: "pause", days: 30, ghlId: "zz", at }, members, [], now), "not on the members list");
assert.match(validRequest({ type: "left", ghlId: "g1", at: "2026-11-25T10:00:00Z" }, members, [], now), /too old/);
const five = Array(5).fill(0).map((_, i) => ({ type: "left", status: "done", doneAt: "2026-11-25T09:0" + i + ":00Z" }));
assert.match(validRequest({ type: "left", ghlId: "g1", at }, members, five, now), /daily limit/);
assert.equal(describe({ type: "pause", days: 60, name: "Sarah" }).tag, "pause 60 days");
assert.equal(describe({ type: "left", name: "Sarah" }).tag, "cancelled member");
console.log("member-actions: ok");
