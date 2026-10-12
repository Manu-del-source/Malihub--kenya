#!/usr/bin/env node
/**
 * Audit gate runner.
 *
 * Runs the verification gates for the payment-security engagement and prints
 * one line per gate with its REAL exit status. The script's own exit code is
 * non-zero if any gate that is expected to pass fails — the npm audit gate is
 * expected to report residuals (exit 1) and is scored as "reviewed" rather
 * than pass/fail (see .audit/validation-report.json and ASA-DEPS-001).
 *
 * Usage:  node scripts/audit-gates.mjs [--next] [--backend]
 *         (default: run everything)
 *
 * No gate result is rewritten, suppressed, or averaged. Exit codes are the
 * literal process exit codes.
 */
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * `next build` runs `prisma generate` (prebuild). The Prisma engine binaries
 * are downloaded from binaries.prisma.sh, which is unreachable in air-gapped
 * sandboxes. The build itself never EXECUTES the engines (the Prisma client is
 * externalised in next.config.ts), so when the real engines are not cached,
 * stub binaries stand in — build gate only; real cached engines, when present,
 * win and no stubs are created. Runtime behaviour is unaffected.
 */
function prismaEngineEnv() {
  const clientDir = resolve(process.cwd(), "node_modules/.prisma/client");
  let hasQueryEngine = false;
  try {
    // A real engine library is a multi-megabyte native binary. Ignore our
    // own stubs (name) and zero-byte copies — `prisma generate` copies the
    // file referenced by PRISMA_QUERY_ENGINE_LIBRARY into this directory,
    // so a stub from a previous gate run would otherwise masquerade as a
    // cached real engine and the next run would fail without the env.
    hasQueryEngine = readdirSync(clientDir).some((f) => {
      if (!f.startsWith("libquery_engine-") || !f.endsWith(".so.node")) return false;
      if (f.includes("stub")) return false;
      try {
        return statSync(join(clientDir, f)).size > 0;
      } catch {
        return false;
      }
    });
  } catch {
    /* client not generated yet — stubs needed */
  }
  if (hasQueryEngine) return {};
  const dir = mkdtempSync(join(tmpdir(), "malihub-gate-engines-"));
  const queryEngine = join(dir, "libquery_engine-stub.so.node");
  const schemaEngine = join(dir, "schema-engine-stub");
  writeFileSync(queryEngine, "");
  writeFileSync(schemaEngine, "#!/bin/sh\nexit 0\n");
  chmodSync(schemaEngine, 0o755);
  return {
    PRISMA_QUERY_ENGINE_LIBRARY: queryEngine,
    PRISMA_SCHEMA_ENGINE_BINARY: schemaEngine,
  };
}

const only = process.argv.slice(2);
const runNext = only.length === 0 || only.includes("--next");
const runBackend = only.length === 0 || only.includes("--backend");

/** Gates that MUST pass for the overall run to succeed. */
const HARD = new Set([
  "nextjs-typecheck",
  "nextjs-lint",
  "nextjs-tests",
  "nextjs-build",
  "backend-pytest",
  "backend-ruff",
  "backend-pip-audit",
]);

const gates = [];
if (runNext) {
  gates.push(
    { name: "nextjs-typecheck", cwd: ".", cmd: "npx", args: ["tsc", "--noEmit"] },
    { name: "nextjs-lint", cwd: ".", cmd: "npm", args: ["run", "lint"] },
    { name: "nextjs-tests", cwd: ".", cmd: "npm", args: ["test"] },
    { name: "nextjs-build", cwd: ".", cmd: "npm", args: ["run", "build"], env: prismaEngineEnv() }
  );
}
gates.push(
  { name: "nextjs-npm-audit", cwd: ".", cmd: "npm", args: ["audit"], expected: "reviewed" },
  { name: "backend-pytest", cwd: "backend", cmd: ".venv/bin/python", args: ["-m", "pytest", "-q"] },
  { name: "backend-ruff", cwd: "backend", cmd: ".venv/bin/python", args: ["-m", "ruff", "check", "app", "tests"] },
  { name: "backend-pip-audit", cwd: "backend", cmd: ".venv/bin/pip-audit", args: ["-r", "requirements.lock.txt"] }
);

let failures = 0;
for (const gate of gates) {
  // Preflight: a missing tool (e.g. pip-audit not installed in a fresh venv)
  // is reported as skipped, not failed — a gate that cannot run must not be
  // mistaken for a gate that ran and passed. Only gateways that are explicit
  // file paths (containing a slash) are checked; bare PATH commands like
  // `npm`/`npx` are assumed present in a Node environment.
  if (gate.cmd.includes("/") && !existsSync(resolve(gate.cwd, gate.cmd))) {
    console.log(`[skip] ${gate.name} — ${gate.cwd}/${gate.cmd} not found (install it and re-run)`);
    continue;
  }
  const res = spawnSync(gate.cmd, gate.args, {
    cwd: gate.cwd,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, ...(gate.env || {}) },
  });
  const code = res.status;
  const status =
    gate.expected === "reviewed"
      ? "reviewed"
      : code === 0
        ? "pass"
        : "FAIL";
  if (status === "FAIL") failures += 1;
  const tail = (res.stdout || res.stderr || "").trim().split("\n").slice(-2).join(" | ").slice(0, 160);
  console.log(`[${status}] ${gate.name} (exit ${code})${tail ? ` — ${tail}` : ""}`);
}

console.log(
  failures === 0
    ? `\nGATES: all hard gates passed (${gates.length} gates run).`
    : `\nGATES: ${failures} hard gate(s) FAILED.`
);
process.exit(failures === 0 ? 0 : 1);
