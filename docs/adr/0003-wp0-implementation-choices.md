# ADR 0003 — WP0 implementation choices

- **Status:** accepted · 2026-10-14

| Topic | Decision | Reason |
| --- | --- | --- |
| Code style | Thin controllers (`@UseGuards(AuthGuard)` per route, one call to the service). Services hold the logic and throw Nest exceptions. Bodies are DTO classes checked by `class-validator`. | Familiar NestJS shape that is easy for the team to read |
| Errors and i18n | Services throw with a message **key** (`MSG.USER_NOT_FOUND`). `HttpExceptionFilter` returns `{statusCode, code, message}` in `bn`/`en`. | Guide §19: no hardcoded text. The frontend reacts to `code`. |
| Idempotency | **Required** on every authenticated POST/PUT/PATCH/DELETE. The key row is inserted inside the request transaction, so a concurrent duplicate waits and then replays the first response. | Spec §11. Double-click safety for money actions. |
| Audit chain | Per-tenant advisory lock → gapless `seq`; `hash = sha256(prev_hash ‖ canonical_json(fields))`. UPDATE/DELETE are blocked by grants **and** a trigger. | Guide §14 |
| Outbox | A polling dispatcher in `src/worker.ts` with `FOR UPDATE SKIP LOCKED`, HMAC signature, exponential back-off, `dead` after 10 attempts. Payloads containing salary or identity keys are rejected. | It needs no Redis. BullMQ comes with payroll/import jobs (WP4+). |
| Auth | argon2id, HS256 JWT (30 min access token), TOTP via otplib with code-reuse blocking, 5 failures → 15 min lock, 10 login attempts per minute per IP. | Guide §8, spec §11 |
| Field encryption | AES-256-GCM, per-tenant key derived with HKDF from `FIELD_ENCRYPTION_KEY`. | Spec §11 "per-tenant keys" |
| Money | `Money` over decimal.js. `toDb()` refuses to save values with more than 2 decimals until `round(rule)` is called. | Guide §5 rule 1 |

**Deferred (with the work package that needs it):** *(update 2026-10-14: mandatory 2FA, step-up
codes and the dead-event replay endpoint were done in WP2, see ADR 0005; refresh tokens moved to WP9)*
- Mandatory 2FA for Admin/HR/Accounts and the step-up OTP guard: WP2 (needs roles; the first
  high-risk action is granting roles).
- Refresh tokens / server-side session revocation: WP2.
- System Admin endpoint for replaying dead outbox events (`OutboxService.replayDead` exists): WP2.
- Redis + BullMQ: first long-running job (WP4 attendance computation).
