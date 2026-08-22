// The Playbook's WORDS are the team's; the journey is not.
//
// Every touchpoint's copy — its title, its principle, its description, the steps under it —
// can be rewritten in the app by anyone who taps the pen, and the new words travel to every
// other coach's device through the same backend the rosters use. What CANNOT be rewritten is
// the journey itself: which day a touchpoint fires, whether it exists, its channel, its
// owner, its conditions. Those stay in code.
//
// That line is the whole subject of this file, and it is tested from both sides. One half
// asserts that an edit really does land everywhere the same sentence is shown — the deck, the
// card a coach taps on Today's moves, the tooltip in the journey table — because a wording
// layer that only fixed one of the three would leave the app disagreeing with itself. The
// other half asserts that nothing an edit can possibly be — a blank, a script tag, a payload
// hand-written into the row by somebody with the keys — moves a day, invents a touchpoint or
// disturbs a challenger's Done/Missed.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { boot, daysFromToday, settle } = require("./lib/env.cjs");

const HTML = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

// a live challenger, n days into their journey (intro already done)
const live = (id, name, day) => ({
  id, name, coach: "Grace",
  day0: daysFromToday(-day), booked: daysFromToday(-day), firstSessionDone: true,
  completed: ["intro"], doneMeta: {}, checks: {}, missed: [],
  outcome: null, signedUp: false, extraDays: 0, pausedDays: 0, pausedAt: null,
});
// somebody whose intro is still to run — the challenger whose card carries the checklist
const preStart = (id, name) => ({
  id, name, coach: "Grace", booked: daysFromToday(2),
  completed: [], doneMeta: {}, checks: {}, missed: [],
  outcome: null, signedUp: false, extraDays: 0, pausedDays: 0, pausedAt: null,
});

// The shape of the journey, as everything that is not wording sees it. Deep-frozen into a
// string so any change at all — a day, an id, an order, a flag — shows up as a difference.
function shapeOf(ctx) {
  return JSON.stringify(ctx.__t.JOURNEY.map((it) => ({
    id: it.id, day: it.day, ch: it.ch, owner: it.owner, phase: it.phase,
    win: !!it.win, conditional: it.conditional || null,
    steps: (it.checklist || []).length, seed: !!it.seed, walkthrough: !!it.walkthrough,
  })));
}
// the whole-journey table, rendered
function tableHtml(app) {
  app.ctx.setTodayView("table");
  const html = app.html("todayTable");
  app.ctx.setTodayView("moves");
  return html;
}
// The overrides map lives inside the vm, so it is compared through JSON — a plain object
// from another realm is not deepStrictEqual to one from this one.
const ov = (app) => JSON.parse(JSON.stringify(app.ctx.__t.pbOverrides));

const DEFAULT_WK2 = "Start of Week 2 check-in";
const DEFAULT_WHY_WK2 = "Name the win before they start doubting it.";

/* ---------- 1: with no overrides, the app is exactly the app ----------
   The layer is additive. A device that has never had an edit — which is every device until
   somebody makes the first one — reads its text out of the code, and the empty case is the
   normal case rather than an error waiting to happen. */
{
  const app = boot({ members: [live("a", "Sam Live", 7)] });
  assert.deepStrictEqual(ov(app), {}, "nothing overridden at boot");
  assert.strictEqual(app.stored("bsj_playbook_cache"), null, "…and nothing written for the sake of it");

  const pb = app.html("playbookList");
  assert.ok(pb.includes(DEFAULT_WK2), "the deck shows the code's title");
  assert.ok(pb.includes(DEFAULT_WHY_WK2), "…its principle");
  assert.ok(pb.includes("give a <b>named win</b>"), "…and its body copy, emphasis and all");
  assert.ok(app.html("todayList").includes(DEFAULT_WK2), "Today's moves shows the same title");
  assert.ok(tableHtml(app).includes(DEFAULT_WK2), "…and so does the journey table");

  // the resolvers hand back the code's copy touchpoint by touchpoint, with nothing missing
  for (const it of app.ctx.__t.JOURNEY) {
    assert.strictEqual(app.ctx.tpTitle(it), it.title, it.id + ": title is the default");
    assert.strictEqual(app.ctx.tpWhatHtml(it), it.what, it.id + ": body is the default");
    assert.strictEqual(app.ctx.tpWhy(it), app.ctx.__t.PB_WHY[it.id] || "", it.id + ": why is the default");
    assert.strictEqual(JSON.stringify(app.ctx.tpSteps(it)), JSON.stringify(it.checklist || []),
      it.id + ": steps are the defaults");
  }
}

