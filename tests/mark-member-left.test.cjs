// mark-member-left webhook harness, and the gate it exists to switch on.
//
// One flag, set by one function, read everywhere. Ontraport fires when a membership is
// cancelled; this marks that member `left`; and from that moment they stop generating work —
// no member-journey touchpoints, no birthday task, nothing in either count — while keeping
// their record, their history and their place on the Birthdays tab under Left, where sending
// a card is a decision somebody makes rather than a task somebody is handed.
//
// The function's own half is held to the same standard as set-dob.js: the door is locked, a
// no-match creates NOTHING and still answers 200 so the Zap does not auto-pause, and a
// successful match writes one field on one record and nothing else anywhere.
const assert = require("assert");
const path = require("path");
const { boot, daysFromToday } = require("./lib/env.cjs");

const MODULE = path.join(__dirname, "..", "netlify", "functions", "mark-member-left.js");

// The function reads its env into module-level consts, so a config change needs a fresh
// require. Everything defaults to a working setup; pass null to unset a var.
function load(env) {
  const base = {
    SUPABASE_URL: "https://proj.supabase.co",
    SUPABASE_SERVICE_KEY: "service-key",
    WEBHOOK_SECRET: "s3cret",
  };
  const merged = Object.assign({}, base, env || {});
  Object.keys(merged).forEach((k) => {
    if (merged[k] === null) delete process.env[k];
    else process.env[k] = merged[k];
  });
  delete require.cache[require.resolve(MODULE)];
  return require(MODULE);
}

// Stub Supabase: a GET returns the member row, a POST is the write-back.
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

async function run(mod, event) {
  const logs = [];
  const real = console.log;
  console.log = (...a) => logs.push(a.join(" "));
  try {
    const res = await mod.handler(event);
    return { status: res.statusCode, body: JSON.parse(res.body), logs };
  } finally { console.log = real; }
}

const memberList = () => ([
  { id: "r1", name: "Sarah Doyle", coach: "Dan", email: "Sarah@Example.com", dob: "1990-04-23",
    notes: "<b>knee</b>", joined: 1700000000000, left: false,
    completed: ["welcome_card"], missed: [], doneMeta: {}, attendance: { "2026-W20": {} } },
  { id: "r2", name: "Mark Ellison", coach: "Grace", email: "mark@example.com", left: false },
  { id: "r3", name: "Gone Already", coach: "Ash", email: "gone@example.com", left: true },
  { id: "r4", name: "No Email", coach: "Ash" },
]);

