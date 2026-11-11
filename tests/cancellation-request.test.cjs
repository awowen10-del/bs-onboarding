// Membership cancellation form -> GHL: contact, note, task for Ash, then the 'cancellation request' tag.
const assert = require("assert");
process.env.GHL_TOKEN = "x";
const fn = require("../netlify/functions/cancellation-request.js");

const form = (o) => new URLSearchParams(Object.assign({ firstName: "Sam", lastName: "Jones", email: "Sam@Example.com",
  rating: "7", comments: "Moving away", agreedTerms: "yes", requestDate: "2026-11-11" }, o)).toString();

async function run(body, failOn) {
  const calls = [];
  global.fetch = async (url, opts) => {
    const path = url.replace("https://services.leadconnectorhq.com", "");
    const b = opts.body ? JSON.parse(opts.body) : null;
    calls.push({ path, method: opts.method, b });
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
  assert.equal(calls[0].b.email, "sam@example.com");
  assert.ok(calls[1].b.body.includes("Rating: 7/10") && calls[1].b.body.includes("Moving away"));
  const task = calls[2].b;
  assert.equal(task.assignedTo, "JDb3t1lKcxPLjclX2WXd");
  assert.equal(task.title, "Cancellation request: Sam Jones");
  for (const t of ["cancel approved:", "cancel approved now:", "cancel declined:"]) assert.ok(task.body.includes(t), t);
  assert.deepEqual(calls[3].b.tags, ["cancellation request"]);          // tag goes on last

  ({ res, calls } = await run(form({ agreedTerms: "" })));
  assert.equal(res.statusCode, 400); assert.equal(calls.length, 0);     // must agree to the terms
  ({ res, calls } = await run(form({ email: "nope" })));
  assert.equal(res.statusCode, 400);

  ({ res, calls } = await run(form({ rating: "" })));
  assert.ok(calls[1].b.body.includes("Rating: not given"));             // rating is optional

  ({ res, calls } = await run(JSON.stringify({ firstName: "A", lastName: "B", email: "a@b.co", agreedTerms: "yes" })));
  assert.equal(res.statusCode, 200);                                    // JSON works too

  ({ res, calls } = await run(form(), "/tasks"));
  assert.equal(res.statusCode, 502);
  assert.ok(!calls.some((c) => c.path.endsWith("/tags")), "no tag if the task failed, so no alert without a task");

  res = await fn.handler({ httpMethod: "GET" });
  assert.equal(res.statusCode, 405);
  console.log("cancellation-request: ok");
})().catch((e) => { console.error(e); process.exit(1); });
