// CSV DOB import harness. Assertions: a GoTeamUp export of the whole gym updates ONLY the
// handful of people already in the tracker and creates nobody; existing dates of birth are
// left alone unless overwrite is asked for; blank and unreadable dates are skipped and
// counted; the counts add up and read the way the summary line promises; and the matching
// agrees, case for case, with the set-dob webhook's matcher — the two have to stay the same
// rule or a birthday would land on a different person depending on how it arrived.
const assert = require("assert");
const path = require("path");
const { boot, daysFromToday } = require("./lib/env.cjs");

function person(id, name, extra) {
  return Object.assign({
    id, name, coach: "Dan", dob: null,
    day0: daysFromToday(-7), booked: daysFromToday(-7), firstSessionDone: true,
    completed: [], doneMeta: {}, checks: {}, missed: [], outcome: null, signedUp: false,
    extraDays: 0, pausedDays: 0, pausedAt: null,
  }, extra || {});
}

// The roster: five people on the journey. The CSV below is the whole gym.
const ROSTER = () => ([
  person("m1", "Amy Benson"),                                        // matches, no dob
  person("m2", "Mark Ellison"),                                      // matches on messy spacing
  person("m3", "Priya Shah", { dob: "1992-01-05" }),                 // already has one
  person("m4", "Jo Barnes", { email: "jo.barnes@example.com" }),     // name differs, email matches
  person("m5", "Ned New"),                                           // not in the CSV at all
]);

const HEADER = "Full Name,First Name,Last Name,Email,Date of Birth";
const CSV = [
  HEADER,
  "Amy Benson,Amy,Benson,amy-benson@hotmail.com,1993-10-15",         // -> added
  "  mark   ELLISON ,Mark,Ellison,mark@example.com,1980-02-29",      // -> added (leap day, messy)
  "Priya Shah,Priya,Shah,p@example.com,1990-01-01",                  // -> already had one
  "Joanne Barnes,Joanne,Barnes,jo.barnes@example.com,1995-09-13",    // -> added via email
  "Gary Gymgoer,Gary,Gymgoer,gary@example.com,1975-03-02",           // -> not in tracker
  "Helen Hall,Helen,Hall,helen@example.com,1988-07-21",              // -> not in tracker
  "Ian Idle,Ian,Idle,ian@example.com,",                              // -> blank date
  "Kate Kettle,Kate,Kettle,kate@example.com,not a date",             // -> unreadable date
  "",                                                                 // -> blank line, not a row
].join("\n");

/* ---------- 1: the main event — update-only, nobody created ---------- */
{
  const app = boot({ members: ROSTER() });
  const before = app.members().length;
  const r = app.ctx.applyDobCsv(CSV, false);

  assert.strictEqual(r.ok, true);
  assert.strictEqual(app.members().length, before, "NOBODY was created");

  // who got what
  assert.strictEqual(app.find("m1").dob, "1993-10-15", "Amy Benson filled in");
  assert.strictEqual(app.find("m2").dob, "1980-02-29", "messy spacing and case still matched");
  assert.strictEqual(app.find("m3").dob, "1992-01-05", "an existing date of birth is NOT overwritten");
  assert.strictEqual(app.find("m4").dob, "1995-09-13", "matched on email when the name differed");
  assert.strictEqual(app.find("m5").dob, null, "somebody not in the file is untouched");

  // the counts, and that they add up
  assert.strictEqual(r.rows, 8, "8 data rows (the blank line is not a row)");
  assert.strictEqual(r.matched, 4);
  assert.strictEqual(r.added, 3);
  assert.strictEqual(r.alreadyHad, 1);
  assert.strictEqual(r.overwritten, 0);
  assert.strictEqual(r.noDob, 2, "one blank date, one unreadable");
  assert.strictEqual(r.noMatch, 2, "Gary and Helen are not in the tracker");
  assert.strictEqual(r.matched + r.noMatch + r.noDob, r.rows, "every row is accounted for");

  // it went out through the normal save path in one batch
  const cached = app.cached();
  assert.strictEqual(cached.length, before, "the synced blob has no new people either");
  assert.strictEqual(cached.find((m) => m.id === "m1").dob, "1993-10-15");
  assert.strictEqual(cached.find((m) => m.id === "m4").dob, "1995-09-13");

  // and it names names, so the summary can be checked by eye — using the TRACKER's spelling
  // of the name, not the CSV's, which is what you'd want to recognise on screen
  assert.deepStrictEqual([...r.updated].sort(), ["Amy Benson", "Jo Barnes", "Mark Ellison"]);
  assert.deepStrictEqual([...r.already], ["Priya Shah"]);

  // the summary line reads like the one in the brief
  const line = app.ctx.importSummaryLine(r);
  assert.ok(/^8 rows read · 4 matched · 3 DOBs added/.test(line), line);
  assert.ok(/1 already had a DOB/.test(line), line);
  assert.ok(/2 with no usable date \(skipped\)/.test(line), line);
  assert.ok(/2 not in tracker \(skipped\)\.$/.test(line), line);

  // the imported dates show up where they are meant to
  assert.ok(app.html("birthdayList").includes("Amy Benson"), "Amy is on the Birthdays tab");
  assert.ok(app.html("birthdayList").includes(">15th<"));
}

