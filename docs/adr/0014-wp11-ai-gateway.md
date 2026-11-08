# ADR 0014 — WP11: AI gateway, read-only assistant, payroll flag explanations

- **Status:** accepted · 2026-10-16
- **Open (owner decision, guide §27):**
  - Choose the AI provider and the data-residency stance.
  - Sign the provider contract that excludes training on customer data (spec §8 guardrail 3).
  - Run `npm run ai:eval` with the real provider and agree the pass rate (now 90%).
  - Until then the app runs with `AI_PROVIDER=fake` (a deterministic stand-in) or `off`.

## 1. One gateway, any model

Every AI call goes through `AiGatewayService.run()` (`src/modules/ai/gateway`). Business code
builds prompts and tools in neutral shapes (`provider.ts`). A provider translates them:

- `AnthropicProvider` uses the official SDK. Default model `claude-opus-5-5`, effort `low`
  (short self-service answers). The system prompt and tools are cached. Tools are strict, and
  refusals fall back server-side to another model.
- `FakeProvider` is deterministic: it picks a tool by keywords and answers from tool results
  only. It is used for tests, CI and demos, and is refused in production.
- `off` means no provider: every feature reports itself unavailable.

Switching or mixing models changes only the provider (spec §8, last paragraph).

## 2. What the gateway enforces

| Guardrail (spec §8) | How |
| --- | --- |
| 1 Same permissions as the user | The assistant's tools call the **same service methods** as the app's own screens (`/me/leave-balances`, `/me/payslips`, `/me/attendance`), in the asker's request context with their `AccessGrants`. There is no tool for anyone else's data. (Guide §16 says "the user's own token"; inside one modular monolith, the same request context is the equivalent.) |
| 2 Draft, then confirm | Phase 1 has no actions at all. The tools only read, and the prompt sends the user to the right screen. |
| 3 Data minimization | `masking.ts` replaces runs of 9 or more digits (NID, TIN, bank account, mobile / wallet numbers; ASCII or Bangla digits) with `[number hidden]`. It also drops fields named like such numbers. This applies to the question, the history and every tool result. Tool results are cut down to the fields an answer needs. |
| 5 Explain every score | Flag explanations start from the rule's own wording (`FLAG_RULES`). The rule raises the flag; AI only explains it. |
| 6 Full audit | `ai_interactions` keeps: user, feature, provider, model actually used, prompt version, masked input, output, tools, sources, tokens, latency and status. It also keeps the **human action** (helpful / not helpful). For flags, the usage report shows whether each explained flag was later cleared, fixed or is still open. |
| 7 Metered cost | `ai_usage` counts calls and tokens per tenant, month and feature. A call is reserved before the model is asked, under a per-tenant advisory lock, so the quota cannot be overrun by parallel requests. A call that got no answer is given back. Quota = plan tier (`TIER_QUOTA`: Intelligent 3,000 calls/month, illustrative) or an operator override, plus sold extra credits. Tenant admins cannot write the quota columns (column-level grants). |
| 8 Graceful failure | One time limit for the whole call (`AI_TIMEOUT_MS`, default 25 s). On timeout or provider error the user gets 503 "not answering, use the normal screens". The failure is logged and the call given back. The PWA hides AI unless `GET /ai/status` says it is available. |
| 9 Outside content is untrusted | Policy text and tool results are data. The system prompt says so, and since no tool can act, an instruction hidden in a document can at worst produce a wrong answer, never an action. |
| 10 Measured before release | See §4. |
| "Customers can switch features off" | `ai_settings`: AI on/off, plus the assistant and flag explanations separately (Admin, `PUT /ai/settings`, audited). |

Availability is checked in this order: provider configured → **Intelligent plan** (spec §1) →
switched on by the tenant → release gate → quota left. `GET /ai/status` returns the first
failing reason. The app shows the assistant only when the status says it is available.

## 3. No transaction held open while the model thinks

A model call takes seconds. The normal request pattern (one transaction per request) would hold
a database connection and the tenant's locks that whole time. The AI routes are therefore marked
`@ShortTransactions()`. They get the same tenant, user and access in the request context, but no
open transaction. Each database step runs in its own short `db.transaction()`:

- the availability check;
- reserving a call;
- each tool call;
- the final log entry.

`RequestContext.tx` became optional for this. `db.tx` still throws if it is missing (fail
closed).

## 4. Release gate

- **Test sets.** `test/ai-eval/assistant.yaml` has 28 cases: 14 English and 10 Bangla policy
  questions, 2 questions not covered by the policy (the answer must say so), and 2 own-balance
  questions whose expected number is read from the system at run time.
  `test/ai-eval/payroll-flags.yaml` has 8 flag explanations.
- **Grading** is visible string checks: `allOf`, `anyOf`, `noneOf` and the tool used, after Bangla
  digits become ASCII.
- **Running it.** `npm run ai:eval` runs the sets against the configured provider in the demo
  workspace. It records the result in `ai_release_gates` (global; written only by the owner role).
- **Effect.** In production (or with `AI_REQUIRE_RELEASE_GATE=true`), a feature is offered only
  while the latest run for the current **model and prompt version** passed. Changing a prompt
  means a new `*_PROMPT_VERSION`, which closes the gate until the sets pass again.
- **Results so far.** With the fake provider: assistant 28/28, flags 8/8. The integration test
  runs both sets on every CI run. This checks retrieval, tools, access, masking and logging, but
  **not language quality**. A real-model run is still needed, and string grading of free-text
  answers may need a human look at the failures it reports.

## 5. Policy retrieval

- **Upload.** HR uploads plain text or Markdown (`POST /ai/policy-documents`). The text is
  normalized to Unicode NFC, so Bangla words match the search words.
- **Cutting.** The text is cut at headings into pieces of at most about 1,200 characters.
- **Search.** PostgreSQL full-text search: a `simple` configuration (Bangla words as written)
  plus `english` (stemming), ranked with `ts_rank_cd`. Any search word may match.
- **Isolation.** Row-level security limits the search to the tenant.
- **Why no embeddings.** Handbooks are small and the words are specific ("নৈমিত্তিক ছুটি",
  "provident fund"). Full-text search needs no second provider and no extra data leaving the
  system. Revisit when documents grow or answers miss synonyms.

## 6. Payroll flag explanations

`POST /payroll-flags/:id/explanation` is for payroll reviewers who can see the run.

- **Facts sent.** The flag's message contains amounts, so it is sent only when the reviewer has
  the salary field group (as in `GET /payroll-runs/:id`). Otherwise only the code and the rule
  are sent.
- **Reuse.** An explanation is reused for the same flag, language, visibility and prompt version,
  at no new cost. It is still hidden when the feature is switched off.

## 7. Not included

- Actions (draft leave requests from chat): Phase 2, "draft, then confirm".
- Ask-your-data reports, CV screening, receipts and the other spec §8 features.
- PDF / Word upload of policies (text and Markdown only).
- Streaming answers.
- An admin web screen for AI settings and usage (API and Postman only, like the other admin
  routes).
- Automatic switch-off when the not-helpful rate exceeds a bar. The rate is reported per feature
  (`GET /ai/usage`); the Admin switches the feature off.
