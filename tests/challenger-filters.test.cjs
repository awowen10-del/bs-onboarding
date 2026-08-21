// The Challengers screen's FILTER TABS — the five states a challenger can be in, as a row of
// tabs instead of a dropdown.
//
// The dropdown could afford overlapping answers. "Everyone", "Active (live + paused)" and
// "Paused only" all returned the same paused person, and that was harmless because you only
// ever saw one of them at a time. A ROW of tabs with counts on it is not a set of queries —
// it is read as a breakdown of the roster, and the whole file exists to hold it to that:
//
//   MUTUALLY EXCLUSIVE   nobody is in two tabs, so the counts never add to more than there are
//   COLLECTIVELY EXHAUSTIVE   nobody is in none of them, so nobody is invisible on this screen
//
// Those two are asserted directly, against a roster built to hold one of every shape a
// challenger record comes in — including the awkward ones that only exist because a coach
// tapped something twice.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { boot, daysFromToday, dateInput } = require("./lib/env.cjs");

const HTML = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const SECTION = /<section class="view" id="view-members"[\s\S]*?<\/section>/.exec(HTML)[0];

const base = (id, name, extra) => Object.assign({
  id, name, coach: "Grace", dob: null, personal: "",
  day0: daysFromToday(-8), booked: daysFromToday(-8), firstSessionDone: true,
  completed: ["intro"], doneMeta: {}, checks: {}, missed: [],
  outcome: null, signedUp: false, extraDays: 0, pausedDays: 0, pausedAt: null,
  followUpOn: null, followUpStatus: null, notes: "",
}, extra || {});

// one of every shape, and which tab each of them belongs to
const ROSTER = [
  ["active", base("new", "Ned NotStarted", { firstSessionDone: false, day0: null, booked: daysFromToday(3) })],
  ["active", base("run", "Ruby Running")],
  ["active", base("fin", "Fay Finished", { day0: daysFromToday(-60), booked: daysFromToday(-60) })],
  ["stayed", base("sty", "Sam Stayed", { outcome: "stayed", signedUp: true })],
  ["paused", base("pau", "Pat Paused", { pausedAt: daysFromToday(-2) })],
  ["leftfu", base("lfu", "Lyn LeftPending", { outcome: "left",
    followUpOn: daysFromToday(20), followUpStatus: "pending" })],
  ["left", base("lef", "Lee Left", { outcome: "left" })],
  // a Left whose follow-up has been DONE is closed again — the date stays as a record, and a
  // record of something finished is not a job on anybody's desk
  ["left", base("ldn", "Dot Done", { outcome: "left",
    followUpOn: daysFromToday(-20), followUpStatus: "done" })],
  // the awkward ones: a decision recorded on somebody whose clock was left stopped
  ["stayed", base("sp", "Stan Paused-Stayed", { outcome: "stayed", pausedAt: daysFromToday(-5) })],
  ["left", base("lp", "Lou Paused-Left", { outcome: "left", pausedAt: daysFromToday(-5) })],
];
const members = () => ROSTER.map(([, m]) => JSON.parse(JSON.stringify(m)));
const expectedTab = (id) => (ROSTER.find(([, m]) => m.id === id) || [])[0];

// the filter row as the app renders it, split into one string per tab
const tabs = (app) => app.html("memberFilters").split("<button").slice(1);
const tabFor = (app, id) => tabs(app).find((t) => t.includes('data-filter="' + id + '"')) || "";
const badge = (t) => {
  const m = /<span class="count tally">(\d+)<\/span>/.exec(t);
  return m ? Number(m[1]) : null;
};
const names = (app) => ROSTER.map(([, m]) => m.name).filter((n) => app.html("memberList").includes(n));

/* ---------- 1: the dropdown is gone, and the row stands where it was asked to ---------- */
{
  assert.ok(!/<select id="filter"/.test(HTML), "the filter dropdown is removed, not hidden");
  // the section markup, not the whole file: MEMBER_FILTERS' comment names the old option it
  // replaced, and a note about why something changed is not the thing still being there
  assert.ok(!/Active \(live \+ paused\)/.test(SECTION), "…and its options with it");
  for (const gone of ["Everyone", "Finished 6 weeks", "Left / inactive", "Paused only"]) {
    assert.ok(!new RegExp(">" + gone + "<").test(SECTION),
      "the old option “" + gone + "” is gone from the Challengers screen");
  }
  assert.ok(/<div class="filterbar" id="memberFilters"/.test(SECTION), "the filter row replaces it");
  assert.ok(SECTION.indexOf('id="convBar"') < SECTION.indexOf('id="memberFilters"'),
    "…below the conversion stats");
  assert.ok(SECTION.indexOf('id="memberFilters"') < SECTION.indexOf('id="search"'),
    "…and above the search box");
  // the two controls that were asked to stay, stayed
  assert.ok(/id="search"/.test(SECTION) && /openAdd\(\)/.test(SECTION),
    "the search box and “+ Add challenger” are still on the screen");
  assert.ok(SECTION.indexOf('id="memberFilters"') < SECTION.indexOf("openAdd()"),
    "…in the toolbar under the row");
}

