// Retention tracker harness — stage one: the two-way switch and the Retention shell.
//
// The two things that matter most here are separation and non-disturbance. Separation: a
// full member and a challenger are two different lists, in two different rows, with two
// different caches, and a write to one must never appear in the other. Non-disturbance:
// everything the onboarding tracker did before this existed, it still does, byte for byte.
// The rest is the shell itself — the switch, the Members tab and a Birthdays tab that reads
// the member list instead of the roster.
//
// The last block is different in kind: it runs the app's CONNECTED path against a stub
// Supabase client, because the tracker choice is shared data now. Which tracker the team is
// looking at lives in its own row, is pushed when somebody taps the switch, and arrives on
// the realtime channel when somebody else does — so that is how it has to be tested.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { boot, daysFromToday, settle } = require("./lib/env.cjs");

const HTML = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

const NOW = new Date();
const CUR_M = NOW.getMonth() + 1;
const pad = (n) => String(n).padStart(2, "0");
const OTHER_M = CUR_M === 1 ? 7 : 1;
const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

function challenger(id, name, extra) {
  return Object.assign({
    id, name, coach: "Dan", dob: null,
    day0: daysFromToday(-7), booked: daysFromToday(-7), firstSessionDone: true,
    completed: [], doneMeta: {}, checks: {}, missed: [], outcome: null, signedUp: false,
    extraDays: 0, pausedDays: 0, pausedAt: null,
  }, extra || {});
}
function member(id, name, extra) {
  return Object.assign({ id, name, coach: "Grace", email: "", dob: null }, extra || {});
}

/* ---------- 1: the top-level switch, and that it remembers ---------- */
{
  const app = boot({});
  assert.strictEqual(app.ctx.__t.tracker, "onboarding", "Onboarding is what the app opens on");
  assert.strictEqual(app.el("view-today").classList.contains("active"), true,
    "…showing the onboarding tab it always showed");
  assert.strictEqual(app.el("view-ret-members").classList.contains("active"), false,
    "…and nothing from the retention side");
  assert.strictEqual(app.el("nav-onboarding").classList.contains("hide"), false, "onboarding tab bar visible");
  assert.strictEqual(app.el("nav-retention").classList.contains("hide"), true, "retention tab bar hidden");

  app.ctx.setTracker("retention");
  assert.strictEqual(app.ctx.__t.tracker, "retention");
  assert.strictEqual(app.el("view-ret-members").classList.contains("active"), true, "Members leads the retention tracker");
  assert.strictEqual(app.el("view-today").classList.contains("active"), false, "…and Today's moves steps aside");
  assert.strictEqual(app.el("nav-retention").classList.contains("hide"), false);
  assert.strictEqual(app.el("nav-onboarding").classList.contains("hide"), true);
  assert.strictEqual(app.el("mastMeta").classList.contains("hide"), true,
    "the 42-days live count is meaningless on the retention side");
  assert.ok(/retention/i.test(app.el("brandSub").textContent), "the masthead says which tracker you are in");

  // …and back again
  app.ctx.setTracker("onboarding");
  assert.strictEqual(app.el("view-today").classList.contains("active"), true, "Onboarding comes back exactly as it was");
  assert.strictEqual(app.el("view-ret-members").classList.contains("active"), false);
  assert.strictEqual(app.el("mastMeta").classList.contains("hide"), false);
  assert.strictEqual(app.el("brandSub").textContent, "Warrington · membership journey");

  // anything unrecognised is the onboarding tracker, never a blank page
  app.ctx.setTracker("nonsense");
  assert.strictEqual(app.ctx.__t.tracker, "onboarding");
}

