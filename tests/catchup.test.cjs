// Monthly catch-up booking: slots, blocks, double-booking, and the GHL calls.
const assert = require("assert");
const fs = require("fs"); const path = require("path");
process.env.GHL_TOKEN = "x"; process.env.SUPABASE_URL = "https://sb.test"; process.env.SUPABASE_SERVICE_KEY = "k";
const fn = require("../netlify/functions/catchup.js");
const { SLOTS, allSlots, niceWhen } = fn._test;
const HTML = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
// the tracker and the function offer the same slots
assert.ok(HTML.includes("const CU_SLOTS = { 1:[16,17,18,19,20], 3:[16,17,18,19,20], 5:[6,7,8,9,10] }"));
assert.deepEqual(SLOTS, { 1: [16, 17, 18, 19, 20], 3: [16, 17, 18, 19, 20], 5: [6, 7, 8, 9, 10] });
const NOW = Date.parse("2026-11-26T10:00:00Z");   // Thursday
const s = allSlots(NOW);
assert.equal(s[0].date, "2026-11-27"); assert.equal(s[0].time, "06:00");   // Fri morning first
assert.ok(s.every((x) => [1, 3, 5].includes(new Date(x.date + "T12:00:00Z").getUTCDay())));
assert.equal(s.length, 9 * 5);                       // 3 weeks x 3 days x 5 times
assert.equal(niceWhen("2026-11-30", "18:00"), "Monday 30 November at 6pm");
assert.equal(niceWhen("2026-11-27", "06:00"), "Friday 27 November at 6am");

let store;
async function run(body, opts = {}) {
  const calls = [];
  global.fetch = async (url, o = {}) => {
    const b = o.body ? JSON.parse(o.body) : null;
    calls.push({ url, method: o.method || "GET", b });
    if (url.startsWith("https://sb.test")) {
      if ((o.method || "GET") === "GET") { const k = decodeURIComponent(url.match(/key=eq\.([^&]+)/)[1]); return new Response(JSON.stringify(store[k] ? [{ value: store[k] }] : []), { status: 200 }); }
      store[b.key] = b.value; return new Response("", { status: 201 });
    }
    const p = url.replace("https://services.leadconnectorhq.com", "");
    if (p === "/contacts/c1234567890") return new Response(JSON.stringify({ contact: { id: "c1234567890", firstName: "Jodie", lastName: "Wane", email: "J@x.com" } }), { status: 200 });
    if (opts.failEmail && p === "/conversations/messages") return new Response("no", { status: 500 });
    return new Response("{}", { status: 200 });
  };
  const real = Date.now; Date.now = () => NOW;
  const quiet = console.error; console.error = () => {};
  const res = await fn.handler(body);
  Date.now = real; console.error = quiet;
  return { res, out: JSON.parse(res.body || "{}"), calls };
}
(async () => {
  store = { "catchup-blocks": { blocks: { "2026-11-30T18:00": { dan: { by: "Dan", why: "Intro" } } } }, "catchup-bookings": { bookings: [] } };
  let { out } = await run({ httpMethod: "GET", queryStringParameters: { c: "c1234567890" } });
  assert.equal(out.first, "Jodie"); assert.equal(out.known, true);
  const slot = out.slots.find((x) => x.date === "2026-11-30" && x.time === "18:00");
  assert.equal(slot.dan, false); assert.equal(slot.ash, true);          // blocked for Dan only
  assert.ok(!JSON.stringify(out).includes("Intro"));                    // no reasons or names leak

  const post = (o) => ({ httpMethod: "POST", body: JSON.stringify(Object.assign({ c: "c1234567890", who: "ash", date: "2026-11-30", time: "18:00", note: "Holiday in March" }, o)) });
  let r = await run(post());
  assert.equal(r.res.statusCode, 200);
  const bk = store["catchup-bookings"].bookings;
  assert.equal(bk.length, 1); assert.equal(bk[0].name, "Jodie Wane"); assert.equal(bk[0].email, "j@x.com"); assert.equal(bk[0].who, "ash");
  const ghl = r.calls.filter((c) => c.url.includes("leadconnector") && c.method === "POST").map((c) => c.url.replace("https://services.leadconnectorhq.com", ""));
  assert.deepEqual(ghl, ["/contacts/c1234567890/notes", "/contacts/c1234567890/tasks", "/conversations/messages"]);
  const email = r.calls.find((c) => c.url.endsWith("/conversations/messages")).b;
  assert.equal(email.type, "Email"); assert.ok(email.html.includes("Monday 30 November at 6pm")); assert.ok(email.html.includes("Zoom link"));

  r = await run(post());                                                 // same lane again
  assert.equal(r.res.statusCode, 409); assert.equal(store["catchup-bookings"].bookings.length, 1);
  r = await run(post({ who: "dan" }));                                   // Dan blocked at that time
  assert.equal(r.res.statusCode, 409);
  r = await run(post({ who: "dan", time: "19:00" }), { failEmail: true }); // Dan, no Zoom task; email failing doesn't lose the booking
  assert.equal(r.res.statusCode, 200); assert.equal(r.out.ghl.email, false); assert.equal(r.out.ghl.task, false);
  assert.equal(store["catchup-bookings"].bookings.length, 2);
  r = await run(post({ time: "13:00" }));                                assert.equal(r.res.statusCode, 400);
  r = await run(post({ date: "2026-12-29" }));                           assert.equal(r.res.statusCode, 400);   // beyond 3 weeks
  r = await run(post({ c: "", firstName: "", email: "" }));              assert.equal(r.res.statusCode, 400);
  console.log("catchup: ok");
})().catch((e) => { console.error(e); process.exit(1); });
