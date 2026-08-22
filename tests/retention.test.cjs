// Retention tracker harness — the home screen and the Retention shell.
//
// The two things that matter most here are separation and non-disturbance. Separation: a
// full member and a challenger are two different lists, in two different rows, with two
// different caches, and a write to one must never appear in the other. Non-disturbance:
// everything the onboarding tracker did before this existed, it still does, byte for byte.
// The rest is the shell itself — the home screen you pick a tracker from, the Members tab
// and a Birthdays tab that reads the member list instead of the roster.
//
// Which tracker you are in is in-memory UI state and nothing else: every load starts at
// home, and there is no row, no key and no realtime handler behind it. The last block runs
// the app's CONNECTED path against a stub Supabase client to prove exactly that — the two
// rosters sync as they always did, and the tracker choice is not part of the traffic.
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
/* A member always has a start date: everything about them — their journey, their attendance
   weeks, the first-six-months watch window — is counted from it, and the member form refuses
   to save one without it. Migration will not invent one, so a fixture that means "a member"
   has to carry it. */
function member(id, name, extra) {
  return Object.assign({ id, name, coach: "Grace", email: "", dob: null,
    joined: daysFromToday(-60) }, extra || {});
}

/* ---------- 1: the app opens on the home screen, every time ---------- */
{
  const app = boot({});
  assert.strictEqual(app.ctx.__t.tracker, null, "no tracker is chosen for you");
  assert.strictEqual(app.el("homeScreen").classList.contains("hide"), false, "the home screen is what you see");
  assert.strictEqual(app.el("nav-onboarding").classList.contains("hide"), true, "…with neither tab bar");
  assert.strictEqual(app.el("nav-retention").classList.contains("hide"), true);
  ["today", "members", "birthdays", "playbook", "ret-today", "ret-members", "ret-birthdays"].forEach((v) =>
    assert.strictEqual(app.el("view-" + v).classList.contains("active"), false,
      "no view is showing behind the home screen: " + v));
  assert.strictEqual(app.el("homeBtn").classList.contains("hide"), true, "nothing to go back to yet");
  assert.strictEqual(app.el("mastMeta").classList.contains("hide"), true, "and no 42-days count either");
  assert.strictEqual(app.el("brandHome").classList.contains("is-link"), false, "the brand is not a link at home");
  assert.strictEqual(app.el("brandHome").getAttribute("role"), null, "…and carries no button semantics");

  // the two cards, with the titles and subtitles they were asked for
  assert.ok(/<section class="home" id="homeScreen">/.test(HTML), "there is a home screen");
  assert.ok(/enterTracker\('onboarding'\)/.test(HTML) && /enterTracker\('retention'\)/.test(HTML),
    "…with a card for each tracker");
  const home = HTML.slice(HTML.indexOf('id="homeScreen"'), HTML.indexOf("<!-- ===== TODAY"));
  assert.ok(home.indexOf("Onboarding") < home.indexOf("Retention"), "Onboarding is offered first");
  assert.ok(/Onboarding<[\s\S]*?The First 42 Days/.test(home), "Onboarding — The First 42 Days");
  assert.ok(/Retention<[\s\S]*?Every day after/.test(home), "Retention — Every day after");
  assert.ok(!/class="view[^"]*active/.test(HTML), "and no view is marked active in the markup either");

  // the whole card is the target, not just the "Enter" line
  const buttons = home.match(/<button[^>]*class="home-card[^"]*"[^>]*>/g) || [];
  assert.strictEqual(buttons.length, 2, "each card is one button");
  buttons.forEach((b) => assert.ok(/onclick="enterTracker\('(onboarding|retention)'\)"/.test(b),
    "…that enters its tracker: " + b));
  assert.ok(/class="home-card hc-onboarding"/.test(home) && /class="home-card hc-retention"/.test(home),
    "…and carries its own accent class");

  // an icon drawn in the page — no library, no network
  assert.strictEqual((home.match(/<svg /g) || []).length, 2, "an inline icon on each card");
  assert.ok(!/<img|src=/.test(home), "…nothing fetched from anywhere");
  assert.strictEqual((home.match(/stroke="currentColor"/g) || []).length, 2,
    "…drawn in currentColor, so each icon takes its card's accent");

  // the two accents are existing theme tokens, not new colours
  const css = HTML.slice(HTML.indexOf("/* ---------- Home screen"), HTML.indexOf("/* ---------- Tabs"));
  assert.ok(/--accent:var\(--orange\)/.test(css), "Onboarding rides the brand accent");
  assert.ok(/--accent:var\(--green\)/.test(css), "Retention rides the green one");
  assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(css), "the home screen introduces no hard-coded colour");
}

