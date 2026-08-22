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
  // the guard is that a name the app puts on a screen never becomes the browser tab's. There
  // are two of those: "The Power of Moments" on the password gate, and "The First 42 Days"
  // everywhere else the tracker names itself. The tab is neither, and has not moved.
  assert.ok(!/The Power of Moments<\/title>/.test(HTML), "…and not the gate's title");
  assert.ok(!/The First 42 Days<\/title>/.test(HTML), "…nor the tracker's own");
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
  // the search it now sits with is untouched, and the filter it used to sit with has become
  // a row of tabs of its own — above the toolbar, between the conversion bar and the search
  assert.ok(/id="search"/.test(members), "the search box stays in the toolbar");
  assert.ok(!/<select id="filter"/.test(members), "the filter dropdown is gone, not hidden");
  assert.ok(/id="memberFilters"/.test(members), "…replaced by the filter row");
  assert.ok(members.indexOf('id="convBar"') < members.indexOf('id="memberFilters"')
    && members.indexOf('id="memberFilters"') < members.indexOf('id="search"'),
    "…which sits between the conversion stats and the search box");
}

/* ---------- 10: the card, and the page it is laid across ----------
   The day's work is not columns any more — one week is open at a time and its cards run the
   full width of the screen (see 10b). What is left to keep honest is the CARD: a row whose
   parts stay in their places, whose expanded detail gets the whole card rather than the strip
   beside the buttons, and which folds sensibly on a phone. Each of these is the kind of rule
   that gets lost in a later tidy-up and produces a bug a node harness cannot see, so they are
   pinned here rather than left to a browser check. */
{
  // the phone block, taken as text so it can be asked what it actually overrides
  const phone = CSS.slice(CSS.lastIndexOf("@media (max-width:640px)"));
  // the phone rule that reserves a 130px button column on an ordinary action row must not
  // reach a board card, whose parts are laid out by the rules below
  assert.ok(!/\.board \.action \.body\{/.test(phone),
    "the phone block must not re-declare the board card's body: `.board .action .body` already "
    + "out-specifies `.action .body`, and a flex-basis here would undo display:contents");

  /* The card's top rail — where the touchpoint stands, plus the chevron — sits BESIDE the body
     on the same line. It must not take a row of its own: it did once, and on a card with
     nothing to flag that row was a lone chevron over a band of empty space, holding the
     challenger's name a full 39px off the top of the card. */
  const rail = rulesFor(".board .action .card-top")[0];
  assert.ok(rail, "sanity: the board card still has its top rail");
  assert.ok(!/flex-basis:\s*100%/.test(rail.body) && !/flex:\s*[^;]*100%/.test(rail.body),
    "on a wide screen the rail must not claim a full-width row of its own — that is the empty "
    + "band above the name this layout exists to avoid. Found: " + rail.body.trim());

  /* On a phone it DOES take a row, and that is not the bug above coming back: the rail carries
     the day label as well as the flag, so "DAY 8 · OVERDUE" beside a name on a 350px card left
     too little for either — the notes icon ended up orphaned on a line under the name. A row
     with content in it is a row worth having; the empty one never was. It still has to read as
     a corner, so it justifies to the end. */
  const phoneRail = /\.board \.action \.card-top\{([^}]*)\}/.exec(phone);
  assert.ok(phoneRail, "the phone block gives the rail a row of its own");
  assert.ok(/flex-basis:100%/.test(phoneRail[1]), "…a full-width one");
  assert.ok(/justify-content:flex-end/.test(phoneRail[1]),
    "…still justified to the end, or the status line stops being a top-RIGHT corner and "
    + "silently slides to the left. Found: " + phoneRail[1].trim());
  // …and the two buttons take the bottom of the card, half each, which is a thumb-sized target
  const phoneBtns = /\.board \.action \.mark-btns\{([^}]*)\}/.exec(phone);
  assert.ok(phoneBtns && /flex-basis:100%/.test(phoneBtns[1]),
    "on a phone the mark buttons take a row of their own. Found: "
    + (phoneBtns ? phoneBtns[1].trim() : "no rule"));

  /* The body's box is dissolved so its two halves become flex items of the card: the name block
     shares the line with the rail and the buttons, and the detail takes a full-width row below.

     This is what lets an expanded card use the whole of itself. While the detail lived INSIDE
     the body, it inherited the body's width — and the body is sized to whatever the rail and
     the buttons leave, so the checklist and the calculator were laid out in a strip with dead
     space beside them. No amount of styling inside the detail could reach past that. */
  const cardBody = rulesFor(".board .action .body")[0];
  assert.ok(cardBody, "sanity: the board card's body is still styled as its own thing");
  assert.ok(/display:contents/.test(cardBody.body),
    "the board card's body must dissolve its box, or the expanded detail is measured by the "
    + "space left beside the status rail instead of the whole card. Found: " + cardBody.body.trim());

  const detail = rulesFor(".board .action .detail")[0];
  assert.ok(detail && /flex-basis:100%/.test(detail.body),
    "…and the detail takes a full-width row of its own once it is a flex item of the card");

  /* Flex order is what puts the card's parts in their places, and the four have to stay in
     sequence: name, rail, buttons, then the detail underneath all three. They are separate
     rules, so a change to one is easy to make without noticing the others. */
  const orderOf = (sel) => {
    const r = rulesFor(sel).map((x) => /(?:^|;)\s*order:\s*(\d+)/.exec(x.body)).filter(Boolean);
    return r.length ? Number(r[0][1]) : null;
  };
  const bands = ["who", "card-top", "mark-btns", "detail"].map((c) => orderOf(".board .action ." + c));
  assert.deepStrictEqual(bands, [1, 2, 3, 4],
    "the card reads name, rail, buttons, detail — found orders " + JSON.stringify(bands));

  /* The Today's moves screen raises the page's width cap, because 1100px of reading column is
     narrow for a card that carries a name, a title, a status rail and two buttons on one line.
     Three things are asserted about how that is done, and each of them is a way it could go
     wrong later:
       - it is SCOPED to the Today view, so every other screen — the roster, the Playbook, and
         all of retention — keeps the measure it was designed at;
       - it lifts `.wrap` itself, not the board alone, so the masthead, the tabs and the
         content all share one left edge instead of the cards hanging out past them;
       - it is a fixed cap, so a 34" monitor gets margins rather than a row stretched the whole
         way across with the name at one end and the button you press at the other. */
  const wide = RULES.filter((r) => /:has\(#view-today\.active\)/.test(r.sel));
  assert.strictEqual(wide.length, 1, "exactly one rule widens the Today's moves screen");
  assert.ok(/\.wrap\s*$/.test(wide[0].sel),
    "the cap is raised on .wrap, which sets the left edge of the masthead, the tabs and the "
    + "content together — widening the cards alone leaves them hanging past all three. Found: "
    + wide[0].sel);
  const cap = /max-width:\s*(\d+)px/.exec(wide[0].body);
  assert.ok(cap, "…and it is a fixed pixel cap, not a percentage or a vw that would stretch "
    + "the cards edge to edge on a large monitor. Found: " + wide[0].body.trim());
  assert.ok(Number(cap[1]) > 1100 && Number(cap[1]) <= 1400,
    "…wider than the page's own 1100px, and no wider than a card can usefully be read across. "
    + "Found: " + cap[1] + "px");

  // the page's own measure is untouched, so nothing else on either tracker moved
  assert.ok(/max-width:1100px/.test(rulesFor(".wrap")[0].body),
    ".wrap's own cap stays at 1100px — the wider Today is one screen's exception, not a "
    + "new default for the roster, the Playbook or the retention tracker");
}

/* ---------- 10b: one week at full width, at every width ----------
   This screen was seven side-by-side lanes and the cards in them shredded — a word or two per
   line at 180px, sometimes a letter. It is a folder now: six tabs, one week open, cards laid
   across the whole screen. There is no layout engine here to measure that with, so what is
   asserted is the shape of the fix — that nothing lays the cards out in columns any more, that
   the card is a row that WRAPS rather than one that clips, and that no rule left in the sheet
   can make a word break mid-letter when there is room for it. */
{
  // the CSS split into its media blocks, by counting braces — @media nests, so a regex cannot
  const blocks = [];                     // {query, css}
  let base = CSS, at;
  while ((at = base.indexOf("@media")) !== -1) {
    const open = base.indexOf("{", at);
    let depth = 0, i = open;
    for (; i < base.length; i++) {
      if (base[i] === "{") depth++;
      else if (base[i] === "}" && --depth === 0) break;
    }
    blocks.push({ query: base.slice(at, open).trim(), css: base.slice(open + 1, i) });
    base = base.slice(0, at) + base.slice(i + 1);         // and lift it out of the base sheet
  }
  const boardIn = (css) => {
    const m = /\.board\s*\{([^{}]*)\}/.exec(css);
    return m ? m[1] : null;
  };

  // NOTHING declares columns for the day's work, at any width. That is the bug, gone.
  for (const css of [base].concat(blocks.map((b) => b.css))) {
    const body = boardIn(css);
    if (!body) continue;
    assert.ok(!/grid-template-columns/.test(body),
      "the day's work is not laid out in columns at any width — that is what crushed the "
      + "cards. Found: " + body.trim());
  }
  assert.ok(/flex-direction:\s*column/.test(boardIn(base)),
    "…it is a stack: the intro lane, then the week folder. Found: " + boardIn(base).trim());

  // the tab row wraps rather than scrolling sideways: a tab you have to swipe to find is a tab
  // nobody presses, and a row that overflows takes the page with it
  const tabs = rulesFor(".week-tabs")[0];
  assert.ok(tabs && /flex-wrap:\s*wrap/.test(tabs.body),
    ".week-tabs must wrap, so six tabs fit a phone on two lines instead of running off it. "
    + "Found: " + (tabs ? tabs.body.trim() : "no rule"));
  assert.ok(!/overflow-x\s*:\s*(auto|scroll)/.test(tabs.body),
    "…and it does not scroll sideways instead");

  // the panel and the lane both have min-width:0 — a grid or flex item's automatic minimum is
  // min-content, which is how a long challenger name pushes a container past the viewport
  for (const sel of [".board-col", ".week-panel", ".weekfolder"]) {
    const r = rulesFor(sel)[0];
    assert.ok(r && /min-width:0/.test(r.body),
      sel + " needs min-width:0 — without it a long name sets the minimum and the page goes "
      + "wider than the screen");
  }

  /* THE WRAPPING RULE, which is the bug itself.

     `overflow-wrap:anywhere` breaks a word at any character AND counts toward the element's
     min-content width, so in a narrow column it is what turns a name into one letter per line.
     `break-word` breaks only a word that could not fit on a line of its own and does NOT shrink
     min-content. The card's name block must use break-word and never anywhere. */
  const who = rulesFor(".board .action .who")[0];
  assert.ok(who, "the card's name block has a rule");
  assert.ok(/overflow-wrap:\s*break-word/.test(who.body),
    ".board .action .who must wrap with break-word. Found: " + who.body.trim());
  for (const r of RULES.filter((x) => /^\.board|^\.week/.test(x.sel))) {
    assert.ok(!/overflow-wrap:\s*anywhere/.test(r.body),
      "`overflow-wrap:anywhere` is what shredded a name into one letter per line when these "
      + "cards were in narrow columns — nothing on this screen should go back to it. Found "
      + "on: " + r.sel);
  }

  // the card is a row that wraps onto more lines when it must, not one that clips or scrolls
  const action = rulesFor(".board .action")[0];
  assert.ok(action && /flex-wrap:\s*wrap/.test(action.body),
    "the card wraps its own parts rather than squeezing them. Found: "
    + (action ? action.body.trim() : "no rule"));
  assert.ok(/flex:\s*1 1 240px/.test(who.body),
    "…and the name block gives way to the rail and the buttons at 240px rather than being "
    + "squeezed below it. Found: " + who.body.trim());
}

/* ---------- 11: the welcome message has no placeholder left to hand-edit ---------- */
{
  assert.ok(!/\[First Name\]/.test(HTML),
    "the Trainerize welcome message must not ship a [First Name] placeholder — it is built "
    + "from the challenger's own name now");
}

console.log("layout.test.cjs: OK");
