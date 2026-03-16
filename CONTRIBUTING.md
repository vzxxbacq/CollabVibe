# Contributing to CollabVibe

Thanks for contributing.

## Before you start

Please read:

- `README.md`
- `AGENTS.md`
- `docs/01-architecture/invariants.md`
- `docs/01-architecture/layers-and-boundaries.md`

This repository has stricter architecture constraints than a typical Node project.

## Development principles

- Preserve the two core data paths defined in `AGENTS.md`
- Respect layer boundaries:
  - `packages/*` must stay low-level
  - `services/*` must not import `src/*`
  - `src/core/*` must not import platform-specific modules
- Do not bypass `BackendIdentity` invariants
- Prefer minimal, local changes over large cross-cutting refactors

## Workflow

1. Open an issue for significant changes
2. Explain scope, rationale, and affected modules
3. Keep pull requests focused and reviewable
4. Update docs when behavior or architecture changes

## Local setup

```bash
npm install
cp .env.example .env
npm run start:dev
```

## Testing

Run the relevant targeted suites before opening a PR:

```bash
npm run test:app
npm run test:orchestrator
npm run test:channel-core
npm run test:channel-feishu
```

Run the full suite when your change is broad:

```bash
npm test
```

## Pull request expectations

Please include:

- what changed
- why it changed
- affected layers/modules
- risk level
- test coverage or manual validation performed

If the change affects architecture, data flow, or repo constraints, say so explicitly.

## Tests and fixtures

- Do not modify tests unless the task explicitly requires it
- Keep fixtures and snapshots tightly scoped
- Avoid adding flaky or platform-dependent tests without clear need

## Documentation

Update docs when you change:

- public behavior
- architecture or invariants
- setup/configuration
- logging / policy / operational guidance

## Code style

- Follow existing naming and module boundaries
- Prefer clear logs with stable field names
- Avoid unnecessary abstraction
- Keep comments focused on constraints and intent
