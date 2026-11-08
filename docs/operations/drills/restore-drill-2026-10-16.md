# Restore drill 2026-10-16

- **Result:** PASSED
- **Backup:** `erp_dev-2026-10-16T04-44-27.dump.enc` of `erp_dev`, taken 2026-10-16T04:44:31.047Z, 0.52 MB
- **Restore time:** 6.9 s in total (decrypt 0.0 s, restore 5.9 s, checks 0.9 s)
- **Machine:** Pikachu (win32), PostgreSQL tools from C:\Program Files\PostgreSQL\18\bin

| Check | Result | Detail |
| --- | --- | --- |
| File matches its manifest (SHA-256) | ok | 6f20d8a844d2bc4a… |
| Encrypted with the current key | ok | key 7a717e3bac64 |
| Decrypts (authentication tag valid: not altered) | ok |  |
| Every table has the rows counted at backup time | ok | 79 tables, 2087 rows |
| Every migration recorded | ok | 18 migrations |
| Row-level security on and forced on every tenant table | ok | all protected |
| Every tenant's audit hash chain verifies | ok | 2 tenants, 358 entries |
| API role sees its tenant, and only its tenant | ok | 8 employees visible, 0 of other tenants |
