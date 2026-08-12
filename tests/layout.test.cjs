// Layout harness — the rules that keep the page inside the screen on a phone.
//
// The bug this exists to prevent: the page was wider than the viewport on a phone, so the
// masthead's theme chip and the right-hand tracker card were cut off at the edge. Two causes,
// both structural rather than cosmetic:
//
//   1. `.mast-inner` and `footer` both carry class="wrap", and .wrap is what supplies the
//      page's 20px side gutter — but each then re-declared `padding` with the SHORTHAND,
//      which resets left and right to 0. The masthead therefore ran edge to edge while
//      everything below it was inset, and on a narrow screen the chip fell off the end.
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
    carriers.add(m[1]);                                   // the tag itself, e.g. main / footer
    classes.filter((c) => c !== "wrap" && c !== "hide").forEach((c) => carriers.add("." + c));
  }
  assert.ok(carriers.has("main") && carriers.has("footer") && carriers.has(".mast-inner"),
    "sanity: the page still has .wrap on main, footer and the masthead row");

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
  // the one pseudo-element with a border was re-declared so it paints the same size as before
  const pb = rulesFor(".pb::before");
  assert.strictEqual(pb.length, 1);
  assert.ok(/width:17px;height:17px/.test(pb[0].body) && /border:2px/.test(pb[0].body),
    "the Playbook timeline dot keeps its old painted size (13px content + 2px border = 17px)");
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

console.log("layout.test.cjs: OK");
