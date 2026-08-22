// The welcome pack — four physical things, on the intro's own checklist.
//
// An intro session is two different jobs wearing one card. Five of them are systems admin:
// GoTeamUp, two things in Trainerize, the Ontraport card, the welcome message. The other four
// are objects you put in somebody's hands — a booklet, their InBody sheet, a workout journal
// and a handwritten card. They are all ticks on the same checklist, because they are all
// things that have to have happened before the intro is done, but they are not the same kind
// of work, so the list carries a sub-heading over each run.
//
// The handwritten card is the reason the last of them is here at all: it is what the day-7
// postcard used to be, moved from something we posted to a house to something we hand over.
//
// What this file mostly guards is the INDEXING. A challenger's ticks are an array of booleans
// keyed by position, and so are the wording overrides — so the four new lines had to go on the
// END, and a record saved when the list was five long has to grow into a nine-step list
// without any of its existing ticks sliding.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { boot, daysFromToday, settle } = require("./lib/env.cjs");

const HTML = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

const PACK = ["Welcome booklet", "InBody scan/sheet", "Workout journal", "Handwritten welcome card"];
const ADMIN = [
  "Add the 6 Week Challenge to their GoTeamUp account",
  "Add their Nutrition Goals to their Trainerize app",
  "Add the 6 Week Challenge Calendar to their Trainerize app",
  "Move their Profile Card to",
  "Send the Welcome Message on Trainerize",
];

// somebody whose intro is still to run — the one card that carries the checklist
const preStart = (id, name, extra) => Object.assign({
  id, name, coach: "Grace", booked: daysFromToday(2),
  completed: [], doneMeta: {}, checks: {}, missed: [],
  outcome: null, signedUp: false, extraDays: 0, pausedDays: 0, pausedAt: null,
}, extra || {});

// the intro card's checklist, sliced out of Today's moves
function checklist(app) {
  const h = app.html("todayList");
  const at = h.indexOf('<div class="checklist">');
  return at === -1 ? "" : h.slice(at, h.indexOf("checklist-progress") + 40);
}
const progress = (app) => (/(\d+) of (\d+) done/.exec(app.html("todayList")) || []).slice(1, 3).join("/");
// the order the boxes actually read down the card, headings included. Matched on the box-plus-
// label pair so the markup of an inline tool — which has spans of its own — is not mistaken
// for a step.
function readsAs(app) {
  return (checklist(app).match(
    /<span class="cg-label">[^<]*<\/span>|<span class="box">✓<\/span><span>[^<]*<\/span>/g) || [])
    .map((s) => s.replace(/<[^>]*>/g, "").replace(/^✓/, ""));
}

/* ---------- 1: the four items are on the intro, at the end of it ----------
   At the end because that is where they can be added without moving anything: a tick is
   stored by POSITION, so inserting them anywhere else would re-point every tick and every
   wording edit anybody has ever made at a different line. */
{
  const app = boot({ members: [] });
  const intro = app.ctx.__t.JOURNEY.find((it) => it.id === "intro");

  assert.strictEqual(intro.checklist.length, 9, "nine steps: five on the systems, four in the pack");
  assert.deepStrictEqual([...intro.checklist].slice(5), PACK,
    "the welcome pack is the last four, in the order it is packed");
  ADMIN.forEach((step, i) => {
    assert.ok(intro.checklist[i].startsWith(step),
      "step " + (i + 1) + " is still the systems step it always was: " + step);
  });

  // and it is the intro's own checklist — no second list, no new touchpoint
  assert.strictEqual(app.ctx.__t.JOURNEY.length, 7, "no touchpoint was added to hold the pack");
  assert.ok(!app.ctx.__t.JOURNEY.some((it) => it.id !== "intro" && it.checklist),
    "…and the intro is still the only touchpoint with a checklist at all");
}

