// teamup-new-client webhook: the door is locked, a repeat creates nothing, a dry run creates
// nothing, and no path through it ever touches a membership.
const assert = require("assert");
const path = require("path");

const MODULE = path.join(__dirname, "..", "netlify", "functions", "teamup-new-client.js");

function load() {
  process.env.TEAMUP_TOKEN = "tok";
  process.env.WEBHOOK_SECRET = "s3cret";
  delete require.cache[require.resolve(MODULE)];
  return require(MODULE);
}

function stub(results) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method || "GET", body: init.body ? JSON.parse(init.body) : null, headers: init.headers });
    const body = init.method === "POST" ? { id: 99 } : { count: results.length, results };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  };
  return calls;
}

const ev = (body, secret = "s3cret") => ({
  httpMethod: "POST",
  queryStringParameters: { secret },
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

(async () => {
  const log = console.log;
  console.log = () => {};
  const mod = load();
  const person = { first_name: "Sarah", last_name: "Doyle", email: "Sarah@Example.com" };

  let calls = stub([]);
  assert.equal((await mod.handler(ev(person, "wrong"))).statusCode, 401);
  assert.equal(calls.length, 0);

  calls = stub([]);
  let res = await mod.handler(ev(person));
  assert.equal(res.statusCode, 200);
  assert.equal(calls.length, 2);
  assert.ok(calls[0].url.includes("query=sarah%40example.com"));
  assert.equal(calls[0].headers.Authorization, "Token tok");
  assert.deepEqual(calls[1].body, { first_name: "Sarah", last_name: "Doyle", email: "sarah@example.com" });
  assert.ok(calls[1].url.endsWith("/customers"));

  // a near-miss from the free-text search is not a match
  calls = stub([{ id: 1, email: "sarah@example.com.au" }]);
  await mod.handler(ev(person));
  assert.equal(calls.length, 2);

  calls = stub([{ id: 7, email: "SARAH@example.com" }]);
  res = await mod.handler(ev(person));
  assert.equal(calls.length, 1);
  assert.equal(JSON.parse(res.body).skipped, "already_on_teamup");

  calls = stub([]);
  res = await mod.handler(ev({ ...person, dry_run: true }));
  assert.equal(calls.length, 1);
  assert.equal(JSON.parse(res.body).wouldCreate, true);

  calls = stub([]);
  await mod.handler(ev({ first_name: "Cher", email: "c@x.com" }));
  assert.equal(calls[1].body.last_name, "-");

  calls = stub([]);
  assert.equal((await mod.handler(ev({ email: "c@x.com" }))).statusCode, 400);
  assert.equal(calls.length, 0);

  console.log = log;
  console.log("teamup-new-client: ok");
})().catch((e) => { console.error(e); process.exit(1); });
