# `.audit/` — engagement artifacts

Evidence-based audit artifacts for the payment-security engagement
(PayHero removal + Paystack hardening, Phase 10). These files are **claims
with citations**: every finding references real files and line ranges in this
tree, every gate result is a real recorded exit status, and anything that
could not be verified here (provider dashboards, live provider calls) is
stated as a residual, never as a pass.

| File | What it is |
| --- | --- |
| `findings.json` | The three engagement findings (ASA-WEBHOOK-001, ASA-DEPS-001, ASA-FILE-001) with status, resolution, and per-file evidence. Schema: `findings.schema.json`. |
| `validation-report.json` | Every verification gate with its **real** exit code and result (2026-10-12 run). Schema: `validation-report.schema.json`. |
| `coverage-ledger.json` | Change-area → regression-test mapping, including explicitly-stated coverage gaps. Schema: `coverage-ledger.schema.json`. |
| `threat-model.md` | Threat model for the payment lifecycle: zones, threats T1–T10, mitigations with code locations, test evidence, accepted risks. |

## Re-running the gates

```bash
node scripts/audit-gates.mjs            # everything (Next.js + backend)
node scripts/audit-gates.mjs --next     # Next.js gates only
node scripts/audit-gates.mjs --backend  # backend gates only
```

The runner prints one line per gate with the literal exit code and exits
non-zero only when a hard gate fails. `nextjs-npm-audit` is scored
`reviewed` — npm audit exits 1 whenever any advisory exists, and the
remaining set is the itemised, non-critical residual under
`findings.json → ASA-DEPS-001.residual`.

Validating the artifacts themselves:

```bash
for f in .audit/*.json; do python3 -m json.tool "$f" > /dev/null && echo "ok $f" || echo "INVALID $f"; done
```

## What this directory is NOT

- Not a replacement for the test suites — the suites are the executable
  evidence; the ledger just maps claims to them.
- Not a claim of live provider verification: Paystack was not called from
  this environment (no network access). Signature scheme conformance is to
  Paystack's published documentation, exercised against the injected client
  seam.
- Not a claim of dashboard verification: Cloudinary/Supabase console
  settings are out of reach here and are residuals in `findings.json`.