/* ---------- 2: five tabs, named and ordered as asked, each one its own button ---------- */
{
  const app = boot({ members: members() });
  const row = tabs(app);
  assert.strictEqual(row.length, 5, "five tabs, no more and no fewer");
  assert.deepStrictEqual(row.map((t) => /data-filter="([^"]+)"/.exec(t)[1]),
    ["active", "stayed", "paused", "leftfu", "left"], "in the order they were asked for");
  const labels = ["Currently Active", "Stayed On", "Paused", "Left &amp; Needs Followup", "Left"];
  row.forEach((t, i) => assert.ok(t.includes(labels[i]), "tab " + i + " reads “" + labels[i] + "”"));

  // separate buttons in a row, wearing the same surface as the nav tabs above them
  assert.ok(row.every((t) => /^ type="button"/.test(t)), "each tab is its own button element");
  const CSS = HTML.slice(HTML.indexOf("<style>") + 7, HTML.indexOf("</style>"));
  const RULES = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((m) => ({ sel: m[1].trim().replace(/\/\*[\s\S]*?\*\//g, "").trim(), body: m[2] }))
    .filter((r) => r.sel && !r.sel.startsWith("@"));
  const selOf = (sel) => RULES.filter((r) => r.sel.split(",").map((x) => x.trim()).includes(sel));
  const outer = selOf(".filterbar");
  assert.ok(outer.length, ".filterbar is styled");
  assert.ok(outer.some((r) => /gap\s*:/.test(r.body)) && outer.some((r) => /flex-wrap\s*:\s*wrap/.test(r.body)),
    "the row spaces its tabs apart and wraps rather than hiding one off a narrow screen");
  for (const r of outer) {
    assert.ok(!/(^|;)\s*background\s*:/.test(r.body) && !/(^|;)\s*border\s*:/.test(r.body),
      ".filterbar must not become a bar with the tabs inside it. Found: " + r.body.trim());
  }
  const item = selOf(".filterbar button");
  assert.ok(item.length, ".filterbar button is styled");
  for (const prop of ["background", "border", "border-radius"]) {
    assert.ok(new RegExp("(^|;)\\s*" + prop + "\\s*:").test(item[0].body),
      ".filterbar button needs its own `" + prop + "` — it is a surface, not a label");
  }
  assert.ok(selOf('.filterbar button[aria-selected="true"]').some((r) => /background:var\(--orange\)/.test(r.body)),
    "the selected tab takes the accent fill, the same as the nav tabs");
}

/* ---------- 3: it opens on Currently Active ---------- */
{
  const app = boot({ members: members() });
  assert.strictEqual(app.ctx.__t.memberFilter, "active", "Currently Active is the default");
  assert.ok(/data-filter="active"/.test(tabFor(app, "active")));
  assert.ok(/aria-selected="true"/.test(tabFor(app, "active")), "…and it is the one marked selected");
  for (const id of ["stayed", "paused", "leftfu", "left"]) {
    assert.ok(/aria-selected="false"/.test(tabFor(app, id)), id + " is not selected");
  }
  // and it is showing the open cases, with nobody's decision already recorded among them
  assert.deepStrictEqual(names(app).sort(), ["Fay Finished", "Ned NotStarted", "Ruby Running"]);
}

/* ---------- 4: each tab shows its own group and nobody else's ---------- */
{
  const app = boot({ members: members() });
  const expected = {};
  ROSTER.forEach(([tab, m]) => (expected[tab] = (expected[tab] || []).concat(m.name)));

  for (const id of ["active", "stayed", "paused", "leftfu", "left"]) {
    assert.strictEqual(app.ctx.setMemberFilter(id), id, "selecting " + id + " sticks");
    assert.deepStrictEqual(names(app).sort(), expected[id].slice().sort(),
      "the " + id + " tab lists exactly its own group");
    assert.ok(/aria-selected="true"/.test(tabFor(app, id)), "…and is highlighted while it does");
    assert.strictEqual(tabs(app).filter((t) => /aria-selected="true"/.test(t)).length, 1,
      "…and is the only one that is");
  }

  // an id that is not a tab changes nothing rather than emptying the screen
  const before = app.html("memberList");
  assert.strictEqual(app.ctx.setMemberFilter("everyone"), "left", "an unknown tab is ignored");
  assert.strictEqual(app.html("memberList"), before, "…and the list does not move");
}

/* ---------- 5: the five are a partition — exactly one tab each, and everybody in one ----------
   Stated twice on purpose. Once against the rules themselves, which is the property that has
   to survive an edit to MEMBER_FILTERS; and once against the counts the row puts on screen,
   because a breakdown whose parts do not add up to the whole is worse than no breakdown. */
{
  const app = boot({ members: members() });
  const FILTERS = [...app.ctx.__t.MEMBER_FILTERS];
  assert.strictEqual(FILTERS.length, 5);

  for (const m of app.members()) {
    const hits = FILTERS.filter((f) => f.match(m)).map((f) => f.id);
    assert.strictEqual(hits.length, 1,
      m.name + " must be in exactly one tab, and is in " + (hits.length ? hits.join(" + ") : "none"));
    assert.strictEqual(hits[0], expectedTab(m.id), m.name + " is on the tab their state says");
  }

  const counts = tabs(app).map(badge);
  assert.ok(counts.every((n) => n !== null), "every tab carries a count badge");
  assert.strictEqual(counts.reduce((a, b) => a + b, 0), app.members().length,
    "the badges add up to the roster exactly — no double counting, nobody dropped");
}

/* ---------- 6: the badges are the group sizes, and they follow the search ---------- */
{
  const app = boot({ members: members() });
  const counted = (id) => badge(tabFor(app, id));
  assert.strictEqual(counted("active"), 3);
  assert.strictEqual(counted("stayed"), 2);
  assert.strictEqual(counted("paused"), 1);
  assert.strictEqual(counted("leftfu"), 1);
  assert.strictEqual(counted("left"), 3);

  // typing a name turns the row into "where is this person" — the useful answer mid-search
  app.el("search").value = "Lyn";
  app.ctx.renderMembers();
  assert.strictEqual(counted("leftfu"), 1, "the badge points at the tab she is on");
  for (const id of ["active", "stayed", "paused", "left"]) {
    assert.strictEqual(counted(id), 0, "…and the tabs she is not on read zero");
  }

  // the badges never disagree with the list underneath them
  for (const id of ["active", "stayed", "paused", "leftfu", "left"]) {
    app.ctx.setMemberFilter(id);
    assert.strictEqual(counted(id), names(app).length,
      "the " + id + " badge is the number of cards it shows");
  }
}

/* ---------- 7: the search looks INSIDE the selected tab, not across all of them ---------- */
{
  const app = boot({ members: members() });
  app.el("search").value = "Lyn";                 // she is a Left with a follow-up booked
  app.ctx.setMemberFilter("active");
  assert.deepStrictEqual(names(app), [], "searching a tab she is not on finds nobody");
  assert.ok(app.html("memberList").includes("No challengers here yet"), "…and says so");

  app.ctx.setMemberFilter("leftfu");
  assert.deepStrictEqual(names(app), ["Lyn LeftPending"], "…and finds her on the tab she is on");

  // and clearing it puts the rest of the tab back
  app.el("search").value = "";
  app.ctx.renderMembers();
  assert.deepStrictEqual(names(app), ["Lyn LeftPending"]);
  app.ctx.setMemberFilter("left");
  assert.strictEqual(names(app).length, 3, "the other Lefts were never gone, only unsearched");
}

/* ---------- 8: Left splits on whether there is a job still to do ----------
   Driven through the buttons a coach actually presses — book the follow-up, then make it —
   so the split is asserted against the real path rather than against two fields set by hand. */
{
  const app = boot({ members: [base("x", "Xan Ex", { outcome: "left" })] });
  const showing = () => app.html("memberList").includes("Xan Ex");

  app.ctx.setMemberFilter("left");
  assert.strictEqual(showing(), true, "a plain Left starts on Left");
  app.ctx.setMemberFilter("leftfu");
  assert.strictEqual(showing(), false, "…and not on Left & Needs Followup");

  // booking one moves them across
  app.ctx.openFollowUp("x");
  app.el("fu-date").value = dateInput(daysFromToday(14));
  app.ctx.confirmFollowUp();
  assert.strictEqual(showing(), true, "booking a follow-up puts them on Left & Needs Followup");
  app.ctx.setMemberFilter("left");
  assert.strictEqual(showing(), false, "…and takes them off Left");

  // making it closes them again — the date stays as a record, but it is not a job any more
  app.ctx.followUpDone("x");
  assert.strictEqual(showing(), true, "a follow-up that has been made sends them back to Left");
  assert.strictEqual(app.find("x").followUpOn !== null, true, "…with the date kept as a record");
  app.ctx.setMemberFilter("leftfu");
  assert.strictEqual(showing(), false, "…and off the tab for jobs still to do");
}

/* ---------- 9: the Whole journey table is not filtered by another screen's row ----------
   It lives on Today's moves, has no filter row and no search box of its own, and was reading
   both of the Challengers screen's controls. That was invisible while the dropdown defaulted
   to Everyone. There is no Everyone now, so the same wiring would open it pre-filtered with
   nothing on screen to explain it. */
{
  const app = boot({ members: members() });
  app.ctx.setMemberFilter("paused");
  app.el("search").value = "Pat";
  app.ctx.renderMembers();
  app.ctx.renderMemberTable();

  const table = app.html("todayTable");
  for (const [, m] of ROSTER) {
    assert.ok(table.includes(m.name), m.name + " is in the whole-journey table whatever tab is up");
  }
  assert.ok(app.html("memberList").includes("Pat Paused"), "sanity: the Challengers list IS filtered");
  assert.strictEqual(names(app).length, 1, "…to one person");
}

console.log("challenger-filters.test.cjs: OK");