/* ---------- 2: overwrite is opt-in ---------- */
{
  const off = boot({ members: ROSTER() });
  off.ctx.applyDobCsv(CSV, false);
  assert.strictEqual(off.find("m3").dob, "1992-01-05", "off by default, so nothing is clobbered");

  const on = boot({ members: ROSTER() });
  const r = on.ctx.applyDobCsv(CSV, true);
  assert.strictEqual(on.find("m3").dob, "1990-01-01", "asked for, so it is replaced");
  assert.strictEqual(r.overwritten, 1);
  assert.strictEqual(r.alreadyHad, 0);
  assert.strictEqual(r.added, 3, "the empty ones are still 'added', not 'overwritten'");
  assert.ok(/1 overwritten/.test(on.ctx.importSummaryLine(r)));

  // a row that matches somebody whose date is ALREADY the same changes nothing either way
  const same = boot({ members: [person("s1", "Amy Benson", { dob: "1993-10-15" })] });
  const r2 = same.ctx.applyDobCsv(CSV, true);
  assert.strictEqual(r2.overwritten, 0, "identical dates are not 'overwritten'");
  assert.strictEqual(r2.alreadyHad, 1);
}

/* ---------- 3: a real-world file — quoted commas, CRLF, BOM, extra columns ---------- */
{
  const app = boot({ members: [person("q1", "O'Neill, Sarah"), person("q2", "Tom Smith")] });
  const csv = "﻿" + [
    'Member ID,Full Name,First Name,Last Name,Email,Date of Birth,Status',
    '1001,"O\'Neill, Sarah",Sarah,"O\'Neill",sarah@example.com,1991-06-04,Active',
    '1002,"Smith ""Tommo"" Tom",Tom,Smith,tom@example.com,1987-11-30,Active',
    '1003,Tom Smith,Tom,Smith,tom2@example.com,1989-05-05,Active',
  ].join("\r\n") + "\r\n";

  const r = app.ctx.applyDobCsv(csv, false);
  assert.strictEqual(r.rows, 3, "CRLF lines and the trailing newline are handled");
  assert.strictEqual(app.find("q1").dob, "1991-06-04", "a quoted name containing a comma matched");
  assert.strictEqual(app.find("q2").dob, "1989-05-05", "the row that really is Tom Smith won");
  assert.strictEqual(r.noMatch, 1, 'the "" escaped-quote row matched nobody');
  assert.strictEqual(app.members().length, 2, "still nobody created");

  // the parser itself, on the nasty bits
  // (rebuilt with the host's Array, or deepStrictEqual trips over the sandbox's prototype)
  const rows = [...app.ctx.parseCsv('a,"b,c","d""e"\n1,2,3\n')].map((r2) => [...r2]);
  assert.deepStrictEqual(rows, [["a", "b,c", 'd"e'], ["1", "2", "3"]]);
}

/* ---------- 4: Full Name preferred, First+Last as the fallback ---------- */
{
  const app = boot({ members: [person("f1", "Amy Benson")] });
  const noFull = ["First Name,Last Name,Email,Date of Birth",
    "Amy,Benson,amy@example.com,1993-10-15"].join("\n");
  app.ctx.applyDobCsv(noFull, false);
  assert.strictEqual(app.find("f1").dob, "1993-10-15", "built the name from First + Last");

  // a blank Full Name falls back too
  const app2 = boot({ members: [person("f2", "Amy Benson")] });
  app2.ctx.applyDobCsv([HEADER, ",Amy,Benson,amy@example.com,1993-10-15"].join("\n"), false);
  assert.strictEqual(app2.find("f2").dob, "1993-10-15");
}

/* ---------- 5: a file we can't use says so, and changes nothing ---------- */
{
  const app = boot({ members: ROSTER() });
  const noDobCol = app.ctx.applyDobCsv("Full Name,Email\nAmy Benson,amy@example.com", false);
  assert.strictEqual(noDobCol.ok, false);
  assert.ok(/Date of Birth/.test(noDobCol.error), noDobCol.error);
  assert.ok(/Columns found: Full Name, Email/.test(noDobCol.error), "it says what it did find");

  const noName = app.ctx.applyDobCsv("Something,Date of Birth\nx,1990-01-01", false);
  assert.strictEqual(noName.ok, false);
  assert.ok(/name or email/i.test(noName.error));

  assert.strictEqual(app.ctx.applyDobCsv("", false).ok, false, "an empty file is refused");
  assert.strictEqual(app.find("m1").dob, null, "and none of them changed anything");
  assert.strictEqual(app.members().length, 5);

  // a file where nothing matches is a success with a zero — not an error
  const nobody = boot({ members: ROSTER() });
  const r = nobody.ctx.applyDobCsv([HEADER,
    "Gary Gymgoer,Gary,Gymgoer,gary@example.com,1975-03-02"].join("\n"), false);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.added, 0);
  assert.strictEqual(r.noMatch, 1);
  assert.strictEqual(nobody.members().length, 5, "still nobody created");
}

