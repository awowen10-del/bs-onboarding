// The Trainerize welcome message is the last step of the intro, and it is meant to be a
// straight copy-and-paste. It wasn't: it opened "Hey [First Name]", so every send needed a
// manual edit — exactly the step that gets forgotten under a placeholder that looks fine
// until it lands in somebody's inbox addressed to nobody.
//
// The greeting is built per challenger now, the same way the Calories & Protein numbers
// already were. This file pins both halves — the on-screen preview and the copied text — and
// the fallback for a challenger with no usable name.
const assert = require("assert");
const { boot, daysFromToday } = require("./lib/env.cjs");

function challenger(over) {
  return Object.assign({
    id: "c1", name: "Sophie Webhook", booked: null, day0: null, firstSessionDone: false,
    coach: "Dan", personal: "", dob: null, extraDays: 0, pausedDays: 0, pausedAt: null,
    signedUp: false, outcome: null, completed: [], missed: [], doneMeta: {}, checks: {},
    followUpOn: null, followUpStatus: null, notes: "",
  }, over || {});
}

/* ---------- 1: the placeholder is gone, everywhere ---------- */
{
  const app = boot({ members: [challenger()] });
  const copied = app.ctx.welcomeMsgPlainText(app.find("c1"));
  const preview = app.ctx.buildWelcomeMsg(app.find("c1"));
  const onScreen = app.html("todayList");     // the intro card carries the message inline

  for (const [what, text] of [["copied text", copied], ["preview", preview], ["Today's moves", onScreen]]) {
    assert.ok(!/\[First Name\]/.test(text), "no placeholder left in the " + what);
    assert.ok(/Hey Sophie\b/.test(text), "the " + what + " greets them by first name");
  }
  assert.ok(copied.startsWith("Welcome to Week 1"), "the title still leads the copied message");
  assert.ok(/Hey Sophie\nWelcome to your 6-Week Transformation Program/.test(copied),
    "the greeting sits on its own line above the opening paragraph, as it always did");
}

/* ---------- 2: the first name is the first word, whatever the name looks like ---------- */
{
  const app = boot({ members: [] });
  const greet = (name) => app.ctx.welcomeGreeting({ name });
  assert.strictEqual(greet("Sophie Webhook"), "Hey Sophie");
  assert.strictEqual(greet("Nabeel Mohammed Raffi"), "Hey Nabeel", "three names: still the first");
  assert.strictEqual(greet("Gaynor"), "Hey Gaynor", "one name is a first name");
  assert.strictEqual(greet("WENDY BOOTH"), "Hey WENDY", "typed in caps, left in caps — not our call");
  assert.strictEqual(greet("  Dean   Major  "), "Hey Dean", "stray whitespace doesn't leak in");
  assert.strictEqual(app.ctx.firstNameOf({ name: "Rachael Crinnion" }), "Rachael");
}

/* ---------- 3: no name falls back gracefully, never "Hey " with a hole in it ---------- */
{
  const app = boot({ members: [] });
  for (const empty of [undefined, null, "", "   "]) {
    assert.strictEqual(app.ctx.welcomeGreeting({ name: empty }), "Hi there",
      "a nameless record gets a greeting that reads as written, not a gap");
  }
  assert.strictEqual(app.ctx.welcomeGreeting(null), "Hi there", "…and so does no record at all");
  assert.strictEqual(app.ctx.firstNameOf(null), "");
  // copyWelcome passes null when it cannot find the member; that must not throw
  const txt = app.ctx.welcomeMsgPlainText(null);
  assert.ok(txt.includes("Hi there"), "the whole message still builds");
  assert.ok(!/\[First Name\]/.test(txt) && !/Hey\s*\n/.test(txt), "and has no hole in it");
}

/* ---------- 4: the name is escaped on the way into the preview ---------- */
{
  const app = boot({ members: [challenger({ name: "<script>x</script> Jones" })] });
  const preview = app.ctx.buildWelcomeMsg(app.find("c1"));
  assert.ok(!/<script>/.test(preview), "the preview escapes what it prints");
  assert.ok(/&lt;script&gt;/.test(preview), "…as markup, visibly");
  // the copied PLAIN text is not HTML and keeps the raw characters, which is correct
  assert.ok(app.ctx.welcomeMsgPlainText(app.find("c1")).includes("<script>x</script>"),
    "plain text stays plain — it is going into Trainerize, not into the DOM");
}

/* ---------- 5: the calories personalisation is untouched ---------- */
{
  const withTargets = challenger({
    nutrition: { sex: "female", age: 34, height: 165, weight: 70, bodyfat: "", activity: "1.375", deficit: "500", protein: "2.0" },
  });
  const app = boot({ members: [withTargets] });
  const txt = app.ctx.welcomeMsgPlainText(app.find("c1"));
  assert.ok(/Hey Sophie/.test(txt), "greeting personalised");
  assert.ok(/• Calories: \d+ kcal per day/.test(txt), "…and the calories still are too");
  assert.ok(/• Protein: \d+g per day/.test(txt));

  // and with no targets calculated, the generic calories line still stands in
  const plain = boot({ members: [challenger()] });
  const generic = plain.ctx.welcomeMsgPlainText(plain.find("c1"));
  assert.ok(/uploaded your personal targets into your profile/.test(generic),
    "no numbers yet: the fallback line is unchanged");
  assert.ok(/Hey Sophie/.test(generic), "…but they are still greeted by name");
}

/* ---------- 6: every other section is left exactly as written ---------- */
{
  const app = boot({ members: [challenger()] });
  const txt = app.ctx.welcomeMsgPlainText(app.find("c1"));
  for (const fixed of [
    "Members Area:", "Facebook Group:", "Your Biggest Struggle:",
    "https://bodysculptwarrington1.members-only.online/login",
    "https://www.facebook.com/groups/1682899088395867",
    "Let’s make your first week count 🙌", "— The Bodysculpt Team",
  ]) {
    assert.ok(txt.includes(fixed), "fixed copy survives: " + fixed);
  }
  // the second unheaded section must NOT have picked up a greeting of its own
  assert.strictEqual((txt.match(/Hey Sophie/g) || []).length, 1, "greeted once, at the top");
  assert.strictEqual((txt.match(/Hi there/g) || []).length, 0);
}

/* ---------- 7: it reaches a real challenger through the real intro card ---------- */
{
  const app = boot({ members: [challenger({ name: "Katie Leicester" }), challenger({ id: "c2", name: "Dean Major" })] });
  const today = app.html("todayList");
  assert.ok(today.includes("Hey Katie"), "Katie's card greets Katie");
  assert.ok(today.includes("Hey Dean"), "Dean's card greets Dean");
  assert.ok(!/\[First Name\]/.test(today), "and neither shows a placeholder");
}

console.log("welcome-message.test.cjs: OK");