(async () => {

/* ---------- 1: the door is locked, exactly as set-dob.js locks it ---------- */
{
  const mod = load();
  stubFetch(memberList());
  assert.strictEqual((await run(mod, ev({}, { method: "GET" }))).status, 405, "GET is refused");
  assert.strictEqual((await run(mod, ev({ email: "sarah@example.com" }, { secret: "wrong" }))).status, 401,
    "a wrong secret gets nothing");
  assert.strictEqual((await run(mod, ev({ email: "sarah@example.com" }, { secret: null }))).status, 401,
    "…and so does no secret at all");

  const noSecret = load({ WEBHOOK_SECRET: null });
  assert.strictEqual((await run(noSecret, ev({ email: "sarah@example.com" }))).status, 401,
    "with no secret configured, nothing gets in");

  const noDb = load({ SUPABASE_URL: null });
  assert.strictEqual((await run(noDb, ev({ email: "sarah@example.com" }))).status, 500,
    "and an unconfigured server says so rather than half-working");

  // the header is accepted as well as the query string, same as the others
  const mod2 = load();
  stubFetch(memberList());
  const viaHeader = await run(mod2, ev({ email: "mark@example.com" },
    { secret: null, headers: { "x-webhook-secret": "s3cret" } }));
  assert.strictEqual(viaHeader.status, 200, "the secret may travel in the header instead");
}

/* ---------- 2: a matched member is marked left, and only that ----------
   One field, on one record. Everything else about them is what a membership ending is not a
   reason to lose. */
{
  const mod = load();
  const list = memberList();
  const calls = stubFetch(list);
  const r = await run(mod, ev({ email: "sarah@example.com" }));

  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.result, "updated");
  assert.strictEqual(r.body.matched, true);
  assert.strictEqual(r.body.left, true);
  assert.strictEqual(r.body.id, "r1", "the right member");
  assert.strictEqual(r.body.matchedBy, "email");

  const write = calls.find((c) => c.method === "POST");
  assert.ok(write, "the member list was written back");
  assert.strictEqual(write.body.key, "retention",
    "…to the MEMBER row. This function cannot touch a challenger: it never reads the roster");
  const saved = write.body.value.find((m) => m.id === "r1");
  assert.strictEqual(saved.left, true, "the flag is set");

  // …and nothing else on the record moved
  const before = memberList()[0];
  for (const k of Object.keys(before)) {
    if (k === "left") continue;
    assert.deepStrictEqual(JSON.parse(JSON.stringify(saved[k])), JSON.parse(JSON.stringify(before[k])),
      k + " is untouched — a cancellation is not a reason to lose it");
  }
  // …nor anybody else's
  assert.deepStrictEqual(write.body.value.filter((m) => m.id !== "r1").map((m) => m.left),
    [false, true, undefined], "no other member's flag was touched");

  assert.ok(r.logs.some((l) => /UPDATED: "Sarah Doyle"/.test(l)), "the log says who");
  assert.ok(r.logs.some((l) => /PAYLOAD received/.test(l)), "…and what arrived");
  assert.ok(r.logs.some((l) => /RECEIVED: cancellation/.test(l)), "…and what it read out of it");
}

/* ---------- 3: email is matched the way people type it ---------- */
{
  for (const sent of ["Sarah@Example.com", "sarah@example.com", "  SARAH@EXAMPLE.COM  "]) {
    const mod = load();
    const calls = stubFetch(memberList());
    const r = await run(mod, ev({ email: sent }));
    assert.strictEqual(r.body.id, "r1", "matched on " + JSON.stringify(sent));
    assert.ok(calls.some((c) => c.method === "POST"), "…and written");
  }

  // the field name Ontraport happens to use does not matter
  for (const key of ["email", "contact_email", "Email"]) {
    const mod = load();
    stubFetch(memberList());
    const r = await run(mod, ev({ [key]: "mark@example.com" }));
    assert.strictEqual(r.body.id, "r2", "read from " + key);
  }

  // form-encoded arrives the same as JSON
  const mod = load();
  stubFetch(memberList());
  const form = await run(mod, ev({ email: "mark@example.com" }, { form: true }));
  assert.strictEqual(form.body.result, "updated", "a form-encoded body works too");
}

/* ---------- 4: marking somebody left twice is a no-op success ----------
   Zapier retries, and a coach can re-run a Zap by hand. Neither should write, because a write
   is a sync to every open device for nothing — and neither is an error. */
{
  const mod = load();
  const calls = stubFetch(memberList());
  const r = await run(mod, ev({ email: "gone@example.com" }));

  assert.strictEqual(r.status, 200, "…and it is a success");
  assert.strictEqual(r.body.result, "unchanged");
  assert.strictEqual(r.body.matched, true);
  assert.strictEqual(r.body.left, true, "they are left, which is what was asked for");
  assert.ok(!calls.some((c) => c.method === "POST"), "nothing was written");
  assert.ok(r.logs.some((l) => /UNCHANGED/.test(l)), "…and the log says why");

  // and running the real thing twice ends in the same place
  const mod2 = load();
  const list = memberList();
  stubFetch(list);
  await run(mod2, ev({ email: "mark@example.com" }));
  const second = await run(load(), ev({ email: "mark@example.com" }));
  assert.strictEqual(second.body.result, "unchanged", "the second run has nothing left to do");
  assert.strictEqual(list.find((m) => m.id === "r2").left, true, "…and they are still left");
}

/* ---------- 5: no match creates nothing, changes nothing, and stays calm ----------
   A 200, deliberately. Zapier auto-pauses a Zap that keeps erroring, and somebody who
   cancelled before they were ever on the tracker is the ordinary case, not a fault. */
{
  const mod = load();
  const list = memberList();
  const calls = stubFetch(list);
  const r = await run(mod, ev({ email: "nobody@example.com", name: "Nobody At All" }));

  assert.strictEqual(r.status, 200, "a no-match is a 200 — a paused Zap is worse than a miss");
  assert.strictEqual(r.body.matched, false);
  assert.strictEqual(r.body.result, "no_match");
  assert.strictEqual(r.body.reason, "not_found");
  assert.strictEqual(r.body.memberCount, 4, "…and says how many it looked through");
  assert.ok(/Nothing was created or changed/.test(r.body.note), "…in words, for the Zap history");
  assert.ok(!calls.some((c) => c.method === "POST"), "nothing was written");
  assert.strictEqual(list.length, 4, "nobody was created");
  assert.ok(r.logs.some((l) => /NO MATCH/.test(l)), "and it is loud in the log");

  // an empty member list is the same answer, not a crash
  const empty = load();
  stubFetch([]);
  const e = await run(empty, ev({ email: "nobody@example.com" }));
  assert.strictEqual(e.status, 200);
  assert.strictEqual(e.body.result, "no_match");
  assert.strictEqual(e.body.memberCount, 0);

  // a payload with nothing to match on is a 400: that is a broken Zap, not a missing person
  const bad = load();
  stubFetch(memberList());
  const b = await run(bad, ev({ tag: "cancelled" }));
  assert.strictEqual(b.status, 400, "no email and no name is a bad request");
  assert.deepStrictEqual(b.body.keysReceived, ["tag"], "…and it says what it did get");
}

/* ---------- 6: email is the key, and an ambiguous name matches NOBODY ----------
   set-dob.js guesses between two people who share a name, and it is right to: the worst it
   can do is put a date of birth on the wrong Sarah. The worst this can do is cancel a member
   who is still paying us, so it refuses instead. */
{
  const { findMember } = load().__test;
  const twoSarahs = [
    { id: "a", name: "Sarah Doyle", email: "sarah.a@example.com" },
    { id: "b", name: "Sarah Doyle", email: "sarah.b@example.com" },
  ];
  assert.strictEqual(findMember(twoSarahs, "", "Sarah Doyle").member, null,
    "two members share the name and no email came: nobody is cancelled");
  assert.strictEqual(findMember(twoSarahs, "", "Sarah Doyle").by, "ambiguous-name");
  assert.strictEqual(findMember(twoSarahs, "sarah.b@example.com", "Sarah Doyle").member.id, "b",
    "…and the email settles it outright");

  // a name IS accepted when it is unambiguous and no email was sent
  assert.strictEqual(findMember(memberList(), "", "  mark   ELLISON ").member.id, "r2",
    "one member, one name, no email: matched");

  // an email that matches nobody does NOT fall through to the name. An address is a claim
  // about which person this is; a name that happens to agree does not make it a different one.
  assert.strictEqual(findMember(memberList(), "someone.else@example.com", "Sarah Doyle").member, null,
    "an email that matches nobody is a no-match, not a reason to try the name");

  // …and the handler reports that refusal as a no-match, calmly
  const mod = load();
  const calls = stubFetch(twoSarahs);
  const r = await run(mod, ev({ name: "Sarah Doyle" }));
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.result, "no_match");
  assert.strictEqual(r.body.reason, "ambiguous_name");
  assert.ok(!calls.some((c) => c.method === "POST"), "and nothing was written");
  assert.ok(r.logs.some((l) => /share the name/.test(l)), "the log says exactly why");
}