/* ---------- 2: the choice is shared data, not a note on this device ---------- */
{
  // Nothing about the tracker is kept in localStorage any more — the shared row is the only
  // source of truth, so a stale key left over from the old build is ignored, not obeyed.
  const stale = boot({ stored: { "bsj_tracker": "retention" } });
  assert.strictEqual(stale.ctx.__t.tracker, "onboarding",
    "a leftover bsj_tracker from the old per-device build has no say");

  const app = boot({});
  app.ctx.setTracker("retention");
  assert.strictEqual(app.stored("bsj_tracker"), null, "and nothing writes it back");
  assert.ok(!HTML.includes("bsj_tracker"), "the key is gone from the app entirely");
  assert.ok(!/localStorage[^\n]*tracker/i.test(HTML), "…and the tracker touches localStorage nowhere");

  // a device that has never seen a tracker row opens on Onboarding
  assert.strictEqual(boot({}).ctx.__t.tracker, "onboarding");
}

/* ---------- 3: each tracker keeps its own tab ---------- */
{
  const app = boot({});
  app.ctx.setTab("onboarding", "playbook");
  assert.strictEqual(app.el("view-playbook").classList.contains("active"), true);

  app.ctx.setTracker("retention");
  app.ctx.setTab("retention", "ret-birthdays");
  assert.strictEqual(app.el("view-ret-birthdays").classList.contains("active"), true);
  assert.strictEqual(app.el("view-playbook").classList.contains("active"), false,
    "the onboarding view is not left on screen underneath");

  app.ctx.setTracker("onboarding");
  assert.strictEqual(app.el("view-playbook").classList.contains("active"), true,
    "switching back puts you on the tab you left");
  assert.strictEqual(app.el("view-ret-birthdays").classList.contains("active"), false);

  app.ctx.setTracker("retention");
  assert.strictEqual(app.el("view-ret-birthdays").classList.contains("active"), true,
    "…and the retention side remembers its own tab too");

  // a tab that doesn't belong to a tracker can't strand you on a blank page
  assert.strictEqual(app.ctx.setTab("retention", "playbook"), "ret-members");
  assert.strictEqual(app.ctx.setTab("onboarding", "ret-members"), "today");
}

/* ---------- 4: two lists, two rows, two caches — nothing bleeds across ---------- */
{
  const app = boot({
    members: [challenger("c1", "Chris Challenger")],
    retention: [member("r1", "Mo Member", { email: "mo@example.com" })],
  });

  assert.strictEqual(app.members().length, 1);
  assert.strictEqual(app.retention().length, 1);
  assert.ok(!app.members().some((m) => m.id === "r1"), "a member is not on the roster");
  assert.ok(!app.retention().some((m) => m.id === "c1"), "a challenger is not on the member list");

  // bank both lists first, so "unchanged" below means a real blob that stayed put
  app.ctx.save();
  app.ctx.saveRetention();

  // saving a member writes the member cache and leaves the roster blob alone
  const rosterBefore = JSON.stringify(app.cached());
  assert.ok(rosterBefore.includes("Chris Challenger"), "sanity: the roster blob has the challenger in it");
  app.ctx.openRetEdit("r1");
  app.el("rf-coach").value = "Ash";
  app.ctx.saveRetMember();
  assert.strictEqual(app.findMember("r1").coach, "Ash");
  assert.strictEqual(app.retentionCached()[0].coach, "Ash", "…through the member list's own sync path");
  assert.strictEqual(JSON.stringify(app.cached()), rosterBefore, "the challenger roster is untouched");

  // and the other way round
  const membersBefore = JSON.stringify(app.retentionCached());
  app.ctx.openEdit("c1");
  app.el("f-name").value = "Chris Renamed";
  app.ctx.saveMember();
  assert.strictEqual(app.find("c1").name, "Chris Renamed");
  assert.strictEqual(app.cached()[0].name, "Chris Renamed");
  assert.strictEqual(JSON.stringify(app.retentionCached()), membersBefore, "the member list is untouched");

  // they are genuinely different storage keys, not one blob read twice
  assert.notStrictEqual(app.ctx.__t.CACHE, app.ctx.__t.RET_CACHE);
  assert.strictEqual(app.retentionCached().length, 1);
  assert.strictEqual(app.cached().length, 1);
}

