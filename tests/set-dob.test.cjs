// set-dob webhook harness. Assertions: the shared secret is enforced exactly as
// new-challenger.js enforces it; dates arrive in whatever shape Ontraport/Zapier feel like
// and come out as one ISO string (with the UK reading of an ambiguous 04/05/1990); people
// are matched on a trimmed, case-insensitive name with email as a fallback; a name that
// matches nobody creates NOTHING and writes NOTHING; and a successful match writes the
// roster back with only that one person changed.
const assert = require("assert");
const path = require("path");

const MODULE = path.join(__dirname, "..", "netlify", "functions", "set-dob.js");

// The function reads its env into module-level consts, so a config change needs a fresh
// require. Everything defaults to a working setup; pass null to unset a var.
function load(env) {
  const base = {
    SUPABASE_URL: "https://proj.supabase.co",
    SUPABASE_SERVICE_KEY: "service-key",
    WEBHOOK_SECRET: "s3cret",
    DOB_DATE_ORDER: "DMY",
  };
  const merged = Object.assign({}, base, env || {});
  Object.keys(merged).forEach((k) => {
    if (merged[k] === null) delete process.env[k];
    else process.env[k] = merged[k];
  });
  delete require.cache[require.resolve(MODULE)];
  return require(MODULE);
}

// Stub Supabase: a GET returns the roster row, a POST is the write-back.
function stubFetch(roster, opts = {}) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const method = init.method || "GET";
    calls.push({ url: String(url), method, body: init.body ? JSON.parse(init.body) : null });
    if (method === "GET") {
      if (opts.readFails) return { ok: false, status: 500, json: async () => ({}), text: async () => "boom" };
      return { ok: true, status: 200, json: async () => [{ value: roster }], text: async () => "" };
    }
    if (opts.writeFails) return { ok: false, status: 400, json: async () => ({}), text: async () => "nope" };
    return { ok: true, status: 201, json: async () => ({}), text: async () => "" };
  };
  return calls;
}

function ev(body, o = {}) {
  const json = o.form !== true;
  return {
    httpMethod: o.method || "POST",
    queryStringParameters: o.secret === null ? {} : { secret: o.secret || "s3cret" },
    headers: Object.assign(
      { "content-type": json ? "application/json" : "application/x-www-form-urlencoded" },
      o.headers || {}
    ),
    body: o.raw !== undefined ? o.raw : (json ? JSON.stringify(body) : new URLSearchParams(body).toString()),
  };
}

// run the handler with the console captured, so the log assertions are possible and the
// test output stays readable
async function run(mod, event) {
  const logs = [];
  const real = console.log;
  console.log = (...a) => logs.push(a.join(" "));
  try {
    const res = await mod.handler(event);
    return { status: res.statusCode, body: JSON.parse(res.body), logs };
  } finally { console.log = real; }
}

const roster = () => ([
  { id: "m1", name: "Sarah Doyle", coach: "Dan", dob: null, email: "sarah@example.com" },
  { id: "m2", name: "  mark   ELLISON ", coach: "Grace", dob: null },
  { id: "m3", name: "Priya Shah", coach: "Ash", dob: "1992-01-05", email: "p@example.com" },
]);

