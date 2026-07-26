import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const sourcePath = join(scriptDir, "apply-targeted-realtime-2026-07-17.mjs");
const tempPath = join(scriptDir, ".apply-targeted-realtime-recovered-2026-07-17.mjs");

if (!existsSync(sourcePath)) {
  throw new Error(`Missing source patch script: ${sourcePath}`);
}

let source = readFileSync(sourcePath, "utf8");

const fixes = [
  {
    label: "reception reschedule matcher",
    from: "    text = once(text, '      await load(true);', '      await refreshWorkflow(true);', 'reception reschedule refresh');",
    to: "    text = once(text, '      setRescheduleItem(null);\\n      await load(true);', '      setRescheduleItem(null);\\n      await refreshWorkflow(true);', 'reception reschedule refresh');",
  },
  {
    label: "head reschedule matcher",
    from: "    text = once(text, '      await load(true);', '      await refreshWorkflow(true);', 'head reschedule refresh');",
    to: "    text = once(text, '      setRescheduleItem(null);\\n      await load(true);', '      setRescheduleItem(null);\\n      await refreshWorkflow(true);', 'head reschedule refresh');",
  },
];

for (const fix of fixes) {
  if (source.includes(fix.to)) {
    console.log(`${fix.label}: already fixed`);
    continue;
  }

  const count = source.split(fix.from).length - 1;
  if (count !== 1) {
    throw new Error(`${fix.label}: expected one source line, found ${count}`);
  }

  source = source.replace(fix.from, fix.to);
  console.log(`${fix.label}: fixed`);
}

writeFileSync(tempPath, source, "utf8");

try {
  execFileSync(process.execPath, [tempPath], {
    cwd: process.cwd(),
    stdio: "inherit",
  });
} finally {
  rmSync(tempPath, { force: true });
}

console.log("Targeted Realtime recovery completed successfully.");