/* ---------- 2: entering a tracker, and getting back out ---------- */
{
  const app = boot({});

  app.ctx.enterTracker("onboarding");
  assert.strictEqual(app.ctx.__t.tracker, "onboarding");
  assert.strictEqual(app.el("homeScreen").classList.contains("hide"), true, "the home screen steps aside");
  assert.strictEqual(app.el("nav-onboarding").classList.contains("hide"), false, "its tab bar appears");
  assert.strictEqual(app.el("nav-retention").classList.contains("hide"), true, "…and only its own");
  assert.strictEqual(app.el("view-today").classList.contains("active"), true, "landing on Today's moves");
  assert.strictEqual(app.el("brandTitle").textContent, "Onboarding", "the masthead says where you are");
  assert.strictEqual(app.el("brandSub").textContent, "The First 42 Days · Warrington");
  assert.strictEqual(app.el("mastMeta").classList.contains("hide"), false, "the live count belongs here");
  assert.strictEqual(app.el("homeBtn").classList.contains("hide"), false, "and there is a way back");
  assert.strictEqual(app.el("brandHome").classList.contains("is-link"), true, "the brand is the other way back");
  assert.strictEqual(app.el("brandHome").getAttribute("role"), "button");
  assert.strictEqual(app.el("brandHome").getAttribute("tabindex"), "0");

  app.ctx.goHome();
  assert.strictEqual(app.ctx.__t.tracker, null);
  assert.strictEqual(app.el("homeScreen").classList.contains("hide"), false, "home again");
  assert.strictEqual(app.el("view-today").classList.contains("active"), false, "…with the tracker put away");
  assert.strictEqual(app.el("brandTitle").textContent, "Bodysculpt Warrington");
  assert.strictEqual(app.el("brandSub").textContent, "Choose a tracker");
  assert.strictEqual(app.el("homeBtn").classList.contains("hide"), true);

  app.ctx.enterTracker("retention");
  assert.strictEqual(app.ctx.__t.tracker, "retention", "…so the other one can be picked");
  assert.strictEqual(app.el("view-ret-today").classList.contains("active"), true,
    "Today's moves leads Retention, the same way it leads Onboarding");
  assert.strictEqual(app.el("view-ret-members").classList.contains("active"), false);
  assert.strictEqual(app.el("view-today").classList.contains("active"), false);
  assert.strictEqual(app.el("nav-retention").classList.contains("hide"), false);
  assert.strictEqual(app.el("nav-onboarding").classList.contains("hide"), true);
  assert.strictEqual(app.el("brandTitle").textContent, "Retention");
  assert.strictEqual(app.el("brandSub").textContent, "Every day after · Warrington");
  assert.strictEqual(app.el("mastMeta").classList.contains("hide"), true,
    "the 42-days live count is meaningless on the retention side");

  // tapping the brand is the second way home, and it only fires once there is somewhere to go
  app.el("brandHome").__fire("click");
  assert.strictEqual(app.ctx.__t.tracker, null, "tapping the title goes home");
  app.el("brandHome").__fire("click");
  assert.strictEqual(app.ctx.__t.tracker, null, "…and does nothing at all once you are there");
  app.ctx.enterTracker("retention");
  app.el("brandHome").__fire("keydown", { key: "Enter", preventDefault() {} });
  assert.strictEqual(app.ctx.__t.tracker, null, "…and it answers the keyboard too");

  // anything unrecognised is a tracker, not a blank page
  assert.strictEqual(app.ctx.enterTracker("nonsense"), "onboarding");
  assert.strictEqual(app.ctx.showTracker("nonsense"), null, "…while showTracker(junk) is home");
}