/* ---------- 7: a broken backend is a 500, not a silent success ---------- */
{
  const readFail = load();
  stubFetch(memberList(), { readFails: true });
  assert.strictEqual((await run(readFail, ev({ email: "sarah@example.com" }))).status, 500);

  const writeFail = load();
  stubFetch(memberList(), { writeFails: true });
  const w = await run(writeFail, ev({ email: "sarah@example.com" }));
  assert.strictEqual(w.status, 500, "a failed write is reported, not swallowed");
  assert.ok(w.logs.some((l) => /ERROR during read\/write/.test(l)));
}

/* ---------- 8: what the flag DOES, in the app ----------
   The function's whole purpose. A left member raises no member-journey work and no birthday
   task, counts towards neither, and is still on the Birthdays tab under Left. */
{
  const Y = new Date().getFullYear(), pad = (n) => String(n).padStart(2, "0");
  const t = new Date();
  const dobToday = (Y - 40) + "-" + pad(t.getMonth() + 1) + "-" + pad(t.getDate());
  const member = (id, name, extra) => Object.assign({
    id, name, coach: "Gaz", email: id + "@example.com", dob: dobToday,
    joined: daysFromToday(-40),          // day 40: their day-30 check-in is due, in grace
    completed: [], missed: [], doneMeta: {}, attendance: {}, notes: "",
  }, extra || {});

  const app = boot({ retention: [member("r1", "Stayed Sam"), member("r2", "Gone Gail", { left: true })] });

  // the member journey
  assert.deepStrictEqual([...app.ctx.memberDueToday(app.findMember("r1"))].map((i) => i.id),
    ["welcome_card", "day30"], "sanity: a member with us has work due");
  assert.deepStrictEqual([...app.ctx.memberDueToday(app.findMember("r2"))], [],
    "a member who has left needs nothing — no welcome card, no day 30, no anniversary");

  const ret = app.html("retTodayList");
  assert.ok(ret.includes("Stayed Sam"), "she is on the retention Today's moves");
  assert.ok(!ret.includes("Gone Gail"),
    "…and the member who cancelled is not on it at all: no touchpoint and no birthday");
  assert.ok(!ret.includes('id="act-r2-birthday"'), "…including her birthday task specifically");
  assert.ok(ret.includes('id="act-r1-birthday"'), "…while hers is still there");

  // the counts follow, because they are counted off the same rows
  const withBoth = Number(app.el("retTodayCount").textContent);
  const alone = Number(boot({ retention: [member("r1", "Stayed Sam")] }).el("retTodayCount").textContent);
  assert.strictEqual(withBoth, alone,
    "a left member adds nothing to the count — the day reads the same as if she were not there");

  // but the record is all still there, and so is she
  const gail = app.findMember("r2");
  assert.strictEqual(gail.name, "Gone Gail", "the record is intact");
  assert.strictEqual(gail.dob, dobToday, "…date of birth and all");
  assert.ok(app.html("retMemberList").includes("Gone Gail"), "…and she is still on the Members list");

  // …and on the Birthdays tab, under Left, where a card is a decision
  assert.ok(!app.html("birthdayList").includes("Gone Gail"), "not on the routine birthday list");
  app.ctx.setBirthdayFilter("left");
  assert.ok(app.html("birthdayList").includes("Gone Gail"), "…on the Left one, which is the point");
  assert.ok(/toggleBirthdayActioned\('r2','retention'\)/.test(app.html("birthdayList")),
    "…with her controls, writing back to the member roster");

  // one flag, one check, read in both places
  assert.strictEqual(app.ctx.hasLeft(gail), true, "hasLeft is what both of them ask");
  assert.strictEqual(app.ctx.birthdayDue(gail), false, "…the birthday gate");
  assert.deepStrictEqual([...app.ctx.memberDueToday(gail)], [], "…and the journey gate");
}

console.log("mark-member-left.test.cjs: OK");
})();
