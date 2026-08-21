// A challenger created by the new-challenger webhook has to survive the whole round trip:
// written by the Netlify function, pulled out of Supabase by the app, migrated, rendered —
// and, crucially, NOT deleted by a browser tab that was already open when she was created.
//
// That last one is the bug this file exists for. The roster is a single JSON blob, so every
// save() is a whole-list write. A tab that loaded before the webhook fired holds a list that
// doesn't contain her, and before the fix its next save() flattened her out of the row: the
// function logged SUCCESS, the record really was in Supabase, and then a coach ticked a
// touchpoint and she was gone for good.
//
// The record under test is not a hand-written copy of the function's output — it is whatever
// the REAL handler writes, captured through a stubbed fetch, so this test fails if the two
// shapes ever drift apart again.
const assert = require("assert");
const path = require("path");
const { boot, daysFromToday, settle } = require("./lib/env.cjs");

/* ---------- run the real Netlify function and capture what it wrote ---------- */
function runFunction(payload, startingRoster) {
  const URL = "https://test.supabase.co";
  process.env.SUPABASE_URL = URL;
  process.env.SUPABASE_SERVICE_KEY = "service-key";
  process.env.WEBHOOK_SECRET = "s3cret";

  const written = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (!opts || (opts.method || "GET") === "GET") {
      assert.ok(url.includes("key=eq.roster"), "the function reads the roster row: " + url);
      return { ok: true, status: 200, json: async () => [{ value: startingRoster || [] }] };
    }
    assert.ok(url.includes("on_conflict=key"), "the function upserts on key: " + url);
    written.push(JSON.parse(opts.body));
    return { ok: true, status: 201, text: async () => "" };
  };

  const modPath = path.join(__dirname, "..", "netlify", "functions", "new-challenger.js");
  delete require.cache[require.resolve(modPath)];
  const fn = require(modPath);

  return fn
    .handler({
      httpMethod: "POST",
      queryStringParameters: { secret: "s3cret" },
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    })
    .then((res) => {
      globalThis.fetch = realFetch;
      return { res, body: JSON.parse(res.body), written };
    })
    .catch((e) => { globalThis.fetch = realFetch; throw e; });
}

// The one record every assertion below is about, straight from the function.
let SOPHIE = null;

