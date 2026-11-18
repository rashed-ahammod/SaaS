# ADR 0036 — WP29: recruitment, from a new post to a hired employee

- **Status:** accepted · 2026-11-17
- **Plan:** `docs/phase-3-plan.md` WP29.
- **Acceptance (docs/phase-3-plan.md):**
  > "A hired applicant becomes an employee with nothing retyped; CV screening never sees
  > name, gender, religion, age or photo, and passes its test set."

  Where each part is covered:
  - `test/integration/recruitment.int-spec.ts` (Meghna Foods, 17 November 2026) walks the whole
    pipeline: the plan is approved, Tanvir asks for a post, HR and the Admin approve it, HR
    opens it and advertises it, three applicants are taken with consent, two CVs are screened,
    one candidate is interviewed by a panel, an offer above the grade range waits for the
    Admin, and the accepted offer **creates the employee record** — the test then asserts the
    employee carries the applicant's own name, date of birth, gender and e-mail, the offer's
    placement and joining date, and that the onboarding checklist started by itself.
  - **Blind screening** is asserted twice: `src/modules/recruitment/recruitment.spec.ts` on the
    redaction itself (a realistic Bangladeshi CV with name, father's name, date of birth,
    gender, religion, marital status, photo, phone, e-mail, address and referees), and the
    integration test on the row the service stored — `cv_screenings.blind_input` is the exact
    text the model received, and the test proves none of those things is in it while "retail"
    and the work history still are.
  - **The test set** is `test/ai-eval/cv-screening.yaml` (four cases, English and Bangla), run
    by `npm run ai:eval`, which records the result in `ai_release_gates`. Each case is graded
    on the *reasons*: they must point at the post's requirements (`anyOf`) and must not mention
    a protected characteristic (`noneOf`).
  - `src/modules/identity/access/roles.spec.ts`: the five new matrix rows.
  - `test/integration/cross-tenant-sweep.int-spec.ts`: a plan, a post, an opening, an
    applicant, an application, an interview and an offer of company A are attacked with every
    route (this caught `GET /companies/:id/my-interviews` answering with an empty list for
    another tenant's company instead of refusing it).
  - **Screens:** `Frontend/web/src/app/(portal)/portal/hiring/*` — the plan, position requests,
    openings with their applications, one application (screening, interviews, offer) and "my
    interviews" with the scorecard a panel member gives.
- **Open:**
  - **No applications from outside.** Applicants are entered by HR (website, Facebook,
    referral, walk-in are recorded as the *source*). A public application form, and reading a
    PDF CV into text, are WP31-shaped work; today the CV text is pasted or typed.
  - **The offer letter wording is a placeholder**, like the experience certificate's, until HR
    and the company's lawyer sign it off.
  - **Retention periods are illustrative** (`platform/retention.ts`: 365 days for an applicant
    who was not hired) until counsel confirms them. The database refuses anything shorter than
    90 days whatever the caller passes.
  - **Accepting an offer needs `employee.manage`**, because it creates the employee record.
    In practice that is HR, who also holds `recruitment.manage`. A company that wants someone
    else to record acceptance has to grant them both.

## 1. The chain for a new post, and why it is two steps and not three

Spec §5 lists "New position (headcount): Dept Head → HR → Admin". In this app the Dept Head
**raises** the request, and the engine never lets a requester approve their own request (guide
§9, no self-approval). A literal three-step chain would therefore fall through to the Admin
for step 1 and say something untrue about who checked it.

So the built-in chain is **HR → Admin**: HR checks the plan, the grade and the terms, the
Admin decides the money, and the Dept Head's step is the act of asking, which is recorded
with their name. Chains are configurable (`approval_chains`), so a customer who wants a third
step — say a divisional head between the two — configures it without code.

## 2. The manpower plan marks, it does not refuse

`manpower_plans` holds the approved headcount per department and designation for a fiscal
year. When a request is raised, `ManpowerService.check()` compares what is planned against
who is already in post and what has already been requested, and the answer is **written onto
the request** (`within_plan`, `plan_detail`) rather than used to refuse it.

That is deliberate. A plan goes out of date between quarters, and a hiring freeze is a
business decision, not a validation rule. What the software guarantees is that nobody can
hide the overrun: the request says "outside the plan" in the approver's inbox summary, on the
request screen, and in the list.

## 3. The blind CV, in three passes

`blindCv(cvText, applicant)` (`recruitment-rules.ts`) is a pure function, so it is testable
and so the same text can be stored as evidence. It runs:

1. **labelled lines** — a line whose label is a protected characteristic or a contact detail
   becomes `Label: [removed]`. The label list is the words Bangladeshi CVs actually use,
   in English and Bangla (`Father's Name`, `পিতার নাম`, `Marital Status`, `বৈবাহিক অবস্থা`, …).
2. **the person's own identifiers** — their name whole and in parts, their phone, their
   e-mail, their date of birth. An e-mail is split only on its local part: splitting the
   domain would delete the word "com" and take "B.Com" — a qualification — with it.
   Then other people's names: the whole `REFERENCES` section, and anything following an
   honorific (`Mr`, `Mrs`, `Md`, `জনাব`).
3. **words and patterns** — gender, religion and marital-status words; ages
   ("29 years old"), dates, photo references, any e-mail, any Bangladeshi phone number
   however it is punctuated.

It errs towards removing too much: losing a requirement mentioned inside a removed line costs
a little accuracy, while a name or a religion reaching the model is a fairness failure. The
function returns what it removed, and the screening response shows that list, so HR can see
what the model was not told.

The prompt then tells the model, in words, that the marks are removals, that it must judge
only evidence of ability, that it must **not guess** the removed things back, and that it
decides nothing. The score sorts a pile; only a human moves an application.

## 4. What the database refuses, whatever the code does

- an opening without an approved position request, and a second opening for the same request
  (`UNIQUE (tenant_id, position_request_id)`);
- two applications by the same person for the same opening;
- **one employee record from more than one application** (`applications_hired_employee`), so
  "hired" can never be double-counted;
- a rejected application without a reason, a hired one without an employee;
- two live offers for one application (a partial unique index over the live states);
- a second scorecard from the same interviewer for the same interview — changing a card
  replaces it, and the replacement is what the panel sees;
- an applicant's phone or e-mail twice in one company (while not redacted).

## 5. Consent and retention (spec §11)

An applicant is only created with `consent: true`, and the row stores `consent_at`,
`consent_version` (`cv-consent-v1`) and `retention_until` = consent + 365 days. The daily
retention job then does two things in order:

1. `ApplicantsService.clearExpired()` deletes the CV **files** from the private bucket —
   SQL cannot reach a bucket, so this is TypeScript, and `FileStorage.remove()` was added for
   it (local and S3, with "already gone" treated as success so retention is safe to re-run);
2. `retention_apply(..., p_applicant_before)` blanks the person out of the database: name,
   phone, e-mail, district, date of birth, gender, CV text and file key, with `redacted_at`
   set.

The row stays, so "how many applied for this opening" keeps working — that is not personal
data. An applicant who **was hired** is never touched: their details are an employee record
now, with its own retention. The function keeps a 90-day floor regardless of what the caller
passes, exactly as the other three periods do.

## 6. Where the salary is sensitive

An offer carries a gross salary, so it is treated like an employee's salary: the API returns
`grossSalary` only to someone who may see the `salary` field group, and the offer letter PDF
is refused to anyone else. A Dept Head therefore sees the offer and its state — which they
need, it is their post — without the amount.