/* ---------- 5: migration — a member record is filled in, never clobbered ---------- */
{
  const app = boot({});
  const { migrateRetentionList } = app.ctx;

  // the thinnest thing a later stage could hand over: a name and nothing else
  const bare = migrateRetentionList([{ name: "Bare Bones" }]);
  const m = bare[0];
  assert.ok(m.id, "an id is minted for a record that arrived without one");
  assert.strictEqual(m.email, "");
  assert.strictEqual(m.coach, "");
  assert.strictEqual(m.personal, "");
  assert.strictEqual(m.notes, "", "the same shared-notes field a challenger has");
  assert.strictEqual(m.dob, null);
  assert.strictEqual(m.joined, null);
  assert.strictEqual(m.fromChallenger, null);
  for (const k of ["name", "email", "coach", "notes", "dob"]) {
    assert.ok(k in m, "core field " + k + " is present");
    assert.notStrictEqual(m[k], undefined, "core field " + k + " is never undefined");
  }

  // re-running it changes nothing
  const full = { id: "keep", name: "Keep Me", email: "k@example.com", coach: "Gaz",
    personal: "half marathon in May", notes: "<b>knee</b>", dob: "1988-02-29",
    joined: daysFromToday(-100), fromChallenger: "c9" };
  const once = migrateRetentionList([{ ...full }]);
  const twice = migrateRetentionList(JSON.parse(JSON.stringify(once)));
  assert.deepStrictEqual(twice[0], full, "migration is idempotent and clobbers nothing");

  // and rubbish in the row never throws (arrays cross the vm boundary, so compare contents)
  for (const junk of [null, undefined, "not a list", 42, {}]) {
    const out = migrateRetentionList(junk);
    assert.strictEqual(out.length, 0, JSON.stringify(junk) + " becomes an empty list");
  }
  assert.strictEqual(migrateRetentionList([]).length, 0);

  // the challenger migration is untouched by any of this: it does not grow retention fields
  const legacy = app.ctx.migrateList([{ id: "leg", name: "Jo Ancient", coach: "Dan" }])[0];
  assert.strictEqual(legacy.joined, undefined, "a challenger gains no member-only fields");
  assert.strictEqual(legacy.fromChallenger, undefined);
  assert.strictEqual(legacy.notes, "", "…and keeps the ones it always had");
  assert.strictEqual(legacy.dob, null);
}

/* ---------- 6: an existing device, with no member list at all, boots clean ---------- */
{
  // exactly what every device has today: a roster in the cache and no retention row anywhere
  const app = boot({ members: [challenger("c1", "Chris Challenger", { dob: `1990-${pad(OTHER_M)}-03` })] });
  assert.strictEqual(app.retention().length, 0, "no member list is an empty member list, not an error");
  assert.ok(app.html("retMemberList").includes("No members yet"), "the Members tab says so");
  assert.ok(app.html("retBirthdayList").includes("No birthdays on file yet"));
  // …and the onboarding side is entirely normal
  assert.ok(app.html("memberList").includes("Chris Challenger"));
  assert.ok(app.html("birthdayList").includes("Chris Challenger"));
}

/* ---------- 7: the Members tab holds and shows the core fields ---------- */
{
  const app = boot({ retention: [
    member("r1", "Mo Member", { email: "mo@example.com", dob: "1990-04-23", coach: "Grace" }),
    member("r2", "Ann Other", { coach: "Gaz" }),
  ] });
  const h = app.html("retMemberList");

  assert.ok(h.includes("Mo Member"), "a member is listed");
  assert.ok(h.includes("mo@example.com"), "with their email");
  assert.ok(h.includes("Coach Grace"), "their coach");
  assert.ok(h.includes("Born 23rd April"), "and their date of birth");
  assert.ok(h.includes("notes-btn"), "the shared notes icon travels here too");
  assert.strictEqual(app.el("retCount").textContent, "2", "the tab carries the headcount");

  // alphabetical, so a list of members reads like a register
  assert.ok(h.indexOf("Ann Other") < h.indexOf("Mo Member"));

  // search filters, and says so rather than looking broken
  app.el("retSearch").value = "mo";
  app.ctx.renderRetentionMembers();
  assert.ok(app.html("retMemberList").includes("Mo Member"));
  assert.ok(!app.html("retMemberList").includes("Ann Other"));
  app.el("retSearch").value = "nobody at all";
  app.ctx.renderRetentionMembers();
  assert.ok(app.html("retMemberList").includes("Nobody matches that"));
  app.el("retSearch").value = "";
  app.ctx.renderRetentionMembers();
  assert.ok(!app.html("retMemberList").includes("No members yet"), "an empty search is everyone, not nobody");
}

