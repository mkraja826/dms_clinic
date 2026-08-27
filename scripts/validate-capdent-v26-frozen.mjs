import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const CAPDENT_V26_FROZEN_COMMIT =
  "1d6f606945165baa941d681dc5e4bd2372ad4a7f";

function git(args, options = {}) {
  return execFileSync("git", args, {
    encoding: "utf8",
    ...options,
  }).trim();
}

try {
  git(["cat-file", "-e", `${CAPDENT_V26_FROZEN_COMMIT}^{commit}`]);
} catch {
  console.error(
    `Frozen V26 commit ${CAPDENT_V26_FROZEN_COMMIT} is unavailable locally. Fetch full history before running V27 validation.`
  );
  process.exit(1);
}

let mergeBase = "";
try {
  mergeBase = git(["merge-base", "HEAD", CAPDENT_V26_FROZEN_COMMIT]);
} catch {
  console.error("Unable to determine the V27/V26 merge base.");
  process.exit(1);
}

if (mergeBase !== CAPDENT_V26_FROZEN_COMMIT) {
  console.error(
    `Current V27 tree is not descended from the certified V26 baseline ${CAPDENT_V26_FROZEN_COMMIT} (merge base: ${mergeBase || "none"}).`
  );
  process.exit(1);
}

const tempRoot = mkdtempSync(join(tmpdir(), "capdent-v26-baseline-"));
const worktree = join(tempRoot, "worktree");
let worktreeAdded = false;

try {
  execFileSync(
    "git",
    ["worktree", "add", "--detach", worktree, CAPDENT_V26_FROZEN_COMMIT],
    { stdio: "ignore" }
  );
  worktreeAdded = true;

  const env = { ...process.env };
  delete env.CAPDENT_V26_RC;
  delete env.CAPDENT_V27_RC;

  execFileSync(process.execPath, ["scripts/validate-capdent-v26.mjs"], {
    cwd: worktree,
    env,
    stdio: "inherit",
  });

  console.log(
    `Frozen CapDent V26 baseline validated at ${CAPDENT_V26_FROZEN_COMMIT}.`
  );
} catch (error) {
  console.error(
    `Frozen V26 baseline validation failed at ${CAPDENT_V26_FROZEN_COMMIT}.`
  );
  process.exitCode = 1;
} finally {
  if (worktreeAdded) {
    try {
      execFileSync("git", ["worktree", "remove", "--force", worktree], {
        stdio: "ignore",
      });
    } catch {
      // The temp directory cleanup below is authoritative.
    }
  }
  rmSync(tempRoot, { recursive: true, force: true });
}
