// Shared per-client notes harness. Assertions: one notes document per client, saved through
// the app's normal save path so every coach on every device gets the same thing; the icon
// appears beside the name on every surface and is only coloured when there is something to
// read; the formatting the editor produces round-trips through save and reload; pasted
// markup can never carry anything executable into storage; typing never re-renders the page
// under the cursor; and the icon cannot trigger the card action it sits inside.
const assert = require("assert");
const { boot, daysFromToday, dateInput } = require("./lib/env.cjs");

const LIVE = {
  id: "sam", name: "Sam Live", coach: "Grace", personal: "wedding in June",
  day0: daysFromToday(-7), booked: daysFromToday(-7), firstSessionDone: true,
  completed: ["intro"], doneMeta: {}, checks: {}, missed: [],
  outcome: null, signedUp: false, extraDays: 0, pausedDays: 0, pausedAt: null,
};
const NOTSTARTED = { id: "new", name: "Ned New", coach: "Dan", booked: daysFromToday(3),
  day0: null, firstSessionDone: false, completed: [], doneMeta: {}, checks: {}, missed: [], outcome: null };

// type into the editor exactly as the browser would, then let the app save it
function type(app, id, html) {
  app.ctx.openNotes(id);
  app.el("notesEd").innerHTML = html;
  app.ctx.notesTouched();
  app.ctx.notesFlush();
}

/* ---------- 1: notes save through the normal sync path ---------- */
{
  const app = boot({ members: [LIVE] });
  type(app, "sam", "<b>Knee</b> plays up on lunges — sub in split squats.");

  const m = app.find("sam");
  assert.ok(m.notes.includes("Knee"), "the note is on the challenger record");
  assert.strictEqual(app.cached()[0].notes, m.notes, "…and in the blob that syncs to everyone");
  assert.strictEqual(app.el("notesSaved").textContent, "Saved ✓");
  assert.ok(app.el("notesSaved").classList.contains("on"));

  // a second device loading that blob sees the same single document
  const other = boot({ members: app.cached() });
  assert.strictEqual(other.find("sam").notes, m.notes, "one shared document, not a per-coach copy");
  assert.strictEqual(other.ctx.hasNotes(other.find("sam")), true);
}

/* ---------- 2: has-notes vs empty, including the editor's empty artefacts ---------- */
{
  const app = boot({ members: [LIVE] });
  const m = app.find("sam");
  assert.strictEqual(app.ctx.hasNotes(m), false, "a new challenger has no notes");

  // contenteditable leaves these behind when you delete everything you typed
  for (const empty of ["", "<br>", "<div><br></div>", "&nbsp;", "<p>  </p>", "<ul><li><br></li></ul>"]) {
    type(app, "sam", empty);
    assert.strictEqual(app.ctx.hasNotes(app.find("sam")), false, JSON.stringify(empty) + " is not a note");
    assert.strictEqual(app.find("sam").notes, "", "…and is stored as nothing at all");
  }
  type(app, "sam", "<div>x</div>");
  assert.strictEqual(app.ctx.hasNotes(app.find("sam")), true);
}

