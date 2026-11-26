// Welcome cards: the card's details sit inside the member's day-0 Welcome card job, a card with
// nobody on the member list is its own job, and a card completed in GHL ticks the job here.
const assert = require("assert");
const { boot } = require("./lib/env.cjs");
const app = boot({ members: [], retention: [
  { id: "r1", name: "Jodie Wane", email: "Jodie@X.com", coach: "Dan", joined: Date.now() - 1000, attendance: {}, completed: [], missed: [] },
  { id: "r2", name: "Sam Lee", email: "", coach: "Dan", joined: Date.now() - 1000, attendance: {}, completed: [], missed: [] }] });
const c = app.ctx;
const card = (o) => Object.assign({ address: [], personal: "", mentions: [], taskId: "t", ghlDone: false, sent: null, closed: false, createdAt: new Date().toISOString() }, o);
c.__t.wcCards = {
  c1: card({ contactId: "c1", name: "Jodie Wane", email: "jodie@x.com", address: ["4 Oak Road", "WA1 2AB"], personal: "Her daughter is getting married in June.",
    mentions: [{ text: "Jodie Wane, loving it", coach: "Grace Terry", day: "2026-11-02" }] }),
  c2: card({ contactId: "c2", name: "Pat New", email: "pat@x.com" }),
  c3: card({ contactId: "c3", name: "Sam Lee", email: "", ghlDone: true, closed: true }),
};
c.renderRetentionToday();
const html = app.html("retTodayList");
assert.ok(/4 Oak Road, WA1 2AB/.test(html) && /daughter is getting married/.test(html) && /Jodie Wane, loving it/.test(html), "card details in Jodie's Welcome card job");
assert.ok(/Ticking this off also ticks Ash's GHL task/.test(html));
assert.ok(html.includes("Pat New") && /wcMarkSent\('c2'\)/.test(html) && /Not on GHL/.test(html), "a card with nobody on the list is its own job");
assert.ok(!/wcMarkSent\('c3'\)/.test(html), "a closed card is not a loose job");
// GHL completed Sam's -> Sam's job ticks here
c.wcApplyGhlTicks();
const sam = c.__t.retention.find((m) => m.id === "r2");
assert.ok((sam.completed || []).includes("welcome_card"), "GHL tick lands on the member's job");
const jo = c.__t.retention.find((m) => m.id === "r1");
assert.ok(!(jo.completed || []).includes("welcome_card"), "nobody else is ticked");
console.log("welcome-cards: ok");
