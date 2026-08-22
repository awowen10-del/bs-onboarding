// The Playbook is the one screen that is pure presentation: it renders JOURNEY and writes
// nothing. That is exactly what makes it worth pinning — a redesign of this view must not
// quietly become a change to the journey, and every touchpoint has to survive the trip onto
// a card. Nothing in here asserts on colour or spacing; it asserts on what a coach can read.
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { boot } = require("./lib/env.cjs");

const HTML = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

const app = boot({ members: [] });
const J = app.ctx.__t.JOURNEY;
const html = app.html("playbookList");

/* ---------- 1: every touchpoint gets a card, and nothing invents one ---------- */
{
  const cards = html.match(/<article class="pbx-card/g) || [];
  assert.strictEqual(cards.length, J.length,
    "one card per touchpoint, no more and no fewer (" + J.length + " expected)");
  for (const it of J) {
    assert.ok(html.includes(it.title), "the deck carries “" + it.title + "”");
    assert.ok(html.includes(app.ctx.dayBadge(it)), it.title + ": its day label is on the card");
  }
}

/* ---------- 2: the practical detail all survived the redesign ---------- */
{
  // the intro's five checklist steps, as numbered manual steps
  const intro = J.find((it) => it.id === "intro");
  assert.ok(intro.checklist.length, "sanity: the intro still has a checklist");
  for (const step of intro.checklist) {
    assert.ok(html.includes(step.replace(/&/g, "&amp;")), "step kept: " + step.slice(0, 40));
  }
  assert.ok(/<div class="pbx-steps">[\s\S]*?<ol>/.test(html), "…set as an ordered list");
  assert.ok(html.includes("How it’s done"), "…under a labelled sub-section");

  // the week-3 seed line, verbatim
  const wk3 = J.find((it) => it.id === "wk3");
  assert.ok(html.includes(wk3.seed), "the seed line is reproduced in full");
  assert.ok(html.includes("End the voice note with this"), "…and labelled");
  assert.ok(/<figure class="pbx-seed">/.test(html), "…as its own block");

  // the walkthrough link
  assert.ok(html.includes(intro.walkthrough), "the walkthrough link is still reachable");
  assert.ok(/rel="noopener"/.test(html), "…and opened safely");

  // the `what` copy keeps its inline emphasis rather than being escaped into visible tags
  assert.ok(html.includes("<b>named win</b>"), "the body copy keeps its bold, not literal tags");
  assert.ok(!html.includes("&lt;b&gt;"), "…and never shows markup as text");
}

/* ---------- 3: the why leads, where there is one ---------- */
{
  const whys = html.match(/<span class="pbx-why-label">Why this matters<\/span>/g) || [];
  assert.strictEqual(whys.length, J.length, "every touchpoint carries its principle");
  assert.ok(html.includes("The hardest session is the first one."), "the day-1 principle is there");
  assert.ok(html.includes("Plant the seed."), "…and the week-3 one");

  // the why is rendered ABOVE the mechanics on the card — that is the whole point
  const card = /<article class="pbx-card[\s\S]*?<\/article>/.exec(html)[0];
  assert.ok(card.indexOf("pbx-why") < card.indexOf("pbx-what"),
    "the why sits above the how, not below it");
  assert.ok(card.indexOf("pbx-title") < card.indexOf("pbx-why"),
    "…and under the title, not instead of it");

  // a touchpoint with no entry must render without the rail rather than an empty one
  const bare = app.ctx.playbookCardHtml({ id: "not-a-real-id", ch: "digital", day: 1, phase: "journey",
    title: "Untitled", what: "Something.", owner: "coach" });
  assert.ok(!/pbx-why/.test(bare), "no principle on file: no empty rail either");
  assert.ok(bare.includes("Untitled"), "…but the card still renders");
}

/* ---------- 4: chapters group by the phase the data already declares ---------- */
{
  assert.ok(html.includes("Before day zero") && html.includes("The forty-two days"),
    "two chapters");
  assert.ok(html.indexOf("Before day zero") < html.indexOf("The forty-two days"), "chapters in order");
  // and each touchpoint sits under the right one
  const introAt = html.indexOf("Intro / Welcome experience");
  const wk2At = html.indexOf("Start of Week 2 check-in");
  assert.ok(html.indexOf("Before day zero") < introAt && introAt < html.indexOf("The forty-two days"),
    "the intro sits in chapter I");
  assert.ok(html.indexOf("The forty-two days") < wk2At, "week 2 sits in chapter II");

  // The third chapter is GONE, not merely empty. It held the month-1 and month-2 follow-ups,
  // which now live on the retention tracker — a heading with nothing under it would read as
  // work somebody had forgotten to do.
  assert.ok(!html.includes("After they join"), "no orphaned chapter heading");
  assert.ok(!/Chapter III/.test(html), "…and no orphaned numeral");
  // Stated as the property rather than the number, so it keeps holding: exactly one heading
  // per phase that actually has touchpoints, and never one for a phase that doesn't.
  const phases = [...new Set(J.map((it) => it.phase))];
  assert.strictEqual((html.match(/pbx-chapter-title/g) || []).length, phases.length,
    "one chapter heading per phase present in JOURNEY — no empty chapters, no missing ones");
}

/* ---------- 5: channel and ownership read as tags, not colour alone ---------- */
{
  for (const [ch, label] of [["inperson", "In person"], ["digital", "Digital"], ["physical", "Physical"]]) {
    assert.ok(new RegExp('<span class="pbx-tag ' + ch + '">').test(html), ch + " has a tag");
    assert.ok(html.includes(label), "…labelled in words, not by colour alone: " + label);
  }
  assert.ok(html.includes(">Coach<") && html.includes(">Team<"), "both owners are named");
  assert.ok(html.includes("Named win"), "the named-win touchpoints are flagged");
}

/* ---------- 6: THE CONSTRAINT — rendering the Playbook must not touch the journey ---------- */
{
  const before = JSON.stringify(app.ctx.__t.JOURNEY);
  app.ctx.renderPlaybook();
  app.ctx.renderPlaybook();
  assert.strictEqual(JSON.stringify(app.ctx.__t.JOURNEY), before,
    "the Playbook reads JOURNEY and never writes to it");
  // and the philosophy copy lives OUTSIDE the journey data, so Today's moves and the journey
  // table never see a field they don't render
  for (const it of J) {
    assert.ok(!("why" in it), it.id + " must not have grown a `why` field on the journey itself");
  }
  // re-rendering is idempotent — the deck is rebuilt, not appended to
  assert.strictEqual((app.html("playbookList").match(/<article class="pbx-card/g) || []).length,
    J.length, "a second render replaces the deck rather than doubling it");
}

/* ---------- 7: the deck is the last thing on the page ----------
   There used to be a dashed panel under it about ClickSend, Thanks.io and Scribeless — which
   UK service to use to get a postcard printed and posted. It has gone, and gone properly:
   the element is not in the page rather than sitting there empty, so there is no box, no
   border and no gap left behind it. Whatever the touchpoints say, the Playbook now ends on
   the last one of them. */
{
  for (const gone of ["pbx-footnote", "Printing &amp; posting", "ClickSend</b>", "Thanks.io</b>", "Scribeless</b>",
                     "print &amp; mail for you", "handwriting styles"]) {
    assert.ok(!HTML.includes(gone), "the printing note is gone from the page: " + gone);
  }
  // …and the deck is what the section now closes on
  assert.ok(/<div class="pbx-deck" id="playbookList"><\/div>\s*<\/section>/.test(HTML),
    "nothing follows the deck inside the Playbook view");
  assert.ok(/\.pbx-card:last-child\{margin-bottom:0\}/.test(HTML),
    "…so the last card stops where the page does, with no trailing gap under it");

  // the postcard touchpoint still names the services in its OWN copy — that is a coach being
  // told how to send the thing, and it lives on the card, not in a panel underneath the deck
  const postcard = app.ctx.__t.JOURNEY.find((it) => it.id === "d3_postcard");
  assert.ok(/Scribeless \/ ClickSend \/ Thanks\.io/.test(postcard.what),
    "the how-to stayed with the touchpoint it belongs to");
  assert.ok(app.html("playbookList").includes("Scribeless / ClickSend / Thanks.io"),
    "…and still reaches the deck through the card");
}

console.log("playbook.test.cjs: OK");