/* ---------- 3: nothing about the choice is persisted or synced ---------- */
{
  const app = boot({});
  app.ctx.enterTracker("retention");
  assert.strictEqual(app.stored("bsj_tracker"), null, "no localStorage key");
  assert.ok(!HTML.includes("bsj_tracker"), "…not even the name of one");
  assert.ok(!/localStorage[^\n]*[Tt]racker|[Tt]racker[^\n]*localStorage/.test(HTML),
    "the tracker touches localStorage nowhere");

  // and no dead sync machinery left behind
  for (const gone of ["TRACKER_ROW_KEY", "saveTracker", "pushTrackerToCloud", "applySharedTracker",
    "readTrackerValue", "lastOwnTrackerWrite", "setTracker", "trackerswitch"]) {
    assert.ok(!HTML.includes(gone), gone + " should be gone from the app");
  }
  // The realtime channel carries SHARED data and nothing else. Three subscriptions: the
  // roster, the member list and the Playbook's wording overrides — no fourth one for which
  // tracker somebody is looking at, because that is this device's business.
  assert.strictEqual((HTML.match(/key=eq\./g) || []).length, 3,
    "three realtime subscriptions — the roster, the member list, the Playbook wording");
  assert.ok(!/key=eq\.'\+TRACKER|key=eq\.tracker/.test(HTML),
    "…and none of them is the tracker choice");

  // a fresh load is always home, whatever the last one did
  const again = boot({});
  assert.strictEqual(again.ctx.__t.tracker, null);
}

/* ---------- 4: each tracker keeps its tab across a trip home ---------- */
{
  const app = boot({});
  app.ctx.enterTracker("onboarding");
  app.ctx.setTab("onboarding", "playbook");
  assert.strictEqual(app.el("view-playbook").classList.contains("active"), true);

  app.ctx.goHome();
  assert.strictEqual(app.el("view-playbook").classList.contains("active"), false,
    "the view is put away while you are at home");

  app.ctx.enterTracker("retention");
  app.ctx.setTab("retention", "ret-birthdays");
  assert.strictEqual(app.el("view-ret-birthdays").classList.contains("active"), true);
  assert.strictEqual(app.el("view-playbook").classList.contains("active"), false,
    "the onboarding view is not left on screen underneath");

  app.ctx.goHome();
  app.ctx.enterTracker("onboarding");
  assert.strictEqual(app.el("view-playbook").classList.contains("active"), true,
    "coming back puts you on the tab you left");
  assert.strictEqual(app.el("view-ret-birthdays").classList.contains("active"), false);

  app.ctx.goHome();
  app.ctx.enterTracker("retention");
  assert.strictEqual(app.el("view-ret-birthdays").classList.contains("active"), true,
    "…and the retention side remembers its own tab too");

  // a tab that doesn't belong to a tracker can't strand you on a blank page
  assert.strictEqual(app.ctx.setTab("retention", "playbook"), "ret-today");
  assert.strictEqual(app.ctx.setTab("onboarding", "ret-members"), "today");
  // …and going home leaves both remembered tabs alone
  app.ctx.setTab("onboarding", "birthdays");
  app.ctx.goHome();
  app.ctx.enterTracker("onboarding");
  assert.strictEqual(app.el("view-birthdays").classList.contains("active"), true);
}

/* ---------- 5: two lists, two rows, two caches — nothing bleeds across ---------- */
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

/* ---------- 6: migration — a member record is filled in, never clobbered ---------- */
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
  // member-journey progress, tracked the same way a challenger's is
  assert.deepStrictEqual([...m.completed], [], "no touchpoints done yet");
  assert.deepStrictEqual([...m.missed], []);
  assert.deepStrictEqual({ ...m.doneMeta }, {});
  assert.deepStrictEqual({ ...m.attendance }, {}, "and no attendance history");
  // birthday housekeeping, the same two fields and the same defaults a challenger gets
  assert.strictEqual(m.birthdayIgnored, false, "nobody is ignored by default");
  assert.strictEqual(m.birthdayActionedYear, null, "and nothing is actioned by default");
  for (const k of ["name", "email", "coach", "notes", "dob", "completed", "missed", "doneMeta",
    "attendance", "birthdayIgnored", "birthdayActionedYear", "left", "challengeSessions"]) {
    assert.ok(k in m, "core field " + k + " is present");
    assert.notStrictEqual(m[k], undefined, "core field " + k + " is never undefined");
  }

  // re-running it changes nothing
  const full = { id: "keep", name: "Keep Me", email: "k@example.com", coach: "Gaz",
    personal: "half marathon in May", notes: "<b>knee</b>", dob: "1988-02-29",
    joined: daysFromToday(-100), fromChallenger: "c9", left: false, challengeSessions: 14,
    completed: ["welcome_card"], missed: ["day30"], doneMeta: { welcome_card: "3 Jun" },
    attendance: { "2026-W20": { attendedPT: 2, attendedOther: 0, noShow: 0, lateCancelled: 0, registered: 0 } },
    birthdayIgnored: true, birthdayActionedYear: 2019 };
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

