# BossAI OS Core

> Open-source building blocks for governed AI applications: **AI contracts, Skills, Workflows, local RAG, file parsing, and webhook security**.

[![GitHub stars](https://img.shields.io/github/stars/liufeng1976/bossai-os-core?style=social)](https://github.com/liufeng1976/bossai-os-core/stargazers)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)

**BossAI OS Core** is the public developer-infrastructure layer extracted from BossAI OS. It provides reusable primitives for building AI applications with explicit contracts, deterministic workflow boundaries, local retrieval, file parsing, and security checks—without exposing BossAI's commercial control plane.

- Website: https://bossaios.com
- Releases: https://github.com/liufeng1976/bossai-os-core/releases
- Issues: https://github.com/liufeng1976/bossai-os-core/issues

If this project is useful to your AI agent or workflow stack, consider giving it a **Star** so other developers can find it.

## Why use it?

Use BossAI OS Core when you need infrastructure that sits **between an AI model and a real business workflow**:

- provider-neutral AI request/response contracts;
- schema-validated Skill execution;
- deterministic Workflow execution and approval boundaries;
- local document parsing with fail-closed limits;
- deterministic local hybrid retrieval with citations;
- webhook signature and token verification primitives.

It is intentionally not another chat UI or model wrapper.

## Included packages

- `@bossai/ai-contracts` — provider-neutral AI request/response and client contracts.
- `@bossai/skill-engine` — injectable, schema-validated Skill execution primitives.
- `@bossai/workflow-engine` — deterministic Workflow execution and approval boundaries.
- `@bossai/file-parser` — local document parsing with fail-closed safety limits.
- `@bossai/local-rag` — deterministic local hybrid retrieval with citations.
- `@bossai/webhook-security` — HMAC/token verification and signed-download primitives.

## 5-minute quick start

Requirements:

- Node.js 22+
- pnpm 9.15+

```bash
git clone https://github.com/liufeng1976/bossai-os-core.git
cd bossai-os-core
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

A successful run gives you a validated local baseline for exploring the public packages and integrating them into your own application.

## Architecture rule

Public Skills depend on `@bossai/ai-contracts`, not on a production model router. Applications inject an `AIGatewayClient` implementation at runtime.

```text
Your application
      ↓
BossAI Skill / Workflow primitives
      ↓
@bossai/ai-contracts
      ↓
Your injected AIGatewayClient
      ↓
OpenAI / DeepSeek / local model / other approved provider
```

This keeps the open developer contracts portable while allowing production systems to implement their own provider routing, credentials, governance, and cost controls.

## What is intentionally not here

BossAI commercial and enterprise capabilities are maintained separately. This repository does not contain:

- billing or points authority;
- commercial entitlement;
- enterprise governance authority;
- marketplace implementation;
- industry-specific Agents;
- customer production connectors;
- proprietary deployment configuration;
- the production BossAI Central AI Gateway implementation.

The public surface is intentionally frozen. See `OPEN_SOURCE_BOUNDARY.md` before proposing any new package or capability for publication.

## Project status

This repository is the independent public-core baseline extracted from the BossAI OS codebase. The current public release is available from GitHub Releases.

The project is licensed under **AGPL-3.0-or-later**. Modified versions offered to users over a network are subject to the AGPL source-availability requirements. BossAI trademarks and branding are not granted by the software license; see `TRADEMARKS.md`.

## Security

See `SECURITY.md` for vulnerability reporting guidance.

## Contributing

See `CONTRIBUTING.md` and `CODE_OF_CONDUCT.md`.

## BossAI ecosystem

BossAI OS Core is the open developer layer. BossAI's broader product system is organized around governed AI work and commerce products rather than duplicating runtime authority inside each application.

Explore the main BossAI entry point at https://bossaios.com.