/* ---------- 2: it reads as two jobs, not as nine boxes ---------- */
{
  const app = boot({ members: [preStart("p", "Ned New")] });
  const cl = checklist(app);

  assert.ok(/<span class="cg-label">On the systems<\/span>/.test(cl), "the admin run is labelled");
  assert.ok(/<span class="cg-label">Welcome pack<\/span>/.test(cl), "…and so is the pack");
  assert.ok(/<span class="cg-note">Handed over at the session<\/span>/.test(cl),
    "…with a word on what makes it different");
  assert.strictEqual((cl.match(/checklist-group/g) || []).length, 2, "two headings, no more");

  // the headings sit in the right places: at the top, and immediately before the booklet
  assert.deepStrictEqual(readsAs(app), [
    "On the systems", ...ADMIN.map((_, i) =>
      app.ctx.__t.JOURNEY.find((it) => it.id === "intro").checklist[i]),
    "Welcome pack", ...PACK,
  ], "the card reads: heading, five admin steps, heading, four pack items");

  // a heading is a row in the same list, not a box round part of it — the boxes stay in one
  // column, which is what keeps the card working at the width of a board lane
  assert.strictEqual((cl.match(/<div class="ci /g) || []).length, 9, "nine boxes");
  assert.ok(!/<div class="checklist">[\s\S]*<div class="checklist">/.test(cl),
    "…in one list, not a list inside a list");
  assert.ok(cl.indexOf('<span class="cg-label">Welcome pack') > cl.indexOf("Send the Welcome Message"),
    "the pack heading comes after the last admin step");
}

/* ---------- 3: they tick, and they count ---------- */
{
  const app = boot({ members: [preStart("p", "Ned New")] });
  assert.strictEqual(progress(app), "0/9", "nothing done yet, out of nine");

  // every one of the four is wired to the same handler as the five above it, by its index
  PACK.forEach((label, n) => {
    const i = 5 + n;
    assert.ok(checklist(app).includes("toggleCheck('p','intro'," + i + ")"),
      label + " is tickable at position " + i);
  });

  app.ctx.toggleCheck("p", "intro", 5);       // the booklet
  app.ctx.toggleCheck("p", "intro", 8);       // the handwritten card
  assert.strictEqual(progress(app), "2/9", "two of nine done");
  assert.deepStrictEqual([...app.find("p").checks.intro],
    [false, false, false, false, false, true, false, false, true],
    "…and it is those two positions that are set, with no holes anywhere");

  // ticked items read as ticked
  const cl = checklist(app);
  assert.ok(/<div class="ci checked"[^>]*intro',5\)/.test(cl), "the booklet shows as done");
  assert.ok(/<div class="ci checked"[^>]*intro',8\)/.test(cl), "…and so does the card");
  assert.ok(/<div class="ci "[^>]*intro',6\)/.test(cl), "…and the two between them do not");

  // and untick works the same way
  app.ctx.toggleCheck("p", "intro", 5);
  assert.strictEqual(progress(app), "1/9", "unticking takes it back off");

  // the ticks go through the roster's own save, like every other tick on the card
  assert.deepStrictEqual(app.cached()[0].checks.intro,
    [false, false, false, false, false, false, false, false, true],
    "…and what is stored is what is on screen");
}

/* ---------- 4: a challenger saved before the pack existed grows into it ----------
   Five booleans for a nine-step list. Ticking the ninth must not leave holes in the middle:
   a sparse array comes back from a JSON round trip as nulls, and this list is stored in the
   cloud and read by every other device. */
{
  const old = preStart("o", "Wendy Booth", { checks: { intro: [true, true, false, false, false] } });
  const app = boot({ members: [old] });

  assert.strictEqual(progress(app), "2/9",
    "her two ticks are still her two ticks, now counted out of nine");
  assert.ok(/<div class="ci checked"[^>]*intro',0\)/.test(checklist(app)),
    "…and they are still against the steps she made them against");
  assert.ok(/<div class="ci "[^>]*intro',5\)/.test(checklist(app)),
    "…with the pack showing as nothing done yet");

  app.ctx.toggleCheck("o", "intro", 8);
  const state = app.find("o").checks.intro;
  assert.strictEqual(state.length, 9, "the array grew to fit the list");
  assert.ok(state.every((v) => typeof v === "boolean"), "…as booleans, with no holes punched in it");
  assert.deepStrictEqual([...state],
    [true, true, false, false, false, false, false, false, true],
    "…her old ticks in place and the new one at the end");
  assert.strictEqual(progress(app), "3/9");
  assert.strictEqual(JSON.stringify(app.cached()[0].checks), '{"intro":[true,true,false,false,false,false,false,false,true]}',
    "and what is stored for the other devices is nine booleans — not a hole in sight");
}

/* ---------- 5: the rest of the intro card is where it was ----------
   The two tools that live INSIDE this checklist hang off the step the code defines, and both
   of them are in the admin run above the pack. "Handwritten welcome card" is the one to watch:
   it is four steps below "Send the Welcome Message" and reads a lot like it. */
{
  const app = boot({ members: [preStart("p", "Ned New")] });
  const cl = checklist(app);

  assert.ok(/Add their Nutrition Goals[\s\S]{0,80}?<div class="ci-tool"><div class="nutblock/.test(cl),
    "the nutrition calculator is still under the nutrition step");
  assert.ok(/Send the Welcome Message on Trainerize[\s\S]{0,80}?<div class="ci-tool">[\s\S]{0,80}?wm-toggle/.test(cl),
    "…and the Trainerize message under the message step");
  assert.strictEqual((cl.match(/ci-tool/g) || []).length, 2, "two tools, exactly where they were");
  assert.ok(!/Handwritten welcome card<\/span><\/div><div class="ci-tool"/.test(cl),
    "the handwritten CARD did not collect the Trainerize MESSAGE on its way past");

  // the walkthrough link and the start-the-clock block are untouched
  const card = app.html("todayList");
  assert.ok(/class="walk-link"/.test(card), "the walkthrough link is still on the card");
  assert.ok(/class="startblock"/.test(card), "…and the start-the-clock block");
  assert.ok(card.indexOf("walk-link") < card.indexOf('<div class="checklist">'),
    "…both above the checklist, where they were");
}

/* ---------- 6: the Playbook shows the same nine, numbered straight through ---------- */
{
  const app = boot({ members: [] });
  const pb = app.html("playbookList");

  for (const item of PACK) assert.ok(pb.includes(item), "the deck carries " + item);
  assert.ok(/<div class="pbx-substep">On the systems<\/div>/.test(pb), "the admin run is labelled");
  assert.ok(/<div class="pbx-substep">Welcome pack<\/div>/.test(pb), "…and so is the pack");
  assert.strictEqual((pb.match(/<li>/g) || []).length, 9, "nine numbered steps on the card");

  /* Two lists, because a heading cannot sit inside one — but the numbering runs on rather than
     restarting, so the card reads 01 to 09 down the page. counter-reset:pbx N makes the next
     item N+1, so the second list opens at 06. */
  assert.ok(/<div class="pbx-substep">Welcome pack<\/div><ol style="counter-reset:pbx 5">/.test(pb),
    "the second list picks the numbering up at 06 rather than starting again at 01");
  assert.ok(/<div class="pbx-substep">On the systems<\/div><ol>/.test(pb),
    "…and the first one is the plain <ol> it always was");

  // a touchpoint with no groups is unchanged: one list, no reset, no heading
  const bare = app.ctx.playbookCardHtml({ id: "x", ch: "digital", day: 1, phase: "journey",
    title: "Something", what: "Do it.", owner: "coach", checklist: ["one", "two"] });
  assert.ok(/<div class="pbx-sub">How it’s done<\/div>\s*<ol><li>one<\/li><li>two<\/li><\/ol>/.test(bare),
    "no groups, no headings and no counter games — the markup this always emitted");
}

/* ---------- 7: the wording of a pack item is editable, like every other step ----------
   Nothing special was needed for this — the overrides are keyed by step index and the four new
   steps have indices — but it is worth pinning, because the handwritten card is the one line
   in the app that carries what the postcard used to say, and it is the line most likely to be
   rewritten. */
{
  const app = boot({ members: [preStart("p", "Ned New")] });
  assert.strictEqual(app.ctx.pbSetField("intro", "step8", "Handwritten card — short, warm, specific"), true,
    "the handwritten card can be reworded");
  app.ctx.renderAll();
  assert.ok(app.html("playbookList").includes("Handwritten card — short, warm, specific"),
    "…on the deck");
  assert.ok(checklist(app).includes("Handwritten card — short, warm, specific"),
    "…and on the card a coach ticks");
  assert.ok(!checklist(app).includes("Handwritten welcome card"), "…in place of the default");

  // it is still the same box, in the same place, doing the same thing
  assert.ok(checklist(app).includes("toggleCheck('p','intro',8)"), "…and still tickable at 8");
  app.ctx.toggleCheck("p", "intro", 8);
  assert.strictEqual(progress(app), "1/9", "…and ticking it still counts");

  app.ctx.pbResetField("intro", "step8");
  app.ctx.renderAll();
  assert.ok(checklist(app).includes("Handwritten welcome card"), "Reset brings the default back");
  assert.strictEqual(progress(app), "1/9", "…and the tick is untouched by any of it");

  // the group HEADINGS are not editable — they are structure, and structure stays in code
  assert.strictEqual(app.ctx.pbSetField("intro", "group1", "Something else"), false,
    "a sub-heading is not a text field a coach can rewrite");
  assert.strictEqual(app.ctx.pbSetField("intro", "checklistGroups", "[]"), false,
    "…nor is the grouping itself");
}

/* ---------- 8: the layout holds at a board lane's width and on a phone ----------
   The card lives in one of seven columns on a desktop and full width on a phone. A heading
   that laid a box round part of the list, or floated its note beside a label with nowhere to
   wrap, is what would break it — so both are asserted on the stylesheet. */
{
  const CSS = HTML.slice(HTML.indexOf("<style>") + 7, HTML.indexOf("</style>"));
  // every `selector { body }` in the sheet, the same way layout.test.cjs reads it
  const RULES = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((m) => ({ sel: m[1].replace(/\/\*[\s\S]*?\*\//g, "").trim(), body: m[2] }))
    .filter((r) => r.sel && !r.sel.startsWith("@"));
  const rule = (sel) => {
    const r = RULES.find((x) => x.sel.split(",").map((t) => t.trim()).includes(sel));
    return r ? r.body : null;
  };
  const group = rule(".checklist-group");
  assert.ok(group, "the heading has a rule of its own");
  assert.ok(/flex-wrap:\s*wrap/.test(group),
    "the label and its note wrap rather than forcing the column wider. Found: " + group.trim());
  assert.ok(!/position:\s*absolute|float:/.test(group),
    "…and it stays in the flow of the list, so nothing overlaps a box");

  // the list itself is untouched: still one flex column, so nine rows stack exactly as five did
  const list = rule(".checklist");
  assert.ok(/flex-direction:\s*column/.test(list), "the checklist is still a single column");

  // no fixed width or height anywhere in the new rules — the card is measured by its lane
  for (const sel of [".checklist-group", ".cg-label", ".cg-note", ".pbx-substep"]) {
    const body = rule(sel);
    assert.ok(body, sel + " is defined");
    assert.ok(!/(^|;)\s*(width|height)\s*:\s*\d/.test(body),
      sel + " must not be given a fixed size — it has to fit a board lane and a phone. Found: "
      + body.trim());
  }
}

/* ---------- 9: none of it disturbed the journey ----------
   The pack is four lines on a checklist. It is not a touchpoint, it fires on no day, and it
   is not on the board. */
{
  const app = boot({ members: [preStart("p", "Ned New")] });
  const board = app.html("todayList").slice(app.html("todayList").indexOf('<div class="board">'));

  assert.strictEqual((board.match(/<div class="board-col"/g) || []).length, 1,
    "the intro still has its own lane, outside the week folder");
  assert.strictEqual((board.match(/id="wktab-\d"/g) || []).length, 6, "…and the weeks are six tabs");
  assert.strictEqual((board.match(/id="act-p-/g) || []).length, 1,
    "…and one card for Ned, not five: the pack is inside his intro, not beside it");
  assert.ok(board.includes("act-p-intro"), "…which is the intro");

  // the intro still fires where it always did, and is still the only pre-journey touchpoint
  const intro = app.ctx.__t.JOURNEY.find((it) => it.id === "intro");
  assert.strictEqual(intro.day, -1, "the intro's day is untouched");
  assert.strictEqual(intro.phase, "intro", "…and its phase");
  assert.strictEqual(app.ctx.journeyWeek(intro), 0, "…so it is in no week");
  assert.strictEqual(app.ctx.dayBadge(intro), "Before Day 0", "…and badged as it always was");
}

/* ---------- 10: the pack survives the trip through the shared backend ---------- */
(async () => {
  const app = boot({ cloud: { rows: {
    roster: [preStart("p", "Ned New", { checks: { intro: [true, true, false, false, false] } })],
    seeded: true,
  } } });
  await app.ctx.bootData();
  assert.strictEqual(progress(app), "2/9", "an old record pulled from the cloud reads out of nine");

  app.ctx.toggleCheck("p", "intro", 6);
  await settle();
  const pushed = app.cloud.lastWriteTo("roster");
  assert.deepStrictEqual(pushed.value[0].checks.intro,
    [true, true, false, false, false, false, true, false, false],
    "the grown array is what goes to the other devices — nine booleans, no nulls");

  // and another coach's tick arrives the same way. Stamped clear of our own write above, or
  // the app reads it as the echo of that write and ignores it — which is what it is for.
  app.cloud.emit("roster", [preStart("p", "Ned New",
    { checks: { intro: [true, true, true, true, true, true, true, true, true] } })],
    new Date(Date.now() + 60000).toISOString());
  assert.strictEqual(progress(app), "9/9", "…and lands on this screen as nine of nine");

  console.log("welcome-pack.test.cjs: OK");
})();
