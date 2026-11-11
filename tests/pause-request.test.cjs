// Membership pause form -> GHL: contact, note, task for Ash, then the 'pause request' tag.
const assert = require("assert");
process.env.GHL_TOKEN = "x";
const fn = require("../netlify/functions/pause-request.js");
const form = (o) => new URLSearchParams(Object.assign({ firstName: "Sam", lastName: "Jones", email: "Sam@Example.com",
  pauseLength: "60", comments: "Off travelling", agreedTerms: "yes", requestDate: "2026-11-11" }, o)).toString();
async function run(body, failOn) {
  const calls = [];
  global.fetch = async (url, opts) => {
    const path = url.replace("https://services.leadconnectorhq.com", "");
    calls.push({ path, b: opts.body ? JSON.parse(opts.body) : null });
    if (failOn && path.includes(failOn)) return new Response("no", { status: 500 });
    if (path === "/contacts/upsert") return new Response(JSON.stringify({ contact: { id: "c9" } }), { status: 200 });
    return new Response("{}", { status: 200 });
  };
  const quiet = [console.log, console.error]; console.log = console.error = () => {};
  const res = await fn.handler({ httpMethod: "POST", body });
  [console.log, console.error] = quiet;
  return { res, calls };
}
(async () => {
  let { res, calls } = await run(form());
  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls.map((c) => c.path), ["/contacts/upsert", "/contacts/c9/notes", "/contacts/c9/tasks", "/contacts/c9/tags"]);
  assert.ok(calls[1].b.body.includes("60 days") && calls[1].b.body.includes("Off travelling"));
  assert.equal(calls[2].b.title, "Pause request (60 days): Sam Jones");
  for (const t of ["pause 30 days", "pause 60 days", "pause declined", "move their next payment back 60 days"]) assert.ok(calls[2].b.body.includes(t), t);
  assert.deepEqual(calls[3].b.tags, ["pause request"]);
  ({ res, calls } = await run(form({ pauseLength: "45" })));
  assert.equal(res.statusCode, 400); assert.equal(calls.length, 0);   // only 30 or 60
  ({ res } = await run(form({ agreedTerms: "" })));
  assert.equal(res.statusCode, 400);                                   // must accept the no-cancel rule
  ({ res, calls } = await run(form(), "/tasks"));
  assert.equal(res.statusCode, 502);
  assert.ok(!calls.some((c) => c.path.endsWith("/tags")));
  console.log("pause-request: ok");
})().catch((e) => { console.error(e); process.exit(1); });
