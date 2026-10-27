// Static syntax check for erasable TypeScript (Dirty Mode safe: never executes repo code).
// `node --check file.ts` alone is unreliable for ESM TypeScript, so this strips types with Node's
// built-in stripTypeScriptTypes (which rejects non-erasable syntax) and runs `node --check` on the stripped text as a temp .mjs.
// Usage: node scripts/syntax-check.mjs <file-or-dir> [...]
import { stripTypeScriptTypes } from "node:module";
import { readFileSync, readdirSync, statSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, extname } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const SKIP = new Set(["node_modules", "dist", ".git"]);
function collect(p, out) {
  const st = statSync(p);
  if (st.isDirectory()) {
    for (const name of readdirSync(p)) if (!SKIP.has(name)) collect(join(p, name), out);
  } else if ([".ts", ".mts"].includes(extname(p)) && !p.endsWith(".d.ts")) {
    out.push(p);
  }
  return out;
}

const files = process.argv.slice(2).flatMap((p) => collect(p, []));
const dir = mkdtempSync(join(tmpdir(), "s41-syntax-"));
let failed = 0;
try {
  for (const file of files) {
    let js;
    try {
      js = stripTypeScriptTypes(readFileSync(file, "utf8"), { mode: "strip" });
    } catch (e) {
      failed++;
      console.log(`FAIL strip ${file}: ${e.message.split("\n")[0]}`);
      continue;
    }
    const tmp = join(dir, "check.mjs");
    writeFileSync(tmp, js);
    const r = spawnSync(process.execPath, ["--check", tmp], { encoding: "utf8" });
    if (r.status !== 0) {
      failed++;
      console.log(`FAIL parse ${file}: ${(r.stderr || "").trim().split("\n").slice(0, 4).join(" | ")}`);
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(`${files.length - failed}/${files.length} ok`);
process.exitCode = failed ? 1 : 0;