/* ---------- 6: only real calendar dates get in ---------- */
{
  const app = boot({ members: [person("d1", "Amy Benson")] });
  for (const bad of ["", "  ", "not a date", "1990-02-30", "15/10/1993", "1990-13-01", "0000-01-01"]) {
    app.find("d1").dob = null;
    const r = app.ctx.applyDobCsv([HEADER, `Amy Benson,Amy,Benson,a@b.com,${bad}`].join("\n"), false);
    assert.strictEqual(app.find("d1").dob, null, JSON.stringify(bad) + " must not be stored");
    assert.strictEqual(r.noDob, 1, JSON.stringify(bad) + " counts as an unusable date");
    assert.strictEqual(r.matched, 0, "…and the row never reaches the matcher");
  }
  // an ISO date carrying a time is still fine
  app.find("d1").dob = null;
  app.ctx.applyDobCsv([HEADER, "Amy Benson,Amy,Benson,a@b.com,1993-10-15T00:00:00"].join("\n"), false);
  assert.strictEqual(app.find("d1").dob, "1993-10-15");
}

/* ---------- 7: the importer and the webhook match people the same way ---------- */
{
  // They have to live in two files — one runs in the browser, one on Netlify — so this
  // pins them together: same roster, same queries, same answers.
  const app = boot({ members: [] });
  const server = require(path.join(__dirname, "..", "netlify", "functions", "set-dob.js")).__test;

  const roster = [
    { id: "a", name: "Sarah Doyle", dob: null, email: "sarah@example.com" },
    { id: "b", name: "  mark   ELLISON ", dob: null },
    { id: "c", name: "Priya Shah", dob: "1992-01-05", email: "p@example.com" },
    { id: "d", name: "Sam Jones", dob: "1980-01-01", email: "old@example.com" },
    { id: "e", name: "Sam Jones", dob: null },
  ];
  const queries = [
    ["Sarah Doyle", ""], ["  sarah   doyle  ", ""], ["SARAH DOYLE", ""],
    ["Mark Ellison", ""], ["mark ellison", "anything@example.com"],
    ["Nobody Here", ""], ["Nobody Here", "sarah@example.com"],
    ["", "p@example.com"], ["", "nope@example.com"], ["", ""],
    ["Sam Jones", ""], ["Sam Jones", "old@example.com"], ["Sam Jones", "unknown@example.com"],
    ["Priya Shah", "p@example.com"],
  ];
  for (const [name, email] of queries) {
    const mine = app.ctx.findChallengerMatch(roster, name, email);
    const theirs = server.findMatch(roster, name, email);
    const label = `name=${JSON.stringify(name)} email=${JSON.stringify(email)}`;
    assert.strictEqual(mine.member ? mine.member.id : null,
      theirs.member ? theirs.member.id : null, "same person for " + label);
    assert.strictEqual(mine.matches, theirs.matches, "same match count for " + label);
    assert.strictEqual(mine.by, theirs.by, "same reason for " + label);
  }
  // and the two name-normalisers agree
  for (const s of ["  Sarah   Doyle ", "SARAH DOYLE", "", "  ", "a\tb", null, undefined]) {
    assert.strictEqual(app.ctx.normName(s), server.norm(s), "normName vs norm: " + JSON.stringify(s));
  }
}

/* ---------- 8: the rest of the app is undisturbed ---------- */
{
  const app = boot({ members: ROSTER() });
  const todayBefore = app.el("todayCount").textContent;
  app.ctx.applyDobCsv(CSV, false);
  app.ctx.renderMemberTable();

  assert.strictEqual(app.el("todayCount").textContent, todayBefore, "Today's moves is unchanged");
  assert.ok(app.html("memberList").includes("Amy Benson"), "cards still render");
  assert.ok(app.html("todayTable").includes("Amy Benson"), "the journey table still renders");
  ROSTER().forEach((m) => {
    const after = app.find(m.id);
    assert.strictEqual(after.name, m.name, m.name + "'s name is untouched");
    assert.strictEqual(after.outcome, m.outcome, "…as is their outcome");
    assert.strictEqual(after.day0, m.day0, "…and their clock");
  });

  // the import UI is wired up
  const fs = require("fs");
  const html = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
  assert.ok(/onclick="openImport\(\)"/.test(html), "there is a button to open it");
  assert.ok(/id="imp-file"[^>]*accept="\.csv/.test(html), "…a .csv file picker");
  assert.ok(/id="imp-overwrite"[^>]*type="checkbox"|type="checkbox"[^>]*id="imp-overwrite"/.test(html),
    "…and an overwrite checkbox");
  const box = /<input type="checkbox" id="imp-overwrite">/.test(html);
  assert.ok(box, "the overwrite checkbox carries no `checked`, so it is off by default");
}

console.log("csv-import.test.cjs: OK");
