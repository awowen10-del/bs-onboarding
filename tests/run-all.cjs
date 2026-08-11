// Regression runner: syntax-checks the extracted inline script, then runs every
// *.test.cjs in this folder. Usage: node tests/run-all.cjs
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { extract } = require("./lib/extract.cjs");

process.env.TZ = process.env.TZ || "Europe/London";

// 1) node --check the app script, and the Netlify function beside it
const tmp = path.join(os.tmpdir(), "bsj-extracted-" + process.pid + ".js");
fs.writeFileSync(tmp, extract());
const chk = spawnSync(process.execPath, ["--check", tmp], { stdio: "inherit" });
fs.unlinkSync(tmp);
if (chk.status !== 0) {
  console.error("SYNTAX CHECK FAILED (index.html) — aborting test run");
  process.exit(1);
}
console.log("syntax check index.html: OK");

const fnDir = path.join(__dirname, "..", "netlify", "functions");
if (fs.existsSync(fnDir)) {
  for (const f of fs.readdirSync(fnDir).filter((f) => f.endsWith(".js")).sort()) {
    const fnChk = spawnSync(process.execPath, ["--check", path.join(fnDir, f)], { stdio: "inherit" });
    if (fnChk.status !== 0) {
      console.error("SYNTAX CHECK FAILED (" + f + ") — aborting test run");
      process.exit(1);
    }
    console.log("syntax check " + f + ": OK");
  }
}

// 2) run every test file
const files = fs.readdirSync(__dirname).filter((f) => f.endsWith(".test.cjs")).sort();
let failed = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(__dirname, f)], { stdio: "inherit" });
  if (r.status !== 0) { failed++; console.error(`FAILED: ${f}`); }
}
console.log(failed ? `\n${failed} of ${files.length} test file(s) FAILED` : `\nAll ${files.length} test files passed`);
process.exit(failed ? 1 : 0);
