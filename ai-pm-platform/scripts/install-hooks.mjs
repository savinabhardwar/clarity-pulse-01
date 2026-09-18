import { execSync } from "node:child_process";

const repoRoot = execSync("git rev-parse --show-toplevel").toString().trim();
execSync(`git config core.hooksPath "${repoRoot}/.githooks"`, { stdio: "inherit" });
console.log("Installed pre-commit secret-scan hook (core.hooksPath -> .githooks).");
