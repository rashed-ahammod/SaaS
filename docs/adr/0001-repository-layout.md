# ADR 0001 — Repository layout: `backend/` is the API app

- **Status:** accepted · 2026-10-14
- **Context:** Guide §4 proposes `apps/api`, `apps/web`, `packages/*`. The owner had already
  scaffolded `backend/` (NestJS 12) and `Frontend/`.
- **Decision:** keep the existing folders. `backend/` plays the role of `apps/api`;
  `Frontend/` will hold the Next.js web app and PWA (WP9). Inside `backend/`:

  | Guide path | Here |
  | --- | --- |
  | `apps/api/src/modules/*` | `backend/src/modules/*` |
  | `apps/api/src/platform/*` | `backend/src/platform/*` |
  | `apps/worker` | `backend/src/worker.ts` (same codebase, separate process) |
  | `db/migrations` | `backend/db/migrations` |
  | `tests/tenancy` | `backend/test/integration/tenancy.int-spec.ts` |

  `packages/payroll-engine` is created when WP6 starts, as a pure library with no I/O.
- **Consequences:** module boundaries are unchanged (guide §3). Moving to the full
  `apps/` layout later is a folder move plus import-path updates.