/* ---------- 8: add, edit and remove a member through the modal ---------- */
{
  const app = boot({});
  app.ctx.openRetAdd();
  assert.strictEqual(app.el("rf-name").value, "", "the form starts blank");
  assert.strictEqual(app.el("retModalBg").classList.contains("show"), true);

  app.el("rf-name").value = "Nina New";
  app.el("rf-email").value = "nina@example.com";
  app.el("rf-coach").value = "Ash";
  app.el("rf-dob").value = "2001-07-09";
  app.ctx.saveRetMember();

  assert.strictEqual(app.el("retModalBg").classList.contains("show"), false, "the modal closes");
  const nina = app.retention()[0];
  assert.strictEqual(nina.name, "Nina New");
  assert.strictEqual(nina.email, "nina@example.com");
  assert.strictEqual(nina.coach, "Ash");
  assert.strictEqual(nina.dob, "2001-07-09");
  assert.strictEqual(nina.notes, "", "born with the shared-notes field, like a challenger");
  assert.strictEqual(app.retentionCached()[0].name, "Nina New", "…and pushed through the member sync path");
  assert.strictEqual(app.cached().length, 0, "nothing landed on the challenger roster");

  // a nonsense date of birth is stored as nothing, exactly as on the challenger form
  app.ctx.openRetEdit(nina.id);
  assert.strictEqual(app.el("rf-dob").value, "2001-07-09", "reopening shows what was saved");
  app.el("rf-dob").value = "1990-02-30";
  app.ctx.saveRetMember();
  assert.strictEqual(app.findMember(nina.id).dob, null, "30 February is not a date");
  assert.strictEqual(app.findMember(nina.id).name, "Nina New", "…and the rest of the record survives");

  // a nameless member is refused
  app.ctx.openRetAdd();
  app.el("rf-name").value = "   ";
  app.ctx.saveRetMember();
  assert.strictEqual(app.retention().length, 1, "nobody was added");
  assert.ok(app.alerts.some((a) => /name/i.test(a)), "…and we said why");
  app.ctx.closeRetModal();

  // removing
  app.ctx.removeRetMember(nina.id);
  assert.strictEqual(app.retention().length, 0);
  assert.strictEqual(app.retentionCached().length, 0, "the removal synced");
  assert.ok(app.html("retMemberList").includes("No members yet"), "back to the empty state");
}

