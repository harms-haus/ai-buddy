#!/usr/bin/env node

/**
 * Post-build fix for Mastra build output.
 *
 * The Mastra bundler resolves dependency versions from the bundle analysis,
 * which can produce an incorrect zod version (e.g. 3.24.2) when a transitive
 * dependency pins an older version. However, @mastra/core@>=1.36.0 imports
 * from `zod/v4`, which only exists in zod >= 3.25.
 *
 * This script patches the generated package.json after `mastra build` to
 * ensure zod is pinned to a compatible version, then reinstalls dependencies
 * so the correct zod version is actually installed.
 *
 * Usage:  node scripts/fix-mastra-build.mjs
 *         (called automatically via npm postbuild hook)
 */

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

const OUTPUT_DIR = join(import.meta.dirname, "..", ".mastra", "output");
const OUTPUT_PKG = join(OUTPUT_DIR, "package.json");

try {
  const pkg = JSON.parse(readFileSync(OUTPUT_PKG, "utf-8"));

  if (pkg.dependencies?.zod && !pkg.dependencies.zod.includes("3.25")) {
    const old = pkg.dependencies.zod;
    pkg.dependencies.zod = "^3.25";
    writeFileSync(OUTPUT_PKG, JSON.stringify(pkg, null, 2) + "\n");
    console.log(`[fix-mastra-build] Patched zod: ${old} → ^3.25`);

    // Reinstall to get the correct zod version
    console.log("[fix-mastra-build] Reinstalling dependencies...");
    execSync("npm install", { cwd: OUTPUT_DIR, stdio: "inherit" });
    console.log("[fix-mastra-build] Dependencies reinstalled.");
  } else {
    console.log("[fix-mastra-build] zod version already correct, no patch needed");
  }
} catch (err) {
  if (err.code === "ENOENT") {
    console.error("[fix-mastra-build] No build output found at", OUTPUT_PKG);
    console.error("  Run `npm run build` first.");
    process.exit(1);
  }
  throw err;
}