/* ---------- 2: an edit lands on EVERY screen that says the same sentence ----------
   This is the reason the words live in a layer over JOURNEY rather than in the Playbook's own
   copy deck. A coach who renames a touchpoint has renamed it — not renamed it here and left
   the card they tap at 7am calling it something else. */
{
  const app = boot({ members: [live("a", "Sam Live", 7)] });
  assert.strictEqual(app.ctx.pbSetField("wk2", "title", "Week 2 — the check-in that matters"), true);
  assert.strictEqual(app.ctx.pbSetField("wk2", "why", "Catch them before the doubt does."), true);
  assert.strictEqual(app.ctx.pbSetField("wk2", "what", "Voice note. Warm, specific, short."), true);
  app.ctx.renderAll();

  const pb = app.html("playbookList");
  assert.ok(pb.includes("Week 2 — the check-in that matters"), "the deck says the new title");
  assert.ok(pb.includes("Catch them before the doubt does."), "…the new principle");
  assert.ok(pb.includes("Voice note. Warm, specific, short."), "…the new description");
  assert.ok(!pb.includes(DEFAULT_WK2), "…and not the old title as well");
  assert.ok(!pb.includes(DEFAULT_WHY_WK2), "…nor the old principle");

  const today = app.html("todayList");
  assert.ok(today.includes("Week 2 — the check-in that matters"), "Today's moves says the new title");
  assert.ok(today.includes("Voice note. Warm, specific, short."), "…and the new description in the detail");
  assert.ok(!today.includes(DEFAULT_WK2), "…with the old wording gone from the card");

  const tbl = tableHtml(app);
  assert.ok(tbl.includes("Week 2 — the check-in that matters"), "the journey table's cell says the new title");
  assert.ok(!tbl.includes(DEFAULT_WK2), "…and not the old one");

  // one touchpoint edited is one touchpoint edited — the rest of the deck is untouched
  assert.ok(pb.includes("Start of Week 3 check-in — plant the seed"), "week 3 still says what the code says");
}

/* ---------- 3: the practical text as well as the headline ----------
   Steps and the seed line are what a coach actually reads while doing the thing, so they are
   editable too — and they are shown in two places apiece, which is exactly the trap. */
{
  const app = boot({ members: [preStart("p", "Ned New"), live("s", "Sara Seed", 14)] });
  assert.strictEqual(app.ctx.pbSetField("intro", "step0", "Set them up on GoTeamUp for the 6 Week Challenge"), true);
  assert.strictEqual(app.ctx.pbSetField("wk3", "seed", "You are settling in. Let's talk about what comes after."), true);
  app.ctx.renderAll();

  const pb = app.html("playbookList");
  assert.ok(pb.includes("Set them up on GoTeamUp for the 6 Week Challenge"), "the deck's step 1 is reworded");
  assert.ok(!pb.includes("Add the 6 Week Challenge to their GoTeamUp account"), "…and the old wording is gone");
  assert.ok(pb.includes("You are settling in. Let’s talk about what comes after.")
         || pb.includes("You are settling in. Let&#39;s talk about what comes after."),
    "the seed line is reworded on the deck");

  const today = app.html("todayList");
  assert.ok(today.includes("Set them up on GoTeamUp for the 6 Week Challenge"),
    "the checklist on Ned's intro card says the same new words");
  assert.ok(today.includes("You are settling in."), "and Sara's card carries the new seed line");

  // the remaining four steps are untouched, and there are still five of them
  const intro = app.ctx.__t.JOURNEY.find((it) => it.id === "intro");
  assert.strictEqual(app.ctx.tpSteps(intro).length, intro.checklist.length, "still five steps");
  assert.strictEqual(app.ctx.tpSteps(intro)[4], intro.checklist[4], "step 5 is still the code's");

  /* The tools that sit INSIDE the checklist hang off the step the code defines, not off the
     words on the screen. Rewriting "Add their Nutrition Goals" must not take the calculator
     away with it — which it would, if the match were made against what is displayed. */
  assert.strictEqual(app.ctx.pbSetField("intro", "step1", "Put their macros into Trainerize"), true);
  assert.strictEqual(app.ctx.pbSetField("intro", "step4", "Fire off the Trainerize welcome"), true);
  app.ctx.renderAll();
  const card = app.html("todayList");
  assert.ok(card.includes("Put their macros into Trainerize"), "step 2 reworded");
  assert.ok(/Put their macros into Trainerize<\/span>[\s\S]{0,60}?<div class="ci-tool"><div class="nutblock/.test(card),
    "…and the nutrition calculator is still sitting under that step");
  assert.ok(card.includes("Fire off the Trainerize welcome"), "step 5 reworded");
  assert.ok(/Fire off the Trainerize welcome<\/span>[\s\S]{0,60}?<div class="ci-tool">[\s\S]{0,80}?wm-toggle/.test(card),
    "…and the welcome message under that one");
}

