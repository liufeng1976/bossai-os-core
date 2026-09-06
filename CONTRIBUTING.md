# Contributing to BossAI OS Core

Thank you for contributing to BossAI OS Core.

## Development setup

1. Install Node.js 22 or newer.
2. Install pnpm 9.15 or newer.
3. Run `pnpm install`.
4. Run `pnpm build` and `pnpm test` before submitting changes.

## Scope

Contributions should stay inside the public-core boundary: AI contracts, shared developer contracts, Skill primitives, Workflow primitives, local retrieval, file parsing, webhook security, examples, tests, and developer documentation.

Do not add commercial entitlement, billing or points authority, enterprise-only policy, customer secrets, proprietary deployment configuration, industry-specific business Agents, or production credentials.

## Pull requests

Keep changes focused, include tests for behavior changes, document externally visible contracts, and preserve fail-closed behavior for security- or validation-sensitive code.

## Contribution license

The current BossAI OS Core source line is licensed under **Apache-2.0**. Unless you explicitly state otherwise in writing when submitting a contribution, you agree that contributions intentionally submitted for inclusion in the current source line may be licensed under Apache-2.0 in accordance with Section 5 of the Apache License 2.0.

You represent that you have the right to submit the contribution and that it does not introduce code or assets under terms incompatible with this repository's license and public-source boundary.

Historical `v0.1.0` and earlier revisions remain governed by their historical AGPL grant; see `LICENSE_HISTORY.md`.
