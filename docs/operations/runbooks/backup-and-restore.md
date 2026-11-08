# Backup and restore

Spec §11 asks for daily backups, point-in-time recovery, and a tested restore drill. Guide §22
adds encrypted copies in a second location.

## What runs

| What | How | Where |
| --- | --- | --- |
| **Daily full backup** | `npm run backup` (cron, 02:00 Dhaka) | `BACKUP_DIR`, plus `BACKUP_COPY_DIR` (a second location: another site or bucket) |
| **Continuous WAL archiving** (point-in-time recovery) | PostgreSQL `archive_mode = on`, `archive_command` to the second location; base backup weekly with `pg_basebackup` | Second location |
| **Monthly restore drill** | `npm run restore:drill` on a non-production machine with a copy of the newest backup | Report in `docs/operations/drills/` |

**What `npm run backup` does:**

- `pg_dump` as `erp_backup` (read-only; it sees all tenants);
- counts the rows in every table;
- encrypts with `BACKUP_ENCRYPTION_KEY` (AES-256-GCM) and deletes the plain dump at once;
- writes a manifest (size, SHA-256, key id, counts), copies both to `BACKUP_COPY_DIR`, and
  keeps the newest `BACKUP_KEEP` (30);
- records the run as job `backup`, so `BackupMissing` alerts after 26 hours without a success.

**The keys:** keep `BACKUP_ENCRYPTION_KEY` and `FIELD_ENCRYPTION_KEY` in the secret store
**and** in a sealed offline copy held by two named people. A backup without the key cannot be
restored.

## Monthly restore drill

```bash
npm run restore:drill                                   # newest backup in BACKUP_DIR
npm run restore:drill -- --file=/mnt/copy/erp-....dump.enc
```

The drill restores into a scratch database `erp_restore_drill` and checks that:

- the file matches its manifest and has not been altered;
- every table has the rows counted at backup time;
- every migration is recorded;
- row-level security is still forced on every tenant table;
- every tenant's audit hash chain verifies;
- the API role sees its own tenant and only that tenant.

It writes the report with timings, which are the measured restore time. **Commit the report**,
and raise anything that failed as an incident.

The first drill (2026-10-16, demo data) passed in 6.9 seconds:
[report](../drills/restore-drill-2026-10-16.md).

## Restoring after data loss

1. **Decide.** Restoring replaces everything after the restore point, for **all** tenants.
   It is an incident decision by the incident lead and the founder, never by one person. If
   only one tenant or a few records are wrong, restore into a scratch database instead and
   copy back only what is needed, under the incident log.
2. **Stop writes:** take the load balancer to maintenance mode and stop the worker.
3. **Choose the point:**
   - **Point-in-time** (for example "just before 14:05"): restore the last base backup and
     replay WAL to the target time (`recovery_target_time`).
   - **Daily dump:** `npm run restore:drill -- --file=... --keep` restores and verifies into
     `erp_restore_drill`. Then rename the databases. Keep the old one; never drop it during
     the incident.
4. **Verify the result before opening:** the drill checks above, plus:
   - `GET /health/ready`;
   - one HR sign-in per pilot tenant;
   - `GET /payroll-runs/:id/reproduce` on the latest approved run.
5. **Reopen.** Restart the API and the worker. The outbox resends events that were pending at
   the restore point, and every receiver de-duplicates on the event id.
6. **Tell the tenants** what time the data was restored to, and what they must enter again
   ([incident response](incident-response.md)).

## Alerts

| Alert | What to do |
| --- | --- |
| `BackupMissing` | Read the last error with `SELECT * FROM system_job_runs WHERE job = 'backup'` (as the worker role). Usual causes: disk full, a wrong `PG_BACKUP_PASSWORD`, or the key missing. Run `npm run backup` by hand once it is fixed. |
| `WalArchivingFailing` | Check the `archive_command` target (disk, credentials). While it fails, WAL piles up on the database disk, so watch `DiskFilling`. |
| `DiskFilling` | Free the old local backups first (`BACKUP_KEEP`). Then grow the disk. Never delete WAL files by hand. |