/* ---------- 4: Reset puts the code's words back ----------
   A bad edit has to be one tap from undone, or nobody will risk making a good one. */
{
  const app = boot({ members: [live("a", "Sam Live", 7)] });
  app.ctx.pbSetField("wk2", "title", "Nonsense");
  app.ctx.pbSetField("wk2", "why", "Also nonsense");
  app.ctx.renderAll();
  assert.ok(app.html("playbookList").includes("Nonsense"), "sanity: the bad edit is live");

  assert.strictEqual(app.ctx.pbResetField("wk2", "title"), true, "reset reports that it did something");
  app.ctx.renderAll();
  let pb = app.html("playbookList");
  assert.ok(pb.includes(DEFAULT_WK2), "the code's title is back on the deck");
  assert.ok(!pb.includes("Nonsense</h3>"), "…and the bad one is gone");
  assert.ok(pb.includes("Also nonsense"), "the OTHER field is not collateral damage");
  assert.ok(app.html("todayList").includes(DEFAULT_WK2), "Today's moves is back too");

  // the second one through the button's own handler, which redraws as well as resetting
  app.ctx.pbResetAndRender("wk2", "why");
  assert.deepStrictEqual(ov(app), {},
    "with its last field reset, the touchpoint leaves no empty husk behind");
  assert.ok(app.html("playbookList").includes(DEFAULT_WHY_WK2), "…and the principle is the code's again");

  // resetting something that was never overridden is a no-op, not an error
  assert.strictEqual(app.ctx.pbResetField("wk2", "title"), false, "nothing to reset, nothing done");
  assert.strictEqual(app.ctx.pbResetField("no-such-id", "title"), false, "and an unknown touchpoint is inert");

  // typing the default back in by hand is a reset, not a stored override that overrides nothing
  const wk5 = app.ctx.__t.JOURNEY.find((it) => it.id === "wk5");
  assert.strictEqual(app.ctx.pbSetField("wk5", "title", wk5.title), false, "the default is not an edit");
  assert.deepStrictEqual(ov(app), {}, "…so nothing is stored");
}

/* ---------- 5: a blank override is no override ----------
   Worst case for a text layer is a coach clearing a field and the card going silent. It
   cannot happen: blank never becomes the answer, whichever direction it arrives from. */
{
  const app = boot({ members: [live("a", "Sam Live", 7)] });

  // …from the screen: clearing a field restores the default rather than emptying the card
  app.ctx.pbSetField("wk2", "title", "Temporary");
  app.ctx.pbSetField("wk2", "title", "   ");
  app.ctx.renderAll();
  assert.deepStrictEqual(ov(app), {}, "a blank edit stores nothing");
  assert.ok(app.html("playbookList").includes(DEFAULT_WK2), "the deck shows the default");
  assert.ok(app.html("todayList").includes(DEFAULT_WK2), "…and so does the card");

  // …from the wire: a blank in the row is dropped on the way in
  app.ctx.__t.pbOverrides = app.ctx.migratePlaybookOverrides({
    wk2: { title: "", why: "   ", what: "\n\t " },
    wk4: { title: "Week four, renamed" },
  });
  app.ctx.renderAll();
  const pb = app.html("playbookList");
  assert.ok(pb.includes(DEFAULT_WK2) && pb.includes(DEFAULT_WHY_WK2),
    "blank fields fall back to the code's copy, not to nothing");
  assert.ok(pb.includes("give a <b>named win</b>"), "…including the body copy");
  assert.ok(pb.includes("Week four, renamed"), "…while the real override beside them still applies");

  // …and even a blank that somehow survives into memory is read as absent at the last moment
  app.ctx.__t.pbOverrides = { wk2: { title: "  " } };
  const wk2 = app.ctx.__t.JOURNEY.find((it) => it.id === "wk2");
  assert.strictEqual(app.ctx.tpTitle(wk2), DEFAULT_WK2, "the resolver refuses to hand back a blank");
  app.ctx.renderAll();
  assert.ok(app.html("todayList").includes(DEFAULT_WK2), "…so no screen can ever show an empty title");
}