/* ---------- 3: the icon is on every surface, and only lit when there is something ---------- */
{
  const leaver = { ...LIVE, id: "fin", name: "Kelly Finished", day0: daysFromToday(-60),
    booked: daysFromToday(-60), completed: [] };
  const app = boot({ members: [LIVE, NOTSTARTED, leaver] });
  app.ctx.openFollowUp("fin");
  app.el("fu-date").value = dateInput(daysFromToday(0));
  app.ctx.confirmFollowUp();
  app.ctx.renderMemberTable();

  const surfaces = {
    "Today's moves": () => app.html("todayList"),
    "Challenger cards": () => app.html("memberList"),
    "Whole journey table": () => app.html("todayTable"),
  };

  // before any notes: an icon everywhere, none of them lit
  for (const [name, get] of Object.entries(surfaces)) {
    const h = get();
    assert.ok(h.includes("notes-btn"), name + " shows the notes icon");
    assert.ok(/openNotes\(&#39;sam&#39;\)|openNotes\('sam'\)/.test(h), name + " wires the icon to the client");
    assert.ok(!h.includes('notes-btn has'), name + " shows no lit icon yet");
  }
  // the follow-up row carries one too — that client is reachable from nowhere else on Today
  assert.ok(/Follow-ups to make[\s\S]*?openNotes\((&#39;|')fin\1\)/.test(app.html("todayList")),
    "the follow-up task has a notes icon");

  // write a note for Sam only
  type(app, "sam", "<div>Prefers early sessions.</div>");
  app.ctx.closeNotes();
  app.ctx.renderMemberTable();

  for (const [name, get] of Object.entries(surfaces)) {
    const h = get();
    assert.ok(h.includes('notes-btn has'), name + " lights the icon for the client with notes");
    // …and only for that one: Ned still has none
    const nedChunk = h.slice(Math.max(0, h.indexOf("Ned New") - 400), h.indexOf("Ned New") + 400);
    if (h.includes("Ned New")) assert.ok(!nedChunk.includes("notes-btn has"), name + ": Ned's icon stays muted");
  }
  // the title tells you which it is, for screen readers and hover
  assert.ok(app.html("memberList").includes("Notes — Sam Live"));
  assert.ok(app.html("memberList").includes("Add notes — Ned New"));
}

/* ---------- 4: the icon cannot trigger the row it sits inside ---------- */
{
  const app = boot({ members: [LIVE] });
  const today = app.html("todayList");
  // every notes button stops the click before the card's expand/tap handler sees it
  const buttons = today.match(/<button[^>]*class="notes-btn[^"]*"[^>]*>/g) || [];
  assert.ok(buttons.length > 0, "sanity: Today has notes buttons");
  buttons.forEach((b) => assert.ok(/onclick="event\.stopPropagation\(\)/.test(b),
    "a notes icon must stop propagation: " + b));
}

/* ---------- 5: formatting round-trips through save and a fresh load ---------- */
{
  const app = boot({ members: [LIVE] });
  const rich = '<h3>Injuries</h3><div>Left <b>knee</b>, <i>mild</i>, <strike>shoulder</strike></div>'
    + '<ul><li>No jumping</li><li>Split squats instead</li></ul>';
  type(app, "sam", rich);

  // reload the way a returning device does: through migrateList, off the cached blob
  const reloaded = boot({ members: app.cached() });
  const back = reloaded.find("sam").notes;
  for (const frag of ["<h3>", "<b>", "<i>", "<strike>", "<ul>", "<li>", "Split squats instead"]) {
    assert.ok(back.includes(frag), "kept " + frag + " through save + reload");
  }
  // and opening the editor puts it back in front of you
  reloaded.ctx.openNotes("sam");
  assert.strictEqual(reloaded.el("notesEd").innerHTML, back, "the editor reopens on what was saved");
  assert.strictEqual(reloaded.el("notesWho").textContent, "Sam Live");
  assert.ok(reloaded.el("notesBg").classList.contains("show"), "the modal opens");
}

/* ---------- 6: the toolbar drives the real formatting commands ---------- */
{
  const app = boot({ members: [LIVE] });
  app.ctx.openNotes("sam");
  app.ctx.notesFormat("bold");
  app.ctx.notesFormat("italic");
  app.ctx.notesFormat("strikeThrough");
  app.ctx.notesFormat("insertUnorderedList");
  assert.deepStrictEqual(app.execCommands.map((c) => c.cmd),
    ["bold", "italic", "strikeThrough", "insertUnorderedList"]);

  // H toggles: plain text -> heading, and a second press back to a paragraph
  app.setFormatBlock("div");
  app.ctx.notesHeading();
  assert.deepStrictEqual(app.execCommands.at(-1), { cmd: "formatBlock", arg: "h3" });
  app.setFormatBlock("h3");
  app.ctx.notesHeading();
  assert.deepStrictEqual(app.execCommands.at(-1), { cmd: "formatBlock", arg: "p" },
    "pressing H on a heading puts it back to normal text");
}

/* ---------- 7: nothing executable ever reaches storage, the sync, or the editor ---------- */
{
  const app = boot({ members: [LIVE] });
  const nasty = 'Careful <script>alert(1)</script><img src=x onerror="alert(2)">'
    + '<a href="javascript:alert(3)">tap</a><iframe src="//evil.example"></iframe>'
    + "<div onclick='alert(4)'>text</div><style>body{display:none}</style>";
  type(app, "sam", nasty);

  const saved = app.find("sam").notes;
  for (const bad of ["<script", "</script", "<iframe", "<style", "onerror", "onclick", "javascript:"]) {
    assert.ok(!saved.toLowerCase().includes(bad), "stripped " + bad + " before saving");
  }
  assert.ok(saved.includes("Careful"), "…while keeping the actual note");
  assert.strictEqual(app.cached()[0].notes, saved, "what syncs is the sanitised copy");

  // and a nasty note that somehow arrived from elsewhere is cleaned on the way INTO the editor
  const hostile = boot({ members: [{ ...LIVE, notes: '<script>alert(1)</script><b>hi</b>' }] });
  hostile.ctx.openNotes("sam");
  const inEditor = hostile.el("notesEd").innerHTML;
  assert.ok(!inEditor.toLowerCase().includes("<script"), "sanitised on open too");
  assert.ok(inEditor.includes("<b>hi</b>"));
}

/* ---------- 8: typing never re-renders the page under the cursor ---------- */
{
  const app = boot({ members: [LIVE] });
  const before = app.html("memberList");
  app.ctx.openNotes("sam");
  app.el("notesEd").innerHTML = "<div>half a sen";
  app.ctx.notesTouched();
  app.ctx.notesFlush();                       // the debounced save fires mid-sentence

  assert.strictEqual(app.find("sam").notes, "<div>half a sen", "the half-written note is saved");
  assert.strictEqual(app.html("memberList"), before,
    "…but nothing re-rendered — a re-render would tear the editor out from under the cursor");
  assert.strictEqual(app.el("notesBg").classList.contains("show"), true, "still open, still typing");

  app.ctx.closeNotes();                       // the render happens here instead
  assert.notStrictEqual(app.html("memberList"), before, "closing refreshes the icons");
  assert.ok(app.html("memberList").includes("notes-btn has"));
  assert.strictEqual(app.el("notesBg").classList.contains("show"), false);
  assert.strictEqual(app.ctx.__t.notesTarget, null, "and lets go of the client");
}

/* ---------- 9: closing by tapping the backdrop still saves ---------- */
{
  const app = boot({ members: [LIVE] });
  app.ctx.openNotes("sam");
  app.el("notesEd").innerHTML = "<div>never lose this</div>";
  app.el("notesBg").__fire("click", { target: { id: "notesBg" } });   // tap outside the modal
  assert.strictEqual(app.find("sam").notes, "<div>never lose this</div>", "backdrop close saves");
  assert.strictEqual(app.el("notesBg").classList.contains("show"), false);
}

/* ---------- 10: notes are per client and survive the rest of the app ---------- */
{
  const app = boot({ members: [LIVE, NOTSTARTED] });
  type(app, "sam", "<div>sam only</div>");
  app.ctx.closeNotes();
  assert.strictEqual(app.find("new").notes, "", "Ned's notes are his own");

  // the ordinary journey actions leave notes alone
  app.ctx.toggleDone("sam", "d1_text", true);
  app.ctx.pause("sam");
  app.ctx.resume("sam");
  app.ctx.setOutcome("sam", "left");
  app.ctx.setOutcome("sam", null);
  assert.strictEqual(app.find("sam").notes, "<div>sam only</div>", "notes survive the rest of the app");
  assert.strictEqual(app.cached().find((m) => m.id === "sam").notes, "<div>sam only</div>");
}

console.log("notes.test.cjs: OK");
