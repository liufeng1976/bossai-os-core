# BossAI OS Core — GitHub Growth Measurement

BossAI OS Core includes a small read-only GitHub Traffic report so developer discovery can be measured separately from downstream ecosystem conversion.

Run locally from an authenticated GitHub CLI session:

```bash
pnpm growth:traffic
```

Optional JSON output:

```bash
pnpm growth:traffic -- --json
```

Optional local snapshot:

```bash
pnpm growth:traffic -- --save .bossai-local/github-traffic/baseline.json
```

`.bossai-local/` is gitignored. Do not commit traffic snapshots, GitHub credentials, tokens, customer data, private logs, or local runtime state.

The report reads:

- rolling 14-day Views and Unique Visitors;
- rolling 14-day Clones and Unique Cloners;
- top referrers;
- popular repository paths;
- point-in-time Stars, Forks, and open Issues.

Views/Clones are rolling 14-day windows. Stars/Forks/Issues are cumulative point-in-time counts. Do not describe rolling-window changes as cumulative acquisition or claim that a README/release/ecosystem link caused growth without sufficient evidence.

The CI-safe command:

```bash
pnpm growth:traffic:check
```

performs only a local path/output guard self-test and does not call GitHub Traffic APIs.

This tooling does not change Apache-2.0 package boundaries, Runtime/Identity/Approval/Billing authority, model routing, commercial control planes, release artifacts, or external actions.