/* ---------- 6: THE CONSTRAINT — words are all that can change ----------
   Timing, existence, channel, owner, conditions: none of them are reachable from the app, by
   any route. Not through the setter, not through a hand-written row, not by accident. */
{
  const app = boot({ members: [live("a", "Sam Live", 7), preStart("p", "Ned New")] });
  const shapeBefore = shapeOf(app.ctx);
  const journeyBefore = JSON.stringify(app.ctx.__t.JOURNEY);
  const dueBefore = app.ctx.dueToday(app.find("a")).map((it) => it.id);

  // every text field of every touchpoint, rewritten
  app.ctx.__t.JOURNEY.forEach((it, n) => {
    app.ctx.pbSetField(it.id, "title", "T" + n);
    app.ctx.pbSetField(it.id, "what", "W" + n);
    app.ctx.pbSetField(it.id, "why", "Y" + n);
    app.ctx.pbSetField(it.id, "seed", "S" + n);
    (it.checklist || []).forEach((_, i) => app.ctx.pbSetField(it.id, "step" + i, "C" + n + "-" + i));
  });
  app.ctx.renderAll();

  assert.strictEqual(JSON.stringify(app.ctx.__t.JOURNEY), journeyBefore,
    "the journey definition is byte-for-byte what it was — an edit writes to the layer, never to it");
  assert.strictEqual(shapeOf(app.ctx), shapeBefore, "…so its shape cannot have moved");
  assert.deepStrictEqual(app.ctx.dueToday(app.find("a")).map((it) => it.id), dueBefore,
    "the same touchpoints are due on the same day");

  // the card still says WHEN, on WHICH channel, by WHOM — the parts a coach can't type over
  const pb = app.html("playbookList");
  for (const it of app.ctx.__t.JOURNEY) {
    assert.ok(pb.includes(app.ctx.dayBadge(it)), it.id + ": its day badge is untouched");
  }
  assert.ok(pb.includes('<span class="pbx-tag physical">') && pb.includes("Handwritten") === false,
    "the postcard's channel tag survives its title being replaced");
  assert.ok(pb.includes(">Coach<") && pb.includes(">Team<"), "both owners still named");
  assert.ok(pb.includes("Named win"), "…and the named-win flag still flies");
  assert.strictEqual((pb.match(/<article class="pbx-card/g) || []).length, app.ctx.__t.JOURNEY.length,
    "the same number of cards — no touchpoint added or lost by any amount of typing");
  assert.strictEqual((pb.match(/pbx-chapter-title/g) || []).length, 2, "the same two chapters");

  // the setter refuses anything that is not one of the text fields, whatever it is called
  for (const field of ["day", "id", "ch", "owner", "phase", "win", "conditional", "checklist",
                       "walkthrough", "welcomeMsg", "grace", "__proto__"]) {
    assert.strictEqual(app.ctx.pbSetField("wk2", field, "tampered"), false,
      "pbSetField refuses `" + field + "` — it is structure, not wording");
  }
  // …and a step that does not exist cannot be brought into being by naming it
  assert.strictEqual(app.ctx.pbSetField("intro", "step5", "a sixth step"), false,
    "a five-step checklist has no sixth step to reword");
  assert.strictEqual(app.ctx.pbSetField("wk2", "step0", "wk2 has no steps"), false,
    "a touchpoint with no checklist has no steps at all");
  assert.strictEqual(app.ctx.pbSetField("wk2", "seed", "wk2 has no seed line"), false,
    "…and no seed line either, so there is nothing to reword");
  assert.strictEqual(app.ctx.pbSetField("d3_postcard", "why", "…"), true,
    "sanity: a field that DOES exist is still editable");

  // a whole row written by hand, aimed at the structure, changes nothing
  app.ctx.__t.pbOverrides = app.ctx.migratePlaybookOverrides({
    wk2: { day: 999, ch: "physical", title: "Renamed", conditional: "signedUp" },
    invented_touchpoint: { title: "A touchpoint that does not exist" },
    intro: { checklist: ["one step only"], step9: "nope" },
  });
  app.ctx.renderAll();
  assert.deepStrictEqual(ov(app), { wk2: { title: "Renamed" } },
    "only the one text field survives the trip in");
  assert.strictEqual(shapeOf(app.ctx), shapeBefore, "the journey's shape is still the journey's shape");
  const after = app.html("playbookList");
  assert.ok(!after.includes("A touchpoint that does not exist"), "an invented id renders nothing");
  assert.strictEqual((after.match(/<article class="pbx-card/g) || []).length, app.ctx.__t.JOURNEY.length,
    "…and certainly does not become a card");
  assert.ok(after.includes("Add the 6 Week Challenge to their GoTeamUp account"),
    "the intro's five steps are the code's five steps");
}

/* ---------- 7: editing does not disturb the working day ----------
   The Playbook is the one screen that writes nothing about a challenger. Edit mode must not
   change that: Done and Missed are still Done and Missed while somebody is retyping a title,
   and a challenger's own record never hears about any of it. */
{
  const app = boot({ members: [live("a", "Sam Live", 7)] });
  app.ctx.togglePlaybookEdit(true);
  assert.strictEqual(app.ctx.__t.pbEditMode, true, "edit mode is on");

  const before = JSON.stringify(app.find("a"));
  app.ctx.pbSetField("wk2", "title", "Renamed mid-morning");
  app.ctx.renderAll();
  assert.strictEqual(JSON.stringify(app.find("a")), before,
    "rewriting a touchpoint writes nothing to a challenger");

  // Done still marks done, under the new name
  app.ctx.toggleDone("a", "wk2", true);
  assert.ok((app.find("a").completed || []).includes("wk2"),
    "Done still marks the touchpoint done, by its id — the name it is wearing is irrelevant");
  assert.ok(!app.html("todayList").includes("Renamed mid-morning"),
    "…and it leaves Today's moves the way it always did");

  // Missed too
  app.ctx.markMissed("a", "d3_postcard");
  assert.ok((app.find("a").missed || []).includes("d3_postcard"), "Missed still marks missed");

  // and the roster's own storage never picks up a word of it
  assert.ok(!JSON.stringify(app.cached()).includes("Renamed mid-morning"),
    "the wording is not smuggled into the roster blob");
  assert.deepStrictEqual(ov(app), { wk2: { title: "Renamed mid-morning" } },
    "it lives in its own layer, and only there");
}

/* ---------- 8: the pen, and what it turns on ----------
   Out of edit mode the deck is a document. In edit mode the same cards come back with their
   text fields typeable — and nothing else about them touched. */
{
  const app = boot({ members: [] });
  assert.strictEqual(app.ctx.__t.pbEditMode, false, "a fresh page is read-only");
  const readOnly = app.html("playbookList");
  assert.ok(!readOnly.includes("contenteditable"), "nothing on the page is typeable");
  assert.ok(!readOnly.includes("pb-reset"), "…and there is nothing to reset");
  assert.ok(readOnly.includes("<li>Add the 6 Week Challenge to their GoTeamUp account"),
    "…not even a wrapper round a step for a mode nobody is in: read-only is the page it was");
  assert.ok(app.el("pbEditBtn").innerHTML.includes("✎")
    && app.el("pbEditBtn").innerHTML.includes("Edit wording"), "the pen invites you in");
  assert.strictEqual(app.el("pbEditBtn").getAttribute("aria-label"), "Edit the wording on this page",
    "…and says so even where the label is too narrow to show");
  assert.strictEqual(app.el("pbEditNote").classList.contains("hide"), true, "the explanation is out of the way");

  assert.strictEqual(app.ctx.togglePlaybookEdit(), true, "the pen turns edit mode on");
  const editing = app.html("playbookList");
  assert.strictEqual(app.el("pbEditBtn").getAttribute("aria-pressed"), "true", "…and says so");
  assert.ok(app.el("pbEditBtn").innerHTML.includes("Done"), "…and offers the way out");
  assert.strictEqual(app.el("pbEditNote").classList.contains("hide"), false,
    "…with a line about what is and is not editable");
  assert.ok(app.el("playbookList").classList.contains("editing"), "the deck knows it is being edited");

  // exactly the text fields are typeable, and each one names what it is editing
  const fields = [...editing.matchAll(/data-pb-id="([^"]+)" data-pb-field="([^"]+)"/g)]
    .map((m) => m[1] + "." + m[2]);
  assert.ok(fields.includes("wk2.title") && fields.includes("wk2.why") && fields.includes("wk2.what"),
    "a check-in's three text fields are all editable");
  assert.ok(fields.includes("intro.step0") && fields.includes("intro.step4"),
    "so is every step of the intro checklist");
  assert.ok(fields.includes("wk3.seed"), "…and the seed line");
  assert.strictEqual(fields.filter((f) => f === "wk2.title").length, 1, "each field is offered once");
  // nothing structural was made editable along the way
  for (const f of fields) {
    const field = f.split(".")[1];
    assert.ok(/^(title|why|what|seed|step\d+)$/.test(field), f + " is a text field, not structure");
  }
  // the day badge, the tag, the owner and the link are rendered the same either way
  for (const fixed of ['<span class="pbx-when">Day 7</span>', '<span class="pbx-tag digital">',
                       ">Coach<", 'rel="noopener"', "Named win"]) {
    assert.ok(readOnly.includes(fixed) && editing.includes(fixed),
      "unchanged by edit mode: " + fixed);
  }
  assert.strictEqual((editing.match(/<article class="pbx-card/g) || []).length,
    (readOnly.match(/<article class="pbx-card/g) || []).length, "the same cards, either way");

  // the Reset pill appears only against a field that actually has an override
  app.ctx.pbSetField("wk2", "title", "Changed");
  app.ctx.renderPlaybook();
  const withOverride = app.html("playbookList");
  assert.strictEqual((withOverride.match(/class="pb-reset"/g) || []).length, 1,
    "one override, one Reset");
  assert.ok(withOverride.includes("pbResetAndRender('wk2','title')"), "…and it is pointed at the right field");

  // walking away from the Playbook leaves it read-only for whoever opens it next
  app.ctx.setTab("onboarding", "today");
  assert.strictEqual(app.ctx.__t.pbEditMode, false, "leaving the tab leaves edit mode");
  assert.ok(!app.html("playbookList").includes("contenteditable"), "…and the deck is a document again");
  app.ctx.togglePlaybookEdit(true);
  app.ctx.goHome();
  assert.strictEqual(app.ctx.__t.pbEditMode, false, "going home does too");
}

/* ---------- 9: committing an edit, the way the page actually does it ----------
   A blur carries whatever the browser made of what somebody typed. Emphasis in the body copy
   survives; a stray <div>, a pasted <span style>, a script tag do not. */
{
  const app = boot({ members: [] });
  const blur = (id, field, opts) => app.ctx.pbFieldBlur({
    dataset: { pbId: id, pbField: field },
    textContent: opts.text || "", innerHTML: opts.html || "",
  });

  blur("wk2", "title", { text: "  Week two   check-in  " });
  assert.strictEqual(app.ctx.__t.pbOverrides.wk2.title, "Week two check-in",
    "the stored words are tidied, not taken literally");

  blur("d1_text", "what", { html: '<div>Prove we <b>noticed</b> them.<span style="color:red">!</span></div>' });
  assert.strictEqual(app.ctx.__t.pbOverrides.d1_text.what, "Prove we <b>noticed</b> them.!",
    "the emphasis survives the trip; the browser's own markup does not");

  blur("wk3", "why", { text: "<b>Plant</b> it early." });
  assert.strictEqual(app.ctx.__t.pbOverrides.wk3.why, "Plant it early.",
    "a plain-text field stores no markup at all — a title is a title");
  blur("d3_postcard", "what", { html: '<script>alert("boom")</script>Arrive unannounced.' });
  assert.strictEqual(app.ctx.__t.pbOverrides.d3_postcard.what, "Arrive unannounced.",
    "…and a script is dropped from the body copy, contents and all");
  app.ctx.renderAll();
  const deck = app.html("playbookList");
  assert.ok(!deck.includes("<script") && !deck.includes('alert("boom")'),
    "so nothing of the sort reaches the page, as markup or as text");
  assert.ok(!/<(?!\/?(?:b|i|em|strong)>)[a-zA-Z]+[^>]*>/.test(deck.replace(/<[^>]*class="[^"]*"[^>]*>/g, "")
    .replace(/<\/?(article|div|span|h3|p|ol|li|figure|blockquote|a|button)[^>]*>/g, "")),
    "the deck's markup is the app's own — an override adds none of its own");

  /* A commit updates the OTHER screens on the spot, without waiting for anything: the deck is
     the one thing left alone for a moment, because the click that ended this edit is usually
     the click starting the next one and a rebuild would swallow it. */
  {
    const on = boot({ members: [live("a", "Sam Live", 7)] });
    on.ctx.togglePlaybookEdit(true);
    on.ctx.pbFieldBlur({ dataset: { pbId: "wk2", pbField: "title" },
      textContent: "Renamed on the spot", innerHTML: "" });
    assert.ok(on.html("todayList").includes("Renamed on the spot"),
      "Today's moves has the new title before anything else is asked to redraw");
    on.ctx.setTodayView("table");
    assert.ok(on.html("todayTable").includes("Renamed on the spot"), "…and so does the table");

    // and Reset, which fires while the field is still focused, does not let that field's
    // parting blur put the discarded words straight back
    on.ctx.pbResetAndRender("wk2", "title");
    on.ctx.pbFieldBlur({ dataset: { pbId: "wk2", pbField: "title" },
      textContent: "Renamed on the spot", innerHTML: "" });
    assert.deepStrictEqual(ov(on), {}, "the reset stands");
    assert.ok(on.html("playbookList").includes(DEFAULT_WK2), "…and the code's words are on the deck");
  }

  // a blur that changed nothing writes nothing
  const snapshot = JSON.stringify(ov(app));
  blur("wk2", "title", { text: "Week two check-in" });
  blur("wk2", "nonsense", { text: "x" });
  blur("no-such-touchpoint", "title", { text: "x" });
  assert.strictEqual(JSON.stringify(ov(app)), snapshot, "no accidental writes");
}

/* ---------- 10: it syncs, through the shared layer, like everything else ----------
   The wording is a third blob in the same table beside the two rosters: pulled at boot,
   pushed on edit, and delivered to the other coach's phone over the same realtime channel. */
async function cloudTests() {
  /* --- a device that boots into a gym where somebody has already done the editing --- */
  {
    const app = boot({ cloud: { rows: {
      roster: [live("a", "Sam Live", 7)],
      playbook_overrides: { wk2: { title: "Week 2 — the wording Grace chose", why: "Say the win out loud." } },
      seeded: true,
    } } });
    await app.ctx.bootData();

    assert.deepStrictEqual(ov(app),
      { wk2: { title: "Week 2 — the wording Grace chose", why: "Say the win out loud." } },
      "the overrides came down with the rosters");
    assert.ok(app.html("playbookList").includes("Week 2 — the wording Grace chose"), "the deck opens on the team's words");
    assert.ok(app.html("todayList").includes("Week 2 — the wording Grace chose"), "…and so does the morning's card");
    assert.ok(tableHtml(app).includes("Week 2 — the wording Grace chose"), "…and the journey table");
    assert.strictEqual(app.stored("bsj_playbook_cache"),
      JSON.stringify(app.ctx.__t.pbOverrides), "…and this device has its own copy for offline");
  }

  /* --- an edit made here is pushed, under its own key, without touching the rosters --- */
  {
    const app = boot({ cloud: { rows: { roster: [live("a", "Sam Live", 7)], seeded: true } } });
    await app.ctx.bootData();
    const rosterWrites = app.cloud.writesTo("roster").length;

    app.ctx.pbSetField("wk6", "title", "The last week");
    await settle();

    const push = app.cloud.lastWriteTo("playbook_overrides");
    assert.ok(push, "the edit was pushed");
    assert.deepStrictEqual(push.value, { wk6: { title: "The last week" } }, "…as the whole overrides map");
    assert.ok(push.updated_at, "…stamped, like every other row");
    assert.strictEqual(app.cloud.writesTo("roster").length, rosterWrites,
      "and the roster was not rewritten for the sake of a word");

    // a reset is a write too — the other devices have to hear that it went back
    app.ctx.pbResetField("wk6", "title");
    await settle();
    assert.deepStrictEqual(app.cloud.lastWriteTo("playbook_overrides").value, {},
      "the reset is pushed as the absence it is");
  }

  /* --- the other coach's edit arrives, and every screen says the new thing --- */
  {
    const app = boot({ cloud: { rows: { roster: [live("a", "Sam Live", 7)], seeded: true } } });
    await app.ctx.bootData();
    assert.ok(app.cloud.subscribedTo().includes("key=eq.playbook_overrides"),
      "this device is listening for wording changes");

    app.cloud.emit("playbook_overrides", { wk2: { title: "Dan renamed this on his phone" } });
    assert.ok(app.html("playbookList").includes("Dan renamed this on his phone"), "the deck updated itself");
    assert.ok(app.html("todayList").includes("Dan renamed this on his phone"), "…and so did Today's moves");
    assert.ok(tableHtml(app).includes("Dan renamed this on his phone"), "…and the journey table");
    assert.strictEqual(app.stored("bsj_playbook_cache"),
      JSON.stringify({ wk2: { title: "Dan renamed this on his phone" } }),
      "…and it was cached for the next offline morning");

    // a reset on his phone comes back as an empty map, and the defaults return here
    app.cloud.emit("playbook_overrides", {});
    assert.deepStrictEqual(ov(app), {}, "his reset arrived");
    assert.ok(app.html("playbookList").includes(DEFAULT_WK2), "the code's words are back on this screen");

    // whatever arrives over the wire is still only ever text
    const shapeBefore = shapeOf(app.ctx);
    app.cloud.emit("playbook_overrides", { wk2: { day: 1, title: "Fine" }, ghost: { title: "Boo" } });
    assert.deepStrictEqual(ov(app), { wk2: { title: "Fine" } },
      "the structural half of a hostile payload is discarded at the door");
    assert.strictEqual(shapeOf(app.ctx), shapeBefore, "so the journey is exactly where it was");
    assert.ok(!app.html("playbookList").includes("Boo"), "and the ghost touchpoint never renders");
  }

  /* --- and when realtime is off, the poll picks the wording up too --- */
  {
    const app = boot({ cloud: { rows: { roster: [live("a", "Sam Live", 7)], seeded: true } } });
    await app.ctx.bootData();
    // another coach edits, on a device whose channel never subscribed here
    app.cloud.table.set("playbook_overrides", { wk2: { title: "Arrived by the slow road" } });
    await app.ctx.refreshFromCloud();          // what the poll and the tab-focus handler call
    assert.ok(app.html("playbookList").includes("Arrived by the slow road"),
      "the safety net under a dead realtime channel catches wording as well as people");
    assert.ok(app.html("todayList").includes("Arrived by the slow road"), "…on every screen, as ever");

    // …but it never overwrites an edit of ours that is still waiting on its debounce
    app.ctx.pbSetField("wk2", "title", "Mine, typed a second ago");
    app.cloud.table.set("playbook_overrides", { wk2: { title: "Someone else's, older" } });
    await app.ctx.refreshFromCloud();
    assert.strictEqual(ov(app).wk2.title, "Mine, typed a second ago",
      "a poll mid-edit leaves the words in front of the coach alone");
    await settle();
    assert.deepStrictEqual(app.cloud.lastWriteTo("playbook_overrides").value,
      { wk2: { title: "Mine, typed a second ago" } }, "…and pushes them when the debounce lands");
  }

  /* --- existing data is untouched: a backend with no overrides row is the normal case --- */
  {
    const app = boot({ cloud: { rows: {
      roster: [live("a", "Sam Live", 7)], retention: [], seeded: true,
    } } });
    await app.ctx.bootData();
    assert.deepStrictEqual(ov(app), {}, "no row, no overrides, no error");
    assert.ok(app.html("playbookList").includes(DEFAULT_WK2), "the Playbook reads the code, as it always did");
    assert.strictEqual(app.members().length, 1, "…and the roster arrived untouched beside it");
    assert.strictEqual(app.cloud.writesTo("playbook_overrides").length, 0,
      "a device that has edited nothing writes nothing — an untouched gym stays untouched");
  }

  /* --- and a row full of junk, however it got there, cannot break the boot --- */
  for (const junk of [null, "not an object", 42, [], { wk2: "a string, not a field map" },
                      { wk2: { title: 7, why: null, what: ["a"] } }]) {
    const app = boot({ cloud: { rows: { roster: [], playbook_overrides: junk, seeded: true } } });
    await app.ctx.bootData();
    assert.deepStrictEqual(ov(app), {},
      "junk in the row reads as no overrides: " + JSON.stringify(junk));
    assert.ok(app.html("playbookList").includes(DEFAULT_WK2), "…and the deck still renders");
  }

  /* --- an old device's cache is read the same guarded way --- */
  {
    const app = boot({ stored: { bsj_playbook_cache: '{"wk2":{"title":"From the cache"},"gone":{"title":"x"}}' } });
    await app.ctx.bootData();                     // no cloud configured: the local-only path
    assert.deepStrictEqual(ov(app), { wk2: { title: "From the cache" } },
      "the cache is filtered on the way in, exactly like the row");
    assert.ok(app.html("playbookList").includes("From the cache"), "…and offline still shows the team's words");
  }
  {
    const app = boot({ stored: { bsj_playbook_cache: "{ not json" } });
    await app.ctx.bootData();
    assert.deepStrictEqual(ov(app), {}, "a corrupt cache is no overrides, not a broken page");
    assert.ok(app.html("playbookList").includes(DEFAULT_WK2));
  }
}

/* ---------- 11: the source itself keeps the promise ---------- */
{
  // the overrides ride the same table and the same channel as the rosters — no second backend
  assert.ok(/const PB_ROW_KEY = 'playbook_overrides'/.test(HTML), "one dedicated key, named plainly");
  assert.ok(HTML.includes("filter:'key=eq.'+PB_ROW_KEY"), "…subscribed to on the existing channel");
  assert.ok(/\.in\('key', \[ROW_KEY, RET_ROW_KEY, PB_ROW_KEY, 'seeded'\]\)/.test(HTML),
    "…and pulled in the same round trip as everything else at boot");
  // JOURNEY is still a const the app only ever reads
  assert.ok(/const JOURNEY = \[/.test(HTML), "the journey is still defined in code");
  assert.ok(!/JOURNEY\[[^\]]*\]\s*(\.\w+\s*)?=[^=]/.test(HTML),
    "…nothing assigns into it by index");
  assert.ok(!/JOURNEY\.(push|splice|sort|shift|pop|unshift|reverse|fill)\(/.test(HTML),
    "…nor mutates it in place");
  // and the setter's only destination is the layer
  assert.ok(/function pbSetField[\s\S]*?\n}/.test(HTML));
  const setter = /function pbSetField[\s\S]*?\n}/.exec(HTML)[0];
  assert.ok(!setter.includes("JOURNEY.") || /JOURNEY\.find/.test(setter),
    "the setter only ever LOOKS UP a touchpoint in the journey");
  assert.ok(!/it\.\w+\s*=[^=]/.test(setter), "…and never writes a field back onto one");
}

cloudTests().then(() => console.log("playbook-wording.test.cjs: OK"));
