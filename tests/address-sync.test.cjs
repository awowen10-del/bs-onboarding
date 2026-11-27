// Addresses from TeamUp onto GHL: the field mapping, never overwriting, and who is looked at.
const assert = require("assert");
const { toGhl, hasStreet, toCheck } = require("../netlify/functions/address-sync-background.js")._test;
assert.deepEqual(toGhl({ address_line1: " 12 High St ", address_line2: "Lymm", city: "Warrington", region: "Cheshire", postcode: "wa13 0aa", country: "United Kingdom" }),
  { address1: "12 High St, Lymm", city: "Warrington", state: "Cheshire", postalCode: "WA13 0AA", country: "GB" });
assert.deepEqual(toGhl({ address_line1: "1 Road", city: "Wigan", postcode: "WN1 1AA", country: "GB" }), { address1: "1 Road", city: "Wigan", postalCode: "WN1 1AA", country: "GB" });
assert.equal(toGhl({ address_line1: "", city: "Warrington" }), null, "no street, nothing to send");
assert.equal(toGhl(null), null);
assert.ok(hasStreet({ address1: "5 Lane" })); assert.ok(!hasStreet({ address1: " " })); assert.ok(!hasStreet({}));
const now = Date.parse("2026-11-27T12:00:00Z");
const ms = [{ id: "a", tid: "1" }, { id: "b", tid: "2" }, { id: "c", tid: "3" }, { id: "d", tid: "4" }, { id: "e", tid: null }];
const done = { b: { state: "filled" }, c: { state: "none", at: "2026-11-20T00:00:00Z" }, d: { state: "none", at: "2026-10-01T00:00:00Z" } };
assert.deepEqual(toCheck(ms, done, now).map((m) => m.id), ["a", "d"], "new, and 'none' after 30 days; never anyone without TeamUp");
console.log("address-sync: OK");
