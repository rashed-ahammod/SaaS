# ADR 0026 — WP23: customers and leads (Phase 3 starts)

- **Status:** accepted · 2026-10-30
- **Plan:** `docs/phase-3-plan.md` (WP23–WP31, Gate 3) is new with this ADR.
- **Acceptance (docs/phase-3-plan.md):**
  > "A lead never duplicates an existing phone or e-mail; every new lead has an owner at once;
  > a Sales user sees only their own leads and customers."

  Where each part is covered:
  - `test/integration/crm.int-spec.ts` (Meghna Foods). Rafi and Sumaiya are Sales users; Tanvir
    is the Sales head.
    - **No duplicates:**
      - A Facebook lead sent twice is one lead.
      - The same phone written another way (`01819445566` and `+880 1819-445566`) adds an
        "enquired again" note to the existing lead.
      - A walk-in with a known e-mail is refused. The refusal says whose it is, and shows the
        name only to someone who may see that record.
      - After qualification the phone belongs to the customer, and new enquiries land there.
      - A disqualified lead opens again when they enquire again.
      - The database refuses a second record for the same phone, whatever the code does.
    - **An owner at once:**
      - a lead from the Chattogram territory goes to its member;
      - other leads go round the company's Sales users in strict turn.
    - **Scope:**
      - each salesperson sees only their own leads;
      - the Sales head sees his department, but not Sumaiya, who sits in Finance;
      - Accounts sees no leads;
      - the Admin sees everything;
      - the Sales head can hand leads over only within his department.
  - `src/modules/crm/crm.spec.ts`: Bangladesh phone numbers (Bangla digits, +880, 880, 00880,
    land lines), e-mail, the 64 districts (Bangla names and old spellings), round robin.
  - `src/modules/identity/access/roles.spec.ts`: the matrix rows for CRM and the new role.
  - **Screens:** `Frontend/web/e2e/finance.spec.ts` covers the Sales user, the Sales head and
    Accounts, with the demo data.
- **Open:**
  - **Owner decisions** listed in the Phase 3 plan:
    - Facebook app and page token;
    - support tickets in v1;
    - WhatsApp.
  - **Not built:**
    - the website-form and Facebook n8n workflows come with WP31 (the capture API and its
      service key are ready);
    - customer import from the old system (migration template) is not built yet;
    - leads have no opportunity yet: that is WP24 (done: ADR 0027; qualifying can open one).

## 1. The Sales user role

- **`sales`:** a new eighth system role, granted with own scope (spec §4 "optional add-on role").
  It holds `crm.own` only. The person keeps their Employee role.
- **The Sales head** is the Department Head of the sales department: `crm.view` and
  `crm.assign` in department scope.
- **Other roles:**

  | Role | CRM permissions |
  |---|---|
  | Admin | `crm.view`, `crm.assign`, `crm.manage` (company) |
  | Accounts | `crm.credit` (reads customers; sets the credit limit and payment terms) |
  | Auditor | `crm.view` |
  | Service keys only | `crm.capture` (n8n lead capture) |

- **Scope runs on the record's owner.** The owner is a lead's owner or a customer's account
  manager. The check uses the owner's employee record (company, current department, themself),
  so the existing scope model applies unchanged (`CrmAccess`).

## 2. Leads

- **Sources:** website form, Facebook, referral, call, walk-in, entered, other.
- **States:** new → contacted (on the owner's first call, meeting, e-mail or SMS) → qualified
  (a customer) | disqualified (with a reason).
- **Numbers:** `L/2026-27/00001`.
- **Phones and e-mails:**
  - Phones are stored as `+880…`; e-mails lower-cased.
  - Districts come from the list of 64.
  - At least a phone or an e-mail is required.
- **The message** a lead wrote is outside content: stored and shown as text with a note, and
  never acted on (spec §8 guardrail 9).
- **Capture from outside:** `POST …/leads/capture`, ServiceKey with `crm.capture`.
  - The source's own id (`externalRef`) makes a repeat one lead.
  - A known phone or e-mail adds an enquiry note instead of a new lead.
- **Assignment:**
  1. the territory of the lead's district → its members in turn;
  2. else every active Sales user of the company in turn;
  3. else the company's Admin.

  The turn is kept per pool (`crm_assignment_cursors`) under an advisory lock. Leads entered by
  a salesperson are their own. The Sales head or Admin may name the owner, or hand a lead over
  later (`lead.assigned`).
- **Notifications:** `lead.created` and `lead.assigned` go to the owner (in-app and e-mail),
  except when the owner entered the lead themself.

## 3. No duplicate phone or e-mail (`crm_contact_keys`)

- Every phone and e-mail of a lead, customer or customer contact is one row. The primary key is
  company + kind + value, so a duplicate is impossible in the database.
- Advisory locks per key let two enquiries from the same number at the same moment wait for
  each other.
- **On qualification** a lead's keys move to its customer, as its own or as a contact of an
  existing customer.
- **On change** the old key is released and the new one checked.

## 4. Customers and activities

- **Customers:**
  - number `C-00001`;
  - company or person; type (dealer, distributor, retail, corporate, government, export);
  - BIN as `000123456-0101`, TIN;
  - address and district (the territory from it);
  - account manager;
  - payment terms and credit limit (Accounts only; WP26 uses them for orders);
  - contacts (one primary).
- **Activities:**
  - calls, meetings, notes, e-mails, SMS, tasks (due date, done), enquiries and system notes;
  - on a lead, or on a customer (the customer page shows the activities of the leads that
    became it);
  - "My tasks" lists one's open tasks, late ones first;
  - Accounts sees a customer without its sales conversations.

## 5. Demo data

- Rafi and Mitu are Sales users under Tanvir.
- The Chattogram territory is Rafi's.
- **Leads:** from Facebook and the website, as n8n would send them:
  - Nasrin Traders, with an enquiry again from the website, a call and tasks (one late);
  - a walk-in qualified into Karim Stores;
  - a disqualified student.
- **Customers:** Meghna Dealers, Sylhet Agro and Bogura Traders, with credit terms set by Sujit.

## Update 2026-10-31: public enquiry form

- **What:** customers can send an enquiry from a page with no sign-in, `/enquiry/<form>` in
  `Frontend/web`. The company shares the link on Facebook, on WhatsApp, or as a QR code.
- **Why this way:** chosen over an n8n Form Trigger for the release, for three reasons:
  - the page carries the company's look and the ERP's own address;
  - no n8n has to be open to the internet;
  - spam checks can be added in the app.

  n8n stays the path for Facebook lead ads and companies' own websites. Both paths call the same
  capture API, with the same duplicate and owner rules.
- **How it works:**
  - The Next.js server holds a service key per form (`ENQUIRY_FORMS`, permission `crm.capture`)
    and calls `POST /companies/:id/leads/capture` with `source: web_form`.
  - The opened form's id is the `externalRef` and the `Idempotency-Key`, so pressing Send twice
    makes one lead.
  - `?ref=` becomes the source detail, for example `Enquiry form (ref: facebook-page)`.
- **Spam:** a hidden field, at least 3 seconds on the page, and 5 sends per IP address per form
  in 10 minutes. A send that fails these checks gets the normal thanks and never reaches the ERP.
  A captcha is still open before a public pilot.
- **What the visitor sees:** the same thanks for a new lead and for a known phone or e-mail, so
  the form does not reveal who is already a customer.