/* ---------- 1: the function writes the shape the CURRENT app expects ---------- */
(async () => {
  const { res, body, written } = await runFunction({
    firstname: "Sophie", lastname: "Webhook", email: "S.Webhook@Example.com", coach: "Grace",
  });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.created, "Sophie Webhook");
  assert.strictEqual(written.length, 1, "one upsert");
  assert.strictEqual(written[0].key, "roster", "…to the SAME row the onboarding tracker reads");
  assert.ok(Array.isArray(written[0].value), "the row value stays an array");

  SOPHIE = written[0].value[0];
  assert.strictEqual(SOPHIE.name, "Sophie Webhook");
  assert.strictEqual(SOPHIE.coach, "Grace");
  assert.strictEqual(SOPHIE.email, "s.webhook@example.com", "email is normalised for set-dob matching");
  assert.strictEqual(SOPHIE.firstSessionDone, false, "a webhook challenger has not started");
  assert.strictEqual(SOPHIE.day0, null);

  // Every field the app's own migration would otherwise have to back-fill is already there,
  // so what lands in Supabase is complete rather than repaired later by whoever opens the app.
  const app = boot({ members: [] });
  const before = JSON.parse(JSON.stringify(SOPHIE));
  const after = app.ctx.migrateList([JSON.parse(JSON.stringify(SOPHIE))])[0];
  assert.deepStrictEqual(after, before, "migrateList has nothing left to add to a function-written record");
  for (const k of ["missed", "notes", "followUpOn", "followUpStatus", "checks", "doneMeta", "completed", "outcome", "dob"]) {
    assert.ok(k in SOPHIE, "the function writes `" + k + "`");
  }

  /* ---------- 2: she loads and renders through the current code path ---------- */
  {
    // raw: no migration at all, so this is the record EXACTLY as Supabase holds it
    const a = boot({ members: [JSON.parse(JSON.stringify(SOPHIE))], raw: true });
    const cards = a.html("memberList");
    assert.ok(cards.includes("Sophie Webhook"), "she renders on the Challengers tab");
    assert.ok(cards.includes("Not started"), "…as a not-started challenger");
    assert.ok(cards.includes("Coach Grace"), "…with her coach");
    assert.ok(a.html("todayList").includes("Sophie Webhook"), "her intro is on Today's moves");
    // the masthead figure counts who is ON the journey, and her clock has not started yet:
    // she is waiting on a first session, which is what Today's moves is telling the coach
    assert.strictEqual(a.el("liveCount").textContent, "0", "she is not on the journey until her clock starts");
    a.ctx.renderMemberTable();
    assert.ok(a.html("todayTable").includes("Sophie Webhook"), "…and she is in the whole-journey table");
  }

  /* ---------- 3: no filter or default view hides her ---------- */
  {
    const a = boot({ members: [JSON.parse(JSON.stringify(SOPHIE))], raw: true });
    // she is booked in with no outcome recorded, so she is an open case: Currently Active,
    // which is also the tab the screen opens on. A challenger the webhook just created must
    // never land on a screen that is filtered past her.
    assert.strictEqual(a.ctx.__t.memberFilter, "active", "the screen opens on Currently Active");
    assert.ok(a.html("memberList").includes("Sophie Webhook"), "…and she is on it, with no tap");

    // and every other tab legitimately excludes her — she is in exactly one of the five
    for (const f of ["stayed", "paused", "leftfu", "left"]) {
      a.ctx.setMemberFilter(f);
      assert.ok(!a.html("memberList").includes("Sophie Webhook"), "tab '" + f + "' correctly excludes her");
    }
  }

  /* ---------- 4: the real cloud boot path shows her ---------- */
  const ELLIE = {
    id: "m1", name: "Existing Ellie", booked: daysFromToday(-10), day0: daysFromToday(-10),
    firstSessionDone: true, coach: "Dan", personal: "", dob: null, extraDays: 0, pausedDays: 0,
    pausedAt: null, signedUp: false, outcome: null, completed: [], missed: [], doneMeta: {},
    checks: {}, followUpOn: null, followUpStatus: null, notes: "",
  };
  {
    const a = boot({ cloud: { rows: { roster: [ELLIE, SOPHIE], seeded: true } }, render: false });
    await a.ctx.bootData();
    assert.deepStrictEqual(a.members().map((m) => m.name), ["Existing Ellie", "Sophie Webhook"],
      "both load, in row order");
    const cards = a.html("memberList");
    assert.ok(cards.includes("Sophie Webhook"));
    // the cards are sorted by start date, so a not-started challenger leads the list
    assert.ok(cards.indexOf("Sophie Webhook") < cards.indexOf("Existing Ellie"),
      "the not-started challenger sorts to the top of the cards");
  }

  /* ---------- 5: THE REGRESSION — a stale tab must not delete her ---------- */
  {
    // A coach has the app open. It loaded BEFORE the webhook fired.
    const a = boot({ cloud: { rows: { roster: [ELLIE], seeded: true } }, render: false });
    await a.ctx.bootData();
    assert.deepStrictEqual(a.members().map((m) => m.name), ["Existing Ellie"]);

    // The webhook lands in Supabase. Realtime is NOT emitted — that is the production
    // reality this test is modelling: the channel never subscribed, so nothing arrives.
    a.cloud.table.set("roster", [ELLIE, SOPHIE]);

    // The coach ticks a touchpoint on somebody else. Before the fix, this deleted Sophie.
    a.ctx.toggleDone("m1", "d1_text", true);
    await settle(700);

    const pushed = a.cloud.lastWriteTo("roster").value.map((m) => m.name);
    assert.ok(pushed.includes("Sophie Webhook"),
      "a whole-list push must not delete a challenger this tab never saw — pushed: " + pushed.join(", "));
    assert.ok(pushed.includes("Existing Ellie"), "…and must not lose the coach's own edit");
    assert.ok(a.cloud.table.get("roster").some((m) => m.name === "Sophie Webhook"),
      "she survives in Supabase");

    // …and the coach can now actually see her, without reloading
    assert.ok(a.members().some((m) => m.name === "Sophie Webhook"), "she is folded into the open tab");
    assert.ok(a.html("memberList").includes("Sophie Webhook"), "…and rendered");
    // the edit that triggered all this is still intact
    assert.ok(a.find("m1").completed.includes("d1_text"), "the coach's tick survived the merge");
  }

  /* ---------- 6: a deliberate removal is NOT resurrected ---------- */
  {
    const a = boot({ cloud: { rows: { roster: [ELLIE, SOPHIE], seeded: true } }, render: false });
    await a.ctx.bootData();
    a.ctx.removeMember(SOPHIE.id);          // confirm() is stubbed true
    await settle(700);
    const pushed = a.cloud.lastWriteTo("roster").value.map((m) => m.name);
    assert.deepStrictEqual(pushed, ["Existing Ellie"],
      "removing somebody the tab HAS seen is a real deletion, not a gap to be back-filled");
    assert.ok(!a.members().some((m) => m.id === SOPHIE.id), "and she stays gone locally");
  }

  /* ---------- 7: a background refresh picks her up without a reload ---------- */
  {
    const a = boot({ cloud: { rows: { roster: [ELLIE], seeded: true } }, render: false });
    await a.ctx.bootData();
    a.cloud.table.set("roster", [ELLIE, SOPHIE]);
    assert.ok(!a.html("memberList").includes("Sophie Webhook"), "not there yet");
    await a.ctx.refreshFromCloud();          // what the poll / tab-focus handler calls
    assert.ok(a.members().some((m) => m.name === "Sophie Webhook"), "the poll finds her");
    assert.ok(a.html("memberList").includes("Sophie Webhook"), "…and renders her");
    // a second pass changes nothing — folding in is idempotent
    const n = a.members().length;
    await a.ctx.refreshFromCloud();
    assert.strictEqual(a.members().length, n, "no duplicate on the next poll");
  }

  /* ---------- 8: the retention side is untouched by any of this ---------- */
  {
    const MEMBER = { id: "r1", name: "Member Mo", email: "", coach: "Dan", personal: "", notes: "",
      dob: null, joined: daysFromToday(-5), fromChallenger: null, completed: [], missed: [],
      doneMeta: {}, attendance: {} };
    const a = boot({ cloud: { rows: { roster: [ELLIE], retention: [MEMBER], seeded: true } }, render: false });
    await a.ctx.bootData();
    assert.deepStrictEqual(a.retention().map((m) => m.name), ["Member Mo"], "members still load");
    // a webhook challenger arriving must not disturb the member list's own push
    a.cloud.table.set("roster", [ELLIE, SOPHIE]);
    a.ctx.saveRetention();
    await settle(700);
    assert.deepStrictEqual(a.cloud.lastWriteTo("retention").value.map((m) => m.name), ["Member Mo"]);
    assert.ok(a.cloud.table.get("roster").some((m) => m.name === "Sophie Webhook"),
      "and the roster row is left alone by a retention save");
  }

  /* ---------- 9: the function's duplicate guard still holds ---------- */
  {
    const again = await runFunction({ name: "Sophie Webhook" }, [SOPHIE]);
    assert.strictEqual(again.body.skipped, "duplicate", "a repeated webhook does not create a second record");
    assert.strictEqual(again.written.length, 0, "…and writes nothing");
  }

  console.log("webhook-challenger.test.cjs: OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