/* ---------- 9: the retention Birthdays tab reads the member list, and only that ---------- */
{
  const app = boot({
    members: [challenger("c1", "Chris Challenger", { dob: `1990-${pad(OTHER_M)}-03` })],
    retention: [
      member("r1", "Mo Member", { dob: `1985-${pad(OTHER_M)}-01` }),
      member("r2", "Zoe Later", { dob: `1992-${pad(OTHER_M)}-20` }),
      member("r3", "Ned NoDob"),
    ],
  });
  const ret = app.html("retBirthdayList");
  const onb = app.html("birthdayList");

  assert.ok(ret.includes("Mo Member") && ret.includes("Zoe Later"), "members appear on the retention tab");
  assert.ok(!ret.includes("Chris Challenger"), "a challenger never leaks onto the member birthdays");
  assert.ok(!onb.includes("Mo Member"), "…and a member never leaks onto the challenger birthdays");
  assert.ok(onb.includes("Chris Challenger"), "the onboarding tab is exactly as it was");

  // same grouping rules as the onboarding tab: month groups, day order, ordinals, this month
  assert.ok(ret.indexOf("Mo Member") < ret.indexOf("Zoe Later"), "1st before 20th");
  assert.ok(ret.includes(">1st<") && ret.includes(">20th<"), "ordinals");
  assert.ok(ret.includes(MONTHS[OTHER_M - 1]), "grouped under the birth month");
  assert.ok(ret.includes("This month") && ret.includes("bday-month now"), "the current month leads and is marked");

  // the meta line is a member's, not a challenger's — there is no 42-day clock to report
  assert.ok(/Coach [^<]*· member/.test(ret), "a member reads as a member");
  assert.ok(!/on the journey|finished the 6 weeks|not started yet/.test(ret),
    "…and never borrows the journey's wording");
  assert.ok(/on the journey/.test(onb), "while the onboarding tab still reports the journey");

  // whoever we still cannot plan for is counted, in the right noun
  assert.ok(/1 member has no date of birth yet/.test(ret));
  assert.ok(!/challenger/.test(ret.slice(ret.indexOf("bday-missing"))), "counted as members, not challengers");

  // the notes icon opens THAT person's notes
  assert.ok(/openNotes\((&#39;|')r1\1\)/.test(ret));
}

/* ---------- 10: one notes document per person, in whichever list holds them ---------- */
{
  const app = boot({
    members: [challenger("c1", "Chris Challenger")],
    retention: [member("r1", "Mo Member")],
  });

  // a member's notes open, save, and land in the member list's blob
  app.ctx.openNotes("r1");
  assert.strictEqual(app.el("notesWho").textContent, "Mo Member", "the editor opens on the member");
  app.el("notesEd").innerHTML = "<div>Prefers the 6am class.</div>";
  app.ctx.notesTouched();
  assert.strictEqual(app.ctx.notesFlush(), true);

  assert.ok(app.findMember("r1").notes.includes("6am"), "stored on the member");
  assert.ok(app.retentionCached()[0].notes.includes("6am"), "…and synced through the member list");
  assert.strictEqual(app.cached().length, 0, "the challenger roster was not even written");
  assert.strictEqual(app.find("c1").notes, "", "…and the challenger never saw it");

  app.ctx.closeNotes();
  assert.ok(app.html("retMemberList").includes("notes-btn has"), "the member's icon lights up");
  assert.ok(!app.html("memberList").includes("notes-btn has"), "…and nobody else's does");

  // the same editor, the same sanitiser, for a member
  app.ctx.openNotes("r1");
  app.el("notesEd").innerHTML = 'ok <script>alert(1)</script><img src=x onerror="alert(2)">';
  app.ctx.notesFlush();
  const saved = app.findMember("r1").notes.toLowerCase();
  for (const bad of ["<script", "onerror"]) assert.ok(!saved.includes(bad), "stripped " + bad);
  app.ctx.closeNotes();

  // and a challenger's notes still save through the roster, exactly as before
  app.ctx.openNotes("c1");
  app.el("notesEd").innerHTML = "<div>Knee plays up.</div>";
  app.ctx.notesFlush();
  assert.ok(app.cached()[0].notes.includes("Knee"), "a challenger's note still rides the roster blob");
  assert.ok(!app.retentionCached()[0].notes.includes("Knee"), "…and stays out of the member list");
  app.ctx.closeNotes();
}

/* ---------- 11: the CSV backfill runs over whichever list you opened it from ---------- */
{
  const CSV = [
    "Full Name,First Name,Last Name,Email,Date of Birth",
    "Mo Member,Mo,Member,mo@example.com,1985-06-11",
    "Chris Challenger,Chris,Challenger,chris@example.com,1979-03-04",
    "Gary Gymgoer,Gary,Gymgoer,gary@example.com,1975-03-02",
  ].join("\n");

  const app = boot({
    members: [challenger("c1", "Chris Challenger")],
    retention: [member("r1", "Mo Member")],
  });

  // pointed at the member list
  const r = app.ctx.applyRetentionDobCsv(CSV, false);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.added, 1, "only the member matched");
  assert.strictEqual(r.noMatch, 2, "the challenger and the stranger are skipped, not created");
  assert.strictEqual(app.findMember("r1").dob, "1985-06-11");
  assert.strictEqual(app.retention().length, 1, "NOBODY was created");
  assert.strictEqual(app.find("c1").dob, null, "the challenger was not touched by a retention import");
  assert.strictEqual(app.retentionCached()[0].dob, "1985-06-11", "…and the result synced to the member list");

  // pointed at the roster — the original behaviour, unchanged
  const r2 = app.ctx.applyDobCsv(CSV, false);
  assert.strictEqual(r2.added, 1);
  assert.strictEqual(app.find("c1").dob, "1979-03-04");
  assert.strictEqual(app.members().length, 1, "nobody created here either");
  assert.strictEqual(app.cached()[0].dob, "1979-03-04");

  // the modal knows which list it was opened for
  app.ctx.openImport("retention");
  assert.ok(/members already in the tracker/.test(app.html("imp-note")), "retention wording");
  app.ctx.openImport();
  assert.ok(/challengers already in the tracker/.test(app.html("imp-note")),
    "…and the no-argument call is the onboarding tracker, as it always was");
}

/* ---------- 12: the onboarding tracker is completely undisturbed ---------- */
{
  // every tab and section it had is still there, with the same ids the app has always used
  ["today", "members", "birthdays", "playbook"].forEach((v) => {
    assert.ok(HTML.includes('data-view="' + v + '"'), "the " + v + " tab is still there");
    assert.ok(HTML.includes('id="view-' + v + '"'), "…with its section");
  });
  assert.ok(/onclick="openImport\(\)"/.test(HTML), "the onboarding CSV import button is unchanged");
  assert.ok(/id="view-ret-members"/.test(HTML) && /id="view-ret-birthdays"/.test(HTML),
    "and the retention sections exist alongside them");
  assert.ok(/data-tracker="onboarding"[\s\S]*data-tracker="retention"/.test(HTML),
    "the switch offers both, Onboarding first");

  // a full onboarding roster renders identically whether or not members exist beside it
  const roster = [
    challenger("c1", "Chris Challenger", { dob: "1990-04-23" }),
    challenger("c2", "Pat Paused", { pausedAt: daysFromToday(-2) }),
    challenger("c3", "Lee Left", { outcome: "left", day0: daysFromToday(-50), booked: daysFromToday(-50) }),
  ];
  const alone = boot({ members: roster });
  alone.ctx.renderMemberTable();
  const beside = boot({ members: roster, retention: [
    member("r1", "Mo Member", { dob: "1990-04-23", email: "mo@example.com" }),
  ] });
  beside.ctx.renderMemberTable();

  for (const id of ["todayList", "memberList", "birthdayList", "playbookList", "todayTable", "convBar"]) {
    assert.strictEqual(beside.html(id), alone.html(id),
      "#" + id + " renders exactly the same with a member list beside it");
  }
  assert.strictEqual(beside.el("todayCount").textContent, alone.el("todayCount").textContent);
  assert.strictEqual(beside.el("liveCount").textContent, alone.el("liveCount").textContent,
    "the live count counts challengers only");
  assert.deepStrictEqual(beside.cached(), alone.cached(), "and the roster blob that syncs is identical");
}

/* ---------- 13: the tracker choice travels over the shared backend ----------
   Everything above drives the app with no Supabase behind it. These run the connected path
   for real, against a stub client: bootData pulls the shared row, a tap pushes one back, and
   a change arriving over the realtime channel is somebody else's phone. */
const TRACKER_ROW = "tracker";

async function cloudTests() {
  /* --- boots onto whichever tracker the team was last on, from any device --- */
  {
    const app = boot({ cloud: { rows: {
      roster: [challenger("c1", "Chris Challenger")],
      retention: [member("r1", "Mo Member")],
      tracker: { tracker: "retention" },
      seeded: true,
    } } });
    assert.strictEqual(app.ctx.__t.tracker, "onboarding", "before the data arrives we are on Onboarding");

    await app.ctx.bootData();
    assert.strictEqual(app.ctx.__t.tracker, "retention",
      "a device opening cold lands on the tracker the team was last using");
    assert.strictEqual(app.el("view-ret-members").classList.contains("active"), true);
    assert.strictEqual(app.el("view-today").classList.contains("active"), false);
    assert.strictEqual(app.el("nav-retention").classList.contains("hide"), false);

    // the rest of the shared data still arrived intact through the same call
    assert.strictEqual(app.members().length, 1, "the roster came down too");
    assert.strictEqual(app.retention().length, 1, "…and the member list");
    assert.ok(app.html("memberList").includes("Chris Challenger"));
    assert.ok(app.html("retMemberList").includes("Mo Member"));

    // reading the row never writes one back
    assert.strictEqual(app.cloud.writesTo(TRACKER_ROW).length, 0,
      "following the shared choice does not push it straight back");

    // the app is listening for later changes to it
    assert.ok(app.cloud.subscribedTo().includes("key=eq." + TRACKER_ROW),
      "the tracker row is on the realtime channel");
  }

  /* --- a gym that has never tapped the switch, and a row full of junk --- */
  {
    const none = boot({ cloud: { rows: { seeded: true } } });
    await none.ctx.bootData();
    assert.strictEqual(none.ctx.__t.tracker, "onboarding", "no row yet: Onboarding, as always");
    assert.strictEqual(none.cloud.writesTo(TRACKER_ROW).length, 0, "…and still no row is created");

    for (const junk of [null, "", "sideways", 42, {}, { tracker: "nope" }, []]) {
      const app = boot({ cloud: { rows: { tracker: junk, seeded: true } } });
      await app.ctx.bootData();
      assert.strictEqual(app.ctx.__t.tracker, "onboarding",
        JSON.stringify(junk) + " in the row leaves us on Onboarding, not on a blank page");
    }
    // a bare string is read too, not just the {tracker:…} shape we write
    const bare = boot({ cloud: { rows: { tracker: "retention", seeded: true } } });
    await bare.ctx.bootData();
    assert.strictEqual(bare.ctx.__t.tracker, "retention");
  }

  /* --- tapping the switch pushes it to everyone --- */
  {
    const app = boot({ cloud: { rows: { seeded: true } } });
    await app.ctx.bootData();

    app.ctx.setTracker("retention");
    assert.strictEqual(app.cloud.writesTo(TRACKER_ROW).length, 0, "the write is debounced, like every other");
    await settle();

    const w = app.cloud.lastWriteTo(TRACKER_ROW);
    assert.ok(w, "the choice reached the shared backend");
    assert.strictEqual(w.key, TRACKER_ROW, "…in its own row in the same table");
    assert.deepStrictEqual(w.value, { tracker: "retention" });
    assert.ok(w.updated_at, "…stamped, so other devices can spot our own echo");

    app.ctx.setTracker("onboarding");
    await settle();
    assert.deepStrictEqual(app.cloud.lastWriteTo(TRACKER_ROW).value, { tracker: "onboarding" },
      "and switching back travels too");

    // a burst of taps collapses into one write, exactly like the roster's debounce
    const before = app.cloud.writesTo(TRACKER_ROW).length;
    app.ctx.setTracker("retention");
    app.ctx.setTracker("onboarding");
    app.ctx.setTracker("retention");
    await settle();
    assert.strictEqual(app.cloud.writesTo(TRACKER_ROW).length, before + 1, "one write, not three");
    assert.deepStrictEqual(app.cloud.lastWriteTo(TRACKER_ROW).value, { tracker: "retention" },
      "…and it is the tracker we ended on");
  }

  /* --- somebody else taps it: this device follows, keeping its place --- */
  {
    const app = boot({ cloud: { rows: {
      roster: [challenger("c1", "Chris Challenger")], seeded: true,
    } } });
    await app.ctx.bootData();

    // put each tracker on a tab that is not its default, so we can see them survive
    app.ctx.setTab("onboarding", "playbook");
    app.ctx.setTab("retention", "ret-birthdays");
    await settle();
    const writesBefore = app.cloud.writesTo(TRACKER_ROW).length;

    app.cloud.emit(TRACKER_ROW, { tracker: "retention" });
    assert.strictEqual(app.ctx.__t.tracker, "retention", "Dan tapped Retention; Ash's iPad follows");
    assert.strictEqual(app.el("view-ret-birthdays").classList.contains("active"), true,
      "…landing on the retention tab this device was last on, not back at the default");
    assert.strictEqual(app.el("view-playbook").classList.contains("active"), false,
      "…and the onboarding view is not left on screen underneath");

    // following is not the same as choosing: nothing is written back, so two devices can
    // never bounce the row off each other
    assert.strictEqual(app.cloud.writesTo(TRACKER_ROW).length, writesBefore,
      "an incoming change is never echoed back to the backend");

    app.cloud.emit(TRACKER_ROW, { tracker: "onboarding" });
    assert.strictEqual(app.ctx.__t.tracker, "onboarding");
    assert.strictEqual(app.el("view-playbook").classList.contains("active"), true,
      "…and the onboarding tab we were on is still the one we come back to");
    assert.strictEqual(app.cloud.writesTo(TRACKER_ROW).length, writesBefore);

    // the roster is untouched by any of this
    assert.strictEqual(app.members().length, 1);
    assert.ok(app.html("memberList").includes("Chris Challenger"));
  }

  /* --- no flicker loop: an update naming the tracker we are already on does nothing --- */
  {
    const app = boot({ cloud: { rows: { roster: [challenger("c1", "Chris Challenger")], seeded: true } } });
    await app.ctx.bootData();
    app.ctx.setTab("onboarding", "birthdays");
    await settle();

    const beforeHtml = app.html("birthdayList");
    const beforeWrites = app.cloud.writesTo(TRACKER_ROW).length;
    assert.strictEqual(app.ctx.applySharedTracker({ tracker: "onboarding" }), false,
      "an update we are already showing is a no-op");
    for (let i = 0; i < 5; i++) app.cloud.emit(TRACKER_ROW, { tracker: "onboarding" });

    assert.strictEqual(app.ctx.__t.tracker, "onboarding");
    assert.strictEqual(app.el("view-birthdays").classList.contains("active"), true,
      "…and it does not knock us back to the tracker's default tab");
    assert.strictEqual(app.html("birthdayList"), beforeHtml, "nothing re-rendered");
    assert.strictEqual(app.cloud.writesTo(TRACKER_ROW).length, beforeWrites, "nothing was written");

    // the echo of our OWN write is dropped on its timestamp, before the value is even read
    app.ctx.setTracker("retention");
    await settle();
    const ours = app.cloud.lastWriteTo(TRACKER_ROW);
    app.cloud.emit(TRACKER_ROW, { tracker: "onboarding" }, ours.updated_at);
    assert.strictEqual(app.ctx.__t.tracker, "retention",
      "a payload stamped with our own write is our echo, and is ignored");
  }

  /* --- the rosters still sync exactly as they did --- */
  {
    const app = boot({ cloud: { rows: { seeded: true } } });
    await app.ctx.bootData();

    app.ctx.openAdd();
    app.el("f-name").value = "Nina New";
    app.ctx.saveMember();
    await settle();
    assert.deepStrictEqual(app.cloud.lastWriteTo("roster").value.map((m) => m.name), ["Nina New"],
      "a new challenger still goes up in the roster row");

    app.ctx.openRetAdd();
    app.el("rf-name").value = "Mo Member";
    app.ctx.saveRetMember();
    await settle();
    assert.deepStrictEqual(app.cloud.lastWriteTo("retention").value.map((m) => m.name), ["Mo Member"],
      "…and a new member in the retention row");
    assert.deepStrictEqual(app.cloud.lastWriteTo("roster").value.map((m) => m.name), ["Nina New"],
      "…without disturbing the other");

    // A roster change from another device still lands, and does not move the tracker.
    // Stamped clear of our own write, or the app's echo guard would (rightly) drop it.
    app.cloud.emit("roster", [challenger("c9", "Sent From Elsewhere")],
      new Date(Date.now() + 10000).toISOString());
    assert.ok(app.html("memberList").includes("Sent From Elsewhere"), "incoming roster changes still render");
    assert.strictEqual(app.ctx.__t.tracker, "onboarding", "…and leave the tracker alone");
  }
}

cloudTests()
  .then(() => console.log("retention.test.cjs: OK"))
  .catch((e) => { console.error(e); process.exit(1); });
