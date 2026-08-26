# BossAI OS Core

BossAI OS Core is the public developer-infrastructure layer extracted from BossAI OS. It contains reusable primitives for AI contracts, Skills, Workflows, local retrieval, file parsing, and webhook security without including BossAI commercial control, billing, enterprise governance, marketplace logic, industry Agents, or production customer connectors.

## Included packages

- `@bossai/ai-contracts` — provider-neutral AI request/response and client contracts.
- `@bossai/skill-engine` — injectable, schema-validated Skill execution primitives.
- `@bossai/workflow-engine` — deterministic Workflow execution and approval boundaries.
- `@bossai/file-parser` — local document parsing with fail-closed safety limits.
- `@bossai/local-rag` — deterministic local hybrid retrieval with citations.
- `@bossai/webhook-security` — HMAC/token verification and signed-download primitives.

## What is intentionally not here

BossAI commercial and enterprise capabilities are maintained separately. This repository does not contain billing or points authority, commercial entitlement, enterprise governance, marketplace implementation, industry-specific Agents, customer production connectors, proprietary deployment configuration, or the production BossAI Central AI Gateway implementation.

## Requirements

- Node.js 22+
- pnpm 9.15+

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

## Architecture rule

Public Skills depend on `@bossai/ai-contracts`, not on a production model router. Applications inject an `AIGatewayClient` implementation at runtime. This keeps the open developer contracts portable while allowing production systems to implement their own provider routing, credentials, governance, and cost controls.

## Project status

This extraction is an early public-core candidate derived from the BossAI OS codebase. It is licensed under AGPL-3.0-or-later. Modified versions offered to users over a network are subject to the AGPL source-availability requirements. BossAI trademarks and branding are not granted by the software license; see `TRADEMARKS.md`.

## Security

See `SECURITY.md` for vulnerability reporting guidance.

## Contributing

See `CONTRIBUTING.md` and `CODE_OF_CONDUCT.md`.
