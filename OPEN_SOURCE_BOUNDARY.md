# BossAI Open Source Boundary

This repository is the intentionally limited public core of BossAI OS.

## Permanent public boundary

The public repository may contain only reusable, non-strategic developer infrastructure such as:

- provider-neutral contracts and SDK interfaces;
- generic Skill and Workflow primitives;
- local file parsing and retrieval utilities;
- webhook security primitives;
- examples, tests, CI, and developer documentation.

## Permanently closed

The following must not be added to this repository without an explicit CEO-level governance decision:

- complete BossAI Runtime implementation;
- Provider Router or production Central AI Gateway implementation;
- credential authority or production key-management paths;
- commercial entitlement, billing, points, pricing, or settlement logic;
- enterprise governance, approval policy, audit policy, or authority implementations;
- Hermes or other Harness production integration internals;
- Agent Marketplace implementation;
- industry-specific Agents, prompts, workflows, SOPs, or delivery rules;
- customer production connectors, tenant-specific integrations, or production deployment assets;
- Decision Memory, operational data, customer data, proprietary evaluation data, or business intelligence loops.

## Change rule

The public boundary is frozen. Adding a new package or capability requires an explicit documented review proving that the addition is generic infrastructure and does not disclose strategic Runtime, authority, commercial, industry, customer, data, or operational know-how.

A permissive license does **not** make strategic code safe to publish. The current Apache-2.0 license is the legal layer for the deliberately selected public core; source selection remains the primary protection. Historical `v0.1.0` and earlier revisions remain governed by their historical AGPL grant as documented in `LICENSE_HISTORY.md`.
