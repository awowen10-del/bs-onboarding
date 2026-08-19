// Layout harness — the rules that keep the page inside the screen on a phone.
//
// The bug this exists to prevent: the page was wider than the viewport on a phone, so the
// masthead's theme chip and the right-hand tracker card were cut off at the edge. Two causes,
// both structural rather than cosmetic:
//
//   1. `.mast-inner` carries class="wrap", and .wrap is what supplies the page's 20px side
//      gutter — but it then re-declared `padding` with the SHORTHAND, which resets left and
//      right to 0. The masthead therefore ran edge to edge while everything below it was
//      inset, and on a narrow screen the chip fell off the end. (The page footer had the
//      same trap; it has since been removed altogether.)
//   2. The home screen's grid used bare `1fr` tracks. A 1fr track's automatic minimum is its
//      content's min-content width, so a card wider than its share pushes the track — and the
//      whole page — past the viewport.
//
// These are static assertions on the stylesheet because the node harness has no layout
// engine. They are the shape of the fix, not a substitute for looking at it: the real check
// is a browser at 320–414px with the root overflow guard switched OFF, which is how the
// remaining zero-overflow claim was verified.
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const HTML = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
const CSS = HTML.slice(HTML.indexOf("<style>") + 7, HTML.indexOf("</style>"));