(async () => {

/* ---------- 1: the door is locked, same as new-challenger.js ---------- */
{
  const mod = load();
  stubFetch(roster());
  assert.strictEqual((await run(mod, ev({}, { method: "GET" }))).status, 405, "GET is refused");
  assert.strictEqual((await run(mod, ev({ name: "Sarah Doyle", dob: "1990-04-23" }, { secret: "wrong" }))).status, 401);
  assert.strictEqual((await run(mod, ev({ name: "Sarah Doyle", dob: "1990-04-23" }, { secret: null }))).status, 401);

  const noSecret = load({ WEBHOOK_SECRET: null });
  const r = await run(noSecret, ev({ name: "Sarah Doyle", dob: "1990-04-23" }));
  assert.strictEqual(r.status, 401, "with no secret configured, nothing gets in");

  const noDb = load({ SUPABASE_URL: null });
  assert.strictEqual((await run(noDb, ev({ name: "Sarah Doyle", dob: "1990-04-23" }))).status, 500);
}

/* ---------- 2: every date shape Zapier might send ---------- */
{
  const { parseDob } = load().__test;
  const cases = [
    ["1990-04-23", "1990-04-23"],
    ["1990-4-3", "1990-04-03"],
    ["1990-04-23T00:00:00Z", "1990-04-23"],
    ["1990-04-23 00:00:00", "1990-04-23"],
    ["23/04/1990", "1990-04-23"],          // day > 12, unambiguous
    ["23-04-1990", "1990-04-23"],
    ["23.04.1990", "1990-04-23"],
    ["04/23/1990", "1990-04-23"],          // month first, unambiguous the other way
    ["04/05/1990", "1990-05-04"],          // ambiguous -> UK reading (4 May)
    ["1990/04/23", "1990-04-23"],
    ["23 April 1990", "1990-04-23"],
    ["April 23, 1990", "1990-04-23"],
    ["23-Apr-1990", "1990-04-23"],
    ["  1990-04-23  ", "1990-04-23"],
    ['"1990-04-23"', "1990-04-23"],
    ["1988-02-29", "1988-02-29"],          // real leap day
  ];
  for (const [input, expect] of cases) {
    const got = parseDob(input);
    assert.ok(got, "should have parsed " + JSON.stringify(input));
    assert.strictEqual(got.iso, expect, JSON.stringify(input) + " -> " + expect);
  }
  for (const bad of ["", null, undefined, "not a date", "31/02/1990", "1990-02-30",
    "13/13/1990", "1990", "23/04/90", "0001-01-01", "1899-05-05", "3020-01-01"]) {
    assert.strictEqual(parseDob(bad), null, JSON.stringify(bad) + " must not parse");
  }
  // the ambiguous case is reported as such, so the log can say how it read it
  assert.ok(/ambiguous/.test(parseDob("04/05/1990").how));
  assert.ok(/unambiguous/.test(parseDob("23/04/1990").how));

  // and a site that wants the American reading can have it
  const mdy = load({ DOB_DATE_ORDER: "MDY" }).__test;
  assert.strictEqual(mdy.parseDob("04/05/1990").iso, "1990-04-05", "MDY reads 4 May as April 5th");
  assert.strictEqual(mdy.parseDob("23/04/1990").iso, "1990-04-23", "…but an unambiguous one is still safe");
}

/* ---------- 3: matching people by name, then email ---------- */
{
  const { findMatch } = load().__test;
  const list = roster();
  assert.strictEqual(findMatch(list, "Sarah Doyle").member.id, "m1", "exact name");
  assert.strictEqual(findMatch(list, "  sarah   doyle  ").member.id, "m1", "trimmed, folded, spaces collapsed");
  assert.strictEqual(findMatch(list, "MARK ELLISON").member.id, "m2", "…on both sides of the comparison");
  assert.strictEqual(findMatch(list, "Nobody Here").member, null, "an unknown name matches nothing");
  assert.strictEqual(findMatch(list, "Nobody Here").matches, 0);

  // email as the fallback when the name finds nothing
  const byEmail = findMatch(list, "Sarah Doyle-Smith", "sarah@example.com");
  assert.strictEqual(byEmail.member.id, "m1");
  assert.strictEqual(byEmail.by, "email");
  assert.strictEqual(findMatch(list, "", "p@example.com").member.id, "m3", "email alone is enough");
  assert.strictEqual(findMatch(list, "Nobody", "nobody@example.com").member, null);

  // two people really do share a name
  const twins = [
    { id: "t1", name: "Sam Jones", dob: "1980-01-01", email: "old@example.com" },
    { id: "t2", name: "Sam Jones", dob: null },
  ];
  assert.strictEqual(findMatch(twins, "Sam Jones").member.id, "t2", "prefer the one still missing a dob");
  assert.strictEqual(findMatch(twins, "Sam Jones").matches, 2, "…and report that it was ambiguous");
  assert.strictEqual(findMatch(twins, "Sam Jones", "old@example.com").member.id, "t1",
    "an email breaks the tie");
  const bothMissing = [{ id: "u1", name: "Sam Jones", dob: null }, { id: "u2", name: "Sam Jones", dob: null }];
  assert.strictEqual(findMatch(bothMissing, "Sam Jones").member.id, "u2", "otherwise the most recent");
}

/* ---------- 4: a match updates exactly one person and writes the roster back ---------- */
{
  const mod = load();
  const data = roster();
  const calls = stubFetch(data);
  const r = await run(mod, ev({ name: "sarah doyle", dob: "23/04/1990" }));

  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.result, "updated");
  assert.strictEqual(r.body.matched, true);
  assert.strictEqual(r.body.dob, "1990-04-23");
  assert.strictEqual(r.body.name, "Sarah Doyle", "reports the roster's spelling of the name");
  assert.strictEqual(r.body.previous, null);

  const writes = calls.filter((c) => c.method === "POST");
  assert.strictEqual(writes.length, 1, "exactly one write");
  const saved = writes[0].body.value;
  assert.strictEqual(writes[0].body.key, "roster");
  assert.strictEqual(saved.length, 3, "nobody was added");
  assert.strictEqual(saved.find((m) => m.id === "m1").dob, "1990-04-23");
  assert.strictEqual(saved.find((m) => m.id === "m2").dob, null, "everyone else is untouched");
  assert.strictEqual(saved.find((m) => m.id === "m3").dob, "1992-01-05");
  assert.ok(r.logs.some((l) => /^UPDATED:/.test(l)), "it logs what it did");
  assert.ok(r.logs.some((l) => /RECEIVED:/.test(l)), "…and what it received");
}

/* ---------- 5: no match — nothing created, nothing written ---------- */
{
  const mod = load();
  const calls = stubFetch(roster());
  const r = await run(mod, ev({ name: "Someone Else", email: "them@example.com", dob: "1990-04-23" }));

  assert.strictEqual(r.status, 200, "a 200 so Zapier doesn't error-pause the Zap on ordinary misses");
  assert.strictEqual(r.body.matched, false);
  assert.strictEqual(r.body.result, "no_match");
  assert.strictEqual(r.body.name, "Someone Else");
  assert.strictEqual(r.body.rosterSize, 3);
  assert.ok(/nothing was created or changed/i.test(r.body.note), "the response says so plainly");
  assert.strictEqual(calls.filter((c) => c.method === "POST").length, 0, "NOTHING was written");
  assert.ok(r.logs.some((l) => /^NO MATCH:/.test(l)), "and it is logged as a no-match");
}

/* ---------- 6: already correct — no pointless write ---------- */
{
  const mod = load();
  const calls = stubFetch(roster());
  const r = await run(mod, ev({ name: "Priya Shah", dob: "1992-01-05" }));
  assert.strictEqual(r.body.result, "unchanged");
  assert.strictEqual(r.body.matched, true);
  assert.strictEqual(calls.filter((c) => c.method === "POST").length, 0,
    "an identical dob writes nothing, so no needless sync to every device");
  assert.ok(r.logs.some((l) => /^UNCHANGED:/.test(l)));
}

/* ---------- 7: bad or missing input is refused clearly ---------- */
{
  const mod = load();
  stubFetch(roster());

  const noDob = await run(mod, ev({ name: "Sarah Doyle" }));
  assert.strictEqual(noDob.status, 400);
  assert.ok(/could not read a date of birth/i.test(noDob.body.error));
  assert.ok(/YYYY-MM-DD/.test(noDob.body.hint), "the error tells you how to fix it");

  const badDob = await run(mod, ev({ name: "Sarah Doyle", dob: "sometime in 1990" }));
  assert.strictEqual(badDob.status, 400);
  assert.strictEqual(badDob.body.received, "sometime in 1990", "…and quotes back what it got");

  const noName = await run(mod, ev({ dob: "1990-04-23" }));
  assert.strictEqual(noName.status, 400);
  assert.ok(/no name or email/i.test(noName.body.error));

  const junk = await run(mod, ev(null, { raw: "{not json" }));
  assert.strictEqual(junk.status, 400);
}

/* ---------- 8: form-encoded bodies and the other field names ---------- */
{
  for (const payload of [
    { firstname: "Sarah", lastname: "Doyle", date_of_birth: "1990-04-23" },
    { name: "Sarah Doyle", birthday: "1990-04-23" },
    { name: "Sarah Doyle", DOB: "1990-04-23" },
    { name: "Sarah Doyle", dateOfBirth: "1990-04-23" },
    { name: "Sarah Doyle", birth_date: "1990-04-23" },
  ]) {
    const mod = load();
    const calls = stubFetch(roster());
    const r = await run(mod, ev(payload, { form: true }));
    assert.strictEqual(r.body.result, "updated", "form-encoded " + JSON.stringify(payload));
    assert.strictEqual(calls.filter((c) => c.method === "POST")[0].body.value[0].dob, "1990-04-23");
  }
  // the secret can travel in a header instead of the query string
  const mod = load();
  stubFetch(roster());
  const r = await run(mod, ev({ name: "Sarah Doyle", dob: "1990-04-23" },
    { secret: null, headers: { "x-webhook-secret": "s3cret" } }));
  assert.strictEqual(r.body.result, "updated");
}

/* ---------- 9: Supabase falling over is reported, not swallowed ---------- */
{
  const mod = load();
  stubFetch(roster(), { readFails: true });
  const bad = await run(mod, ev({ name: "Sarah Doyle", dob: "1990-04-23" }));
  assert.strictEqual(bad.status, 500);
  assert.ok(/read failed/.test(bad.body.error));

  stubFetch(roster(), { writeFails: true });
  const bad2 = await run(mod, ev({ name: "Sarah Doyle", dob: "1990-04-23" }));
  assert.strictEqual(bad2.status, 500);
  assert.ok(/write failed/.test(bad2.body.error));
}

/* ---------- 10: what it writes is what the app can read ---------- */
{
  const mod = load();
  const calls = stubFetch(roster());
  await run(mod, ev({ name: "Sarah Doyle", dob: "23 April 1990" }));
  const saved = calls.filter((c) => c.method === "POST")[0].body.value;

  // boot the real app on exactly that blob and check it lands on the Birthdays tab
  const { boot } = require("./lib/env.cjs");
  const app = boot({ members: saved });
  assert.strictEqual(app.find("m1").dob, "1990-04-23");
  assert.ok(app.html("birthdayList").includes("Sarah Doyle"), "the webhook's date shows on the tab");
  assert.ok(app.html("birthdayList").includes(">23rd<"), "…on the 23rd");
}

console.log("set-dob.test.cjs: OK");
})().catch((e) => { console.error(e); process.exit(1); });
