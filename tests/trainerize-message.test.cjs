// GHL -> one Trainerize message from Bodysculpt Support (members automation).
const assert = require("assert");
process.env.WEBHOOK_SECRET = "s"; process.env.GHL_TOKEN = "x";
process.env.TRAINERIZE_GROUP_ID = "g"; process.env.TRAINERIZE_API_ACCESS = "t";
const fn = require("../netlify/functions/trainerize-message.js");

async function run(body, users, secret = "s") {
  const calls = [];
  global.fetch = async (url, opts) => {
    const b = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ url, b });
    if (url.endsWith("/user/find")) return new Response(JSON.stringify({ users }), { status: 200 });
    if (url.endsWith("/message/send")) return new Response(JSON.stringify({ threadIDs: [5] }), { status: 200 });
    return new Response("{}", { status: 200 });
  };
  const quiet = console.error; console.error = () => {};
  const res = await fn.handler({ httpMethod: "POST", headers: { "x-webhook-secret": secret, "content-type": "application/json" }, body: JSON.stringify(body) });
  console.error = quiet;
  return { res, body: JSON.parse(res.body), calls };
}

(async () => {
  const sam = [{ id: 77, email: "Sam@Example.com" }];
  { const r = await run({ email: "sam@example.com", message: "Hi Sam" }, sam, "nope"); assert.equal(r.res.statusCode, 401); }
  { const r = await run({ email: "sam@example.com" }, sam); assert.equal(r.res.statusCode, 400, "message required"); }
  {
    const r = await run({ email: " SAM@example.com ", message: "Hi Sam\r\n\r\nWelcome", contact_id: "c1" }, sam);
    assert.equal(r.body.sent, true);
    const send = r.calls.find((c) => c.url.endsWith("/message/send")).b;
    assert.equal(send.userID, 2920561, "from Bodysculpt Support");
    assert.deepEqual(send.recipients, [77]);
    assert.equal(send.body, "Hi Sam\n\nWelcome");
  }
  {
    const r = await run({ email: "sam@example.com", message: "Hi", dry_run: true }, sam);
    assert.equal(r.body.dryRun, true);
    assert.ok(!r.calls.some((c) => c.url.endsWith("/message/send")), "dry run sends nothing");
  }
  {
    const r = await run({ email: "new@example.com", message: "Hi", contact_id: "c1" }, sam);
    assert.equal(r.res.statusCode, 200); assert.equal(r.body.sent, false);
    const note = r.calls.find((c) => c.url.includes("/contacts/c1/notes"));
    assert.ok(note && /NOT sent/.test(note.b.body), "GHL note when not on Trainerize");
  }
  console.log("trainerize-message: ok");
})().catch((e) => { console.error(e); process.exit(1); });