// Every `selector { body }` in the sheet. Bodies never contain braces, so an "@media (…) {"
// opener simply fails to match and its inner rules are picked up on their own.
const RULES = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map((m) => ({ sel: m[1].trim().replace(/\/\*[\s\S]*?\*\//g, "").trim(), body: m[2] }))
  .filter((r) => r.sel && !r.sel.startsWith("@"));
const rulesFor = (sel) => RULES.filter((r) => r.sel.split(",").map((s) => s.trim()).includes(sel));

/* ---------- 1: nothing that leans on .wrap may reset its side gutter ---------- */
{
  // who actually carries class="wrap" in the page
  const carriers = new Set();
  for (const m of HTML.matchAll(/<([a-z]+)[^>]*\bclass="([^"]*)"/g)) {
    const classes = m[2].split(/\s+/).filter(Boolean);
    if (!classes.includes("wrap")) continue;
    carriers.add(m[1]);                                   // the tag itself, e.g. main
    classes.filter((c) => c !== "wrap" && c !== "hide").forEach((c) => carriers.add("." + c));
  }
  assert.ok(carriers.has("main") && carriers.has(".mast-inner"),
    "sanity: the page still has .wrap on main and the masthead row");

  // .wrap's gutter is the thing being protected
  const wrap = rulesFor(".wrap");
  assert.strictEqual(wrap.length, 1);
  assert.ok(/padding:0 20px/.test(wrap[0].body), ".wrap still supplies the side gutter");

  // …and no rule targeting one of those elements may use the padding SHORTHAND, which would
  // silently zero left and right again. Vertical longhands are what these rules want.
  for (const sel of carriers) {
    for (const rule of rulesFor(sel)) {
      assert.ok(!/(^|;)\s*padding\s*:/.test(rule.body),
        sel + " must not re-declare `padding` — it would wipe .wrap's side gutter. Use "
        + "padding-top/padding-bottom. Found: " + rule.body.trim());
    }
  }
}

/* ---------- 2: no bare 1fr grid track can push the page wide ---------- */
{
  const tracks = RULES.filter((r) => /grid-template-columns/.test(r.body));
  assert.ok(tracks.length >= 2, "sanity: the home screen still lays out on a grid");
  for (const r of tracks) {
    const value = /grid-template-columns:([^;]*)/.exec(r.body)[1];
    if (!/fr\b/.test(value)) continue;                    // fixed/auto tracks can't blow out
    // the fr units that are NOT already wrapped in a minmax(0,…) are the dangerous ones
    const unguarded = value.replace(/minmax\(\s*0[^)]*\)/g, "");
    assert.ok(!/\dfr/.test(unguarded),
      r.sel + " uses a bare fr track, whose automatic minimum is min-content and can push "
      + "the page wider than the screen. Use minmax(0,1fr). Found: " + value.trim());
  }
}

/* ---------- 3: the root backstop is in place (and is only a backstop) ---------- */
{
  const root = RULES.filter((r) => /(^|,)\s*html\s*(,|$)/.test(r.sel) || r.sel === "html")
    .map((r) => r.body).join(";");
  assert.ok(/text-size-adjust:100%/.test(root),
    "iOS Safari inflates type in blocks it thinks are too wide, which grows the layout — pin it");
  assert.ok(/max-width:100%/.test(root), "the root may never exceed the viewport");
  assert.ok(/overflow-x:clip/.test(root), "clip, so no scroll container is created");
  assert.ok(/overflow-x:hidden;overflow-x:clip/.test(root),
    "…with `hidden` declared first for anything that does not know the `clip` keyword");
}

/* ---------- 4: border-box everywhere, pseudo-elements included ---------- */
{
  assert.ok(/\*,\*::before,\*::after\{box-sizing:border-box\}/.test(CSS.replace(/\s+/g, "")
    .replace(/\*,\*::before,\*::after\{box-sizing:border-box\}/, "*,*::before,*::after{box-sizing:border-box}"))
    || /\*\s*,\s*\*::before\s*,\s*\*::after\s*\{[^}]*box-sizing:\s*border-box/.test(CSS),
    "box-sizing:border-box must cover ::before/::after too — a bare * never matched them");
  // Every bordered pseudo-element must state the size it PAINTS, because border-box means the
  // border eats into the declared width rather than adding to it. This used to be about one
  // dot on the old Playbook timeline; the redesigned deck draws its spine nodes the same way,
  // so the rule is now checked across the board rather than pinned to a single selector.
  const bordered = RULES.filter((r) => /::(before|after)/.test(r.sel) && /(^|;)\s*border:/.test(r.body));
  assert.ok(bordered.length, "sanity: something still draws a bordered pseudo-element");
  for (const r of bordered) {
    assert.ok(/width:\s*\d/.test(r.body) && /height:\s*\d/.test(r.body),
      r.sel + " has a border, so it must declare width AND height explicitly — under border-box "
      + "the border is drawn inside them. Found: " + r.body.trim());
  }
}

/* ---------- 5: flex rows that hold the masthead can actually shrink ---------- */
{
  const brandTxt = rulesFor(".brand .btxt")[0];
  assert.ok(brandTxt && /min-width:0/.test(brandTxt.body),
    "the brand's text column needs min-width:0 — a flex item's automatic minimum is "
    + "min-content, so without it the title shoves the chips off the screen");
  const right = rulesFor(".mast-right")[0];
  assert.ok(right && /flex-wrap:wrap/.test(right.body),
    "the masthead chips wrap rather than refusing to shrink");
  assert.ok(right && !/flex-shrink:0/.test(right.body),
    "…and are not pinned at their full width");
}

/* ---------- 6: the masthead's logo and text really are centred on each other ----------
   The brand's sub-line shares its class with the page's intro paragraphs, and the generic
   `.sub` rule carries margin-bottom:18px. That margin used to apply inside the masthead, so
   the text column measured 59.5px against a 40px logo with only its top 41.5px inked — which
   is what made the logo read as sitting high beside the words. Both halves are asserted: the
   flex centring, and the reset that stops the paragraph margin leaking back in. */
{
  const brand = rulesFor(".brand")[0];
  assert.ok(brand && /align-items:center/.test(brand.body),
    "the logo and the text column are centred on each other");
  const generic = rulesFor(".sub")[0];
  assert.ok(generic && /margin-bottom:\s*18px/.test(generic.body),
    "sanity: the generic .sub paragraph rule still carries the margin this guards against");
  const brandSub = rulesFor(".brand .sub")[0];
  assert.ok(brandSub, ".brand .sub must exist to override the paragraph rule");
  assert.ok(/margin:\s*0/.test(brandSub.body),
    "the masthead sub-line must reset the paragraph margin, or the text column is 18px taller "
    + "than its text and the logo sits off-centre against it");
  assert.ok(/max-width:\s*none/.test(brandSub.body),
    "…and the paragraph's 64ch cap has no business in the masthead either");
}

/* ---------- 7: the dark theme is gone, all of it ---------- */
{
  assert.ok(!/data-theme/.test(HTML),
    "no data-theme attribute, selector or switching logic may remain");
  assert.ok(!/bodysculpt:theme/.test(HTML), "no stored theme preference");
  assert.ok(!/themebtn|themeToggle|bsToggleTheme|bsSetTheme|bsSyncThemeBtn/.test(HTML),
    "no theme toggle button, styling or handler");
  assert.ok(!/color-scheme:\s*dark/.test(CSS), "nothing declares a dark colour scheme");
  // exactly one token block, and it is the light one
  const roots = RULES.filter((r) => r.sel === ":root");
  assert.strictEqual(roots.length, 1, "one :root token block, not two");
  assert.ok(/color-scheme:light/.test(roots[0].body), "…and it is the light theme");
  assert.ok(/--navy:#f2f4f8/.test(roots[0].body) && /--card:#ffffff/.test(roots[0].body),
    "the light palette's surfaces are unchanged by the removal");
  assert.ok(/--orange:#4a5f8a/.test(roots[0].body) && /--ink:#1d2330/.test(roots[0].body),
    "…as are its accent and ink");
  // Every token the sheet references still resolves. Declarations are gathered from the WHOLE
  // sheet, not just :root — the home cards set --accent/--accent-soft/--accent-rgb locally so
  // each card's accented parts follow whichever card they are on.
  const declared = new Set([...CSS.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]));
  const used = new Set([...CSS.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
  const missing = [...used].filter((t) => !declared.has(t));
  assert.deepStrictEqual(missing, [], "every var() the sheet uses is still declared: " + missing);
  // and nothing the removal orphaned is still declared but unused
  const unused = [...declared].filter((t) => !used.has(t));
  assert.deepStrictEqual(unused, [], "no dead token left behind by the theme removal: " + unused);
}

/* ---------- 8: no footer, and the tab title is the new one ---------- */
{
  assert.ok(!/<footer/i.test(HTML), "the footer element is removed, not blanked");
  assert.ok(!/saved on this device/.test(HTML), "…and its text with it");
  assert.ok(!rulesFor("footer").length, "no orphaned footer styling left behind");
  assert.ok(/<title>Bodysculpt - Client Journey<\/title>/.test(HTML),
    "the browser tab reads exactly 'Bodysculpt - Client Journey'");
  assert.ok(!/The First 42 Days<\/title>/.test(HTML), "…and not the old one");
}

/* ---------- 9: BOTH Today's moves screens open straight onto the work ----------
   The tab you just tapped says "Today's moves" and the toggle under it says so again, so the
   heading and its blurb were a third telling. Both are gone on both trackers; each section's
   first child is its toggle, and main's padding-top is what supplies the gap they used to
   occupy. Asserted as a pair — the two screens are the same screen for two different rosters,
   and one of them quietly growing a heading back is exactly the drift worth catching. */
{
  // Every view whose heading+blurb has been stripped. The tab you tapped already names the
  // screen, so the heading was a second telling and the blurb a third. Checked as a set:
  // these are the same decision applied five times, and one of them quietly growing a heading
  // back is exactly the drift worth catching.
  const stripped = [
    ["Onboarding Today", "view-today"],
    ["Retention Today", "view-ret-today"],
    ["Onboarding Birthdays", "view-birthdays"],
    ["Retention Birthdays", "view-ret-birthdays"],
    ["Challengers", "view-members"],
  ];
  for (const [label, id] of stripped) {
    const re = new RegExp('<section class="view" id="' + id + '"[\\s\\S]*?</section>');
    const view = re.exec(HTML);
    assert.ok(view, "sanity: the " + label + " view is still there");
    assert.ok(!/<h2>/.test(view[0]), label + ": no heading");
    assert.ok(!/sec-head/.test(view[0]), label + ": no empty heading container left behind");
    assert.ok(!/<p class="sub"/.test(view[0]), label + ": and no blurb either");
  }
  // the exact copy, gone from the page rather than merely hidden
  for (const gone of [
    "you bring the warmth",                  // Onboarding Today
    "a gift when they hit a year",           // Retention Today
    "a shout-out in the group",              // Onboarding Birthdays
    "reading off the member list instead",   // Retention Birthdays
    "add time to push everything still ahead", // Challengers
  ]) {
    assert.ok(!HTML.includes(gone), "removed copy is gone from the page: “" + gone + "”");
  }

  // The two Today screens keep their sub-view toggle as the first thing on the screen…
  for (const toggleId of ["todayViewToggle", "retTodayViewToggle"]) {
    assert.ok(new RegExp('<div class="viewtoggle" id="' + toggleId + '">').test(HTML),
      toggleId + ": the toggle and everything below it are untouched");
  }
  // …and Challengers keeps the one control that lived in its heading row. It creates the
  // records every other screen reads, so losing it in a tidy-up would be the expensive kind
  // of mistake — it moved into the toolbar rather than going away.
  const members = /<section class="view" id="view-members"[\s\S]*?<\/section>/.exec(HTML)[0];
  assert.ok(/openAdd\(\)/.test(members), "“+ Add challenger” is still on the Challengers screen");
  assert.ok(/<div class="toolbar"[\s\S]*openAdd\(\)[\s\S]*<\/div>/.test(members),
    "…in the toolbar, above the list, beside the search and filter");
  assert.ok(members.indexOf("openAdd()") < members.indexOf('id="memberList"'),
    "…and still ahead of the list it adds to");
  // the search and filter it now sits with are untouched
  assert.ok(/id="search"/.test(members) && /id="filter"/.test(members), "search and filter stay");
}

/* ---------- 10: the Today's moves board survives a narrow screen ----------
   The board is three side-by-side columns on a desktop, which is the one shape on this page
   that could genuinely push the layout wide: three tracks of cards, each holding names and
   titles that do not break. Two rules keep it honest, and both are the kind that get lost in a
   later tidy-up, so they are pinned here rather than left to a browser check.

     1. Every track is minmax(0,1fr). Generic rule 2 above already refuses a bare fr anywhere
        in the sheet; this asserts the board actually declares its tracks, so that guard has
        something to guard.
     2. On a phone it STACKS. Three columns squeezed into 350px would be unusable, so the
        phone block must collapse the grid to a single track — the board becomes one column
        above the next, which is what the screen is for. */
{
  const board = rulesFor(".board");
  assert.ok(board.length, "sanity: the Today's moves board still lays out on a grid");
  const desktop = board.map((r) => r.body).join(";");
  assert.ok(/display:grid/.test(desktop), "the board is a grid");
  assert.ok(/grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/.test(desktop),
    "three equal, minimum-guarded columns on a wide screen");

  // the phone block, taken as text so it can be asked what it actually overrides
  const phone = CSS.slice(CSS.lastIndexOf("@media (max-width:640px)"));
  assert.ok(/\.board\{[^}]*grid-template-columns:minmax\(0,1fr\)/.test(phone),
    "on a phone the board collapses to ONE column and the columns stack — three of them side "
    + "by side on a 350px screen is not a board, it is three slivers");
  // the stacked card's body must not inherit the row layout's reserved button column
  assert.ok(/\.board \.action \.body\{[^}]*flex-basis:100%/.test(phone),
    "a board card puts its buttons on their own line, so its body takes the full width rather "
    + "than the 130px-reserved column the phone rule gives an ordinary action row");

  // a grid item's automatic minimum is min-content, the same trap as an fr track
  const col = rulesFor(".board-col")[0];
  assert.ok(col && /min-width:0/.test(col.body),
    ".board-col needs min-width:0 — without it a long challenger name sets the column's "
    + "minimum and the board pushes past the viewport");

  /* The board's screen raises the page's width cap, because 1100px of reading column split
     three ways is not enough for a board. Three things are asserted about how that is done,
     and each of them is a way it could go wrong later:
       - it is SCOPED to the Today view, so every other screen — the roster, the Playbook, and
         all of retention — keeps the measure it was designed at;
       - it lifts `.wrap` itself, not the board alone, so the masthead, the tabs and the
         content all share one left edge instead of the board hanging out past them;
       - it is a fixed cap, so a 34" monitor gets margins rather than a board stretched the
         whole way across. */
  const wide = RULES.filter((r) => /:has\(#view-today\.active\)/.test(r.sel));
  assert.strictEqual(wide.length, 1, "exactly one rule widens the Today's moves screen");
  assert.ok(/\.wrap\s*$/.test(wide[0].sel),
    "the cap is raised on .wrap, which sets the left edge of the masthead, the tabs and the "
    + "content together — widening the board alone leaves it hanging past all three. Found: "
    + wide[0].sel);
  const cap = /max-width:\s*(\d+)px/.exec(wide[0].body);
  assert.ok(cap, "…and it is a fixed pixel cap, not a percentage or a vw that would stretch "
    + "the board edge to edge on a large monitor. Found: " + wide[0].body.trim());
  assert.ok(Number(cap[1]) > 1100 && Number(cap[1]) <= 1600,
    "…wider than the page's own 1100px, and still capped short of a big desktop. Found: "
    + cap[1] + "px");

  // the page's own measure is untouched, so nothing else on either tracker moved
  assert.ok(/max-width:1100px/.test(rulesFor(".wrap")[0].body),
    ".wrap's own cap stays at 1100px — the wider board is one screen's exception, not a "
    + "new default for the roster, the Playbook or the retention tracker");
}

/* ---------- 11: the welcome message has no placeholder left to hand-edit ---------- */
{
  assert.ok(!/\[First Name\]/.test(HTML),
    "the Trainerize welcome message must not ship a [First Name] placeholder — it is built "
    + "from the challenger's own name now");
}

console.log("layout.test.cjs: OK");
