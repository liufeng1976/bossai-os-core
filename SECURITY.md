# Security Policy

## Reporting a vulnerability

Please do not open a public issue for suspected security vulnerabilities. Report the issue privately to the repository maintainer with enough detail to reproduce and assess the problem, including affected package, version or commit, impact, and a minimal proof of concept when appropriate.

Do not include production credentials, customer secrets, personal data, or third-party confidential material in a report.

## Security expectations

BossAI OS Core treats parser limits, webhook verification, schema validation, and trust-boundary failures as fail-closed behavior. Changes that weaken these controls require explicit security justification and regression tests.

The public core contains no production BossAI credentials, commercial entitlement authority, customer secrets, or proprietary deployment configuration by design.
