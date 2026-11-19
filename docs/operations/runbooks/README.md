# Runbooks

For the people who run the ERP in production and answer its alerts. Each alert in
`infra/monitoring/alerts.yml` names the runbook to open.

| Runbook | Use it when |
| --- | --- |
| [Deploy for free](deploy-free.md) | Setting up or re-deploying the pilot on Vercel + Render + Supabase, and what those free plans do not give you |
| [Backup and restore](backup-and-restore.md) | Daily backups, the monthly restore drill, restoring after data loss, alerts `BackupMissing`, `WalArchivingFailing`, `DiskFilling` |
| [Incident response](incident-response.md) | The API is down or failing (`ApiDown`, `HighErrorRate`, `SlowApi`), suspected tampering or data leak (`AuditChainBroken`), telling tenants |
| [Background jobs](background-jobs.md) | `BackgroundJobFailing`, `BackgroundJobStale`, outbox dead letters, e-mail / SMS not delivered, AI failing |
| [Rule values, VAT and the calendar](rule-values-and-vat.md) | Before a pilot is paid from the system: turning the placeholder labour, tax and VAT values into confirmed ones, and proving them |
| [Gate 1: parallel payroll](gate-1-parallel-payroll.md) | Onboarding a pilot company: two months of payroll run alongside its old system |
| [Gate 3: sales and appraisal](gate-3-sales-and-appraisal.md) | Accepting Phase 3 for a pilot: a quarter of its sales pipeline and one appraisal cycle run in the system |

## On call

- **Contacts:** the on-call list (name, phone, backup person, week) is kept in the operations
  shared drive. It is not in this repository because it holds personal phone numbers. Update
  it before every pilot.
- **Severity:**
  - `page` alerts phone the on-call person at any hour;
  - `ticket` alerts go to the team channel for the next working day (09:00–18:00 Dhaka).
- **During an incident:** open a note in the incident log at once and write what you see and
  do, with times (Asia/Dhaka). It becomes the post-incident review.
- **Never:**
  - copy customer data to a laptop or a chat;
  - "fix" data with SQL in production without a second person and a written reason;
  - switch off row-level security, 2FA or the audit job to get past a problem.