/* ---------- 7: an existing device, with no member list at all, boots clean ---------- */
{
  // exactly what every device has today: a roster in the cache and no retention row anywhere
  const app = boot({ members: [challenger("c1", "Chris Challenger", { dob: `1990-${pad(OTHER_M)}-03` })] });
  assert.strictEqual(app.retention().length, 0, "no member list is an empty member list, not an error");
  assert.ok(app.html("retMemberList").includes("No members yet"), "the Members tab says so");
  // the Birthdays tab is merged, so with one challenger and no members it shows the challenger
  assert.ok(app.html("retBirthdayList").includes("Chris Challenger"),
    "the merged Birthdays tab shows them from the retention side too");
  // …and the onboarding side is entirely normal
  assert.ok(app.html("memberList").includes("Chris Challenger"));
  assert.ok(app.html("birthdayList").includes("Chris Challenger"));
}

/* ---------- 8: the Members tab holds and shows the core fields ---------- */
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

/* ---------- 9: add, edit and remove a member through the modal ---------- */
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

/* ---------- 10: the retention Birthdays tab reads the member list, and only that ---------- */
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

  // The Birthdays tab is MERGED: everybody, from either tracker, on one screen. What used to
  // be "a challenger never leaks onto the member birthdays" is now the opposite claim — both
  // are there, and the tag beside the name is what tells them apart. See birthday-merged.
  assert.ok(ret.includes("Mo Member") && ret.includes("Zoe Later"), "members appear on the tab");
  assert.ok(ret.includes("Chris Challenger"), "…alongside the challengers");
  assert.strictEqual(ret, onb, "and it is the same screen from either tracker");

  // same grouping rules as the onboarding tab: month groups, day order, ordinals, this month
  assert.ok(ret.indexOf("Mo Member") < ret.indexOf("Zoe Later"), "1st before 20th");
  assert.ok(ret.includes(">1st<") && ret.includes(">20th<"), "ordinals");
  assert.ok(ret.includes(MONTHS[OTHER_M - 1]), "grouped under the birth month");
  assert.ok(ret.includes("This month") && ret.includes("bday-month now"), "the current month leads and is marked");

  // a member's line is their coach — there is no 42-day clock to report on — and the tag
  // beside their name is what says which list they are on
  const moRow = ret.split('<div class="bday-row').find((r) => r.includes("Mo Member")) || "";
  assert.ok(/<div class="bday-meta">Coach [^<]*<\/div>/.test(moRow), "a member's line is their coach");
  assert.ok(!/on the journey|finished the 6 weeks|not started yet/.test(moRow),
    "…and never borrows the journey's wording");
  assert.ok(/bday-type member">Full member</.test(moRow), "…and they are tagged as a member");
  assert.ok(/on the journey/.test(onb), "while the onboarding tab still reports the journey");

  // whoever we still cannot plan for is counted, in the right noun
  assert.ok(/1 person has no date of birth yet/.test(ret));
  assert.ok(!/challenger/.test(ret.slice(ret.indexOf("bday-missing"))), "counted as members, not challengers");

  // the notes icon opens THAT person's notes
  assert.ok(/openNotes\((&#39;|')r1\1\)/.test(ret));
}

/* ---------- 11: one notes document per person, in whichever list holds them ---------- */
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

/* ---------- 12: the CSV backfill runs over whichever list you opened it from ---------- */
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

/* ---------- 13: the onboarding tracker is completely undisturbed ---------- */
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

  // birthdayList is deliberately NOT in this list: the Birthdays tab is the one screen that
  // is MEANT to change when members exist beside a roster, because it is merged. Everything
  // else on the onboarding side must be blind to them, which is what this asserts.
  for (const id of ["todayList", "memberList", "playbookList", "todayTable", "convBar"]) {
    assert.strictEqual(beside.html(id), alone.html(id),
      "#" + id + " renders exactly the same with a member list beside it");
  }
  // …and the merged tab is the exception, stated rather than left out
  assert.ok(beside.html("birthdayList").includes("Mo Member"),
    "the Birthdays tab does pick the member up — it is merged, and that is the point");
  assert.ok(!alone.html("birthdayList").includes("Mo Member"), "…and has nobody to pick up without one");

  assert.strictEqual(beside.el("todayCount").textContent, alone.el("todayCount").textContent);
  assert.strictEqual(beside.el("liveCount").textContent, alone.el("liveCount").textContent,
    "the live count counts challengers only");
  assert.deepStrictEqual(beside.cached(), alone.cached(), "and the roster blob that syncs is identical");
}

/* ---------- 14: the connected path — the two rosters sync, the tracker does not ----------
   Everything above drives the app with no Supabase behind it. This runs the real connected
   path against a stub client, to show that the only things travelling are the roster and the
   member list. Which tracker you are looking at is not stored anywhere, so it is not here. */
async function cloudTests() {
  /* --- boot pulls the two rosters, and nothing about the tracker --- */
  {
    const app = boot({ cloud: { rows: {
      roster: [challenger("c1", "Chris Challenger")],
      retention: [member("r1", "Mo Member")],
      seeded: true,
    } } });
    await app.ctx.bootData();

    assert.strictEqual(app.members().length, 1, "the roster came down");
    assert.strictEqual(app.retention().length, 1, "…and the member list");
    assert.ok(app.html("memberList").includes("Chris Challenger"));
    assert.ok(app.html("retMemberList").includes("Mo Member"));

    // and we are still at the front door: loading data does not pick a tracker for you
    assert.strictEqual(app.ctx.__t.tracker, null, "a connected boot still lands on the home screen");
    assert.strictEqual(app.el("homeScreen").classList.contains("hide"), false);
    assert.strictEqual(app.el("view-today").classList.contains("active"), false);

    // the realtime channel carries the shared DATA — the two rosters and the Playbook's
    // wording — and nothing about which screen anybody is looking at
    assert.deepStrictEqual(app.cloud.subscribedTo().slice().sort(),
      ["key=eq.playbook_overrides", "key=eq.retention", "key=eq.roster"],
      "no subscription for a tracker row");
  }

  /* --- a tracker row left over from the old build is never read or written --- */
  {
    const app = boot({ cloud: { rows: { tracker: { tracker: "retention" }, seeded: true } } });
    await app.ctx.bootData();
    assert.strictEqual(app.ctx.__t.tracker, null,
      "an orphaned tracker row has no effect — the app opens at home regardless");

    app.ctx.enterTracker("retention");
    app.ctx.goHome();
    app.ctx.enterTracker("onboarding");
    await settle();
    assert.strictEqual(app.cloud.writesTo("tracker").length, 0,
      "…and moving between trackers writes nothing to it");
    assert.deepStrictEqual(app.cloud.upserts.map((u) => u.key).filter((k) => k === "tracker"), [],
      "the tracker row is never touched at all");
  }

  /* --- the rosters still sync exactly as they did --- */
  {
    const app = boot({ cloud: { rows: { seeded: true } } });
    await app.ctx.bootData();
    app.ctx.enterTracker("onboarding");

    app.ctx.openAdd();
    app.el("f-name").value = "Nina New";
    app.ctx.saveMember();
    await settle();
    assert.deepStrictEqual(app.cloud.lastWriteTo("roster").value.map((m) => m.name), ["Nina New"],
      "a new challenger still goes up in the roster row");

    app.ctx.goHome();
    app.ctx.enterTracker("retention");
    app.ctx.openRetAdd();
    app.el("rf-name").value = "Mo Member";
    app.ctx.saveRetMember();
    await settle();
    assert.deepStrictEqual(app.cloud.lastWriteTo("retention").value.map((m) => m.name), ["Mo Member"],
      "…and a new member in the retention row");
    assert.deepStrictEqual(app.cloud.lastWriteTo("roster").value.map((m) => m.name), ["Nina New"],
      "…without disturbing the other");

    // A change from another device still lands on both, and never moves you out of the
    // tracker you are in. Stamped clear of our own write, or the echo guard would drop it.
    const later = () => new Date(Date.now() + 10000).toISOString();
    app.cloud.emit("roster", [challenger("c9", "Sent From Elsewhere")], later());
    assert.ok(app.html("memberList").includes("Sent From Elsewhere"), "incoming roster changes still render");
    app.cloud.emit("retention", [member("r9", "Also From Elsewhere")], later());
    assert.ok(app.html("retMemberList").includes("Also From Elsewhere"), "…and incoming member changes");
    assert.strictEqual(app.ctx.__t.tracker, "retention", "…without moving you anywhere");
    assert.strictEqual(app.el("view-ret-today").classList.contains("active"), true,
      "…or knocking you off the tab you were on");
  }
}

cloudTests()
  .then(() => console.log("retention.test.cjs: OK"))
  .catch((e) => { console.error(e); process.exit(1); });
