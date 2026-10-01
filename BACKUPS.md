# Encrypted backups and availability checks

Implemented locally; workflows remain disabled until configured and released.
No production snapshot or account setting was changed during implementation.

## Backup configuration

The `encrypted Redis backup` workflow runs daily at 03:17 UTC when repository
variable `BACKUPS_ENABLED` is `true`. Configure repository secrets:

- `BACKUP_REDIS_URL`: reachable source Redis URL (use TLS where supported).
- `BACKUP_KEY_B64`: base64 encoding of 32 cryptographically random bytes.

Keep a recovery copy of the key in a separate password manager. Losing that
key makes the archive unrecoverable; changing it requires retaining old keys
until their archives expire. Never commit or print keys or Redis credentials.

The workflow uses SCAN and atomic per-key DUMP/PTTL reads. Its Redis account
needs SCAN, EVAL, DUMP and PTTL. It does not change source data. Only AES-256-GCM
encrypted `.daobak` files are uploaded as Actions artifacts, requested retention
30 days (repository limits may shorten this). Plaintext exists in process memory,
never in a temporary file. Local archive permissions are 0600; existing files
are not overwritten. Archive size is limited to 128 MiB before encryption.

This is a per-key capture, not a transactionally consistent whole-database
snapshot. A graph value is captured atomically; its journal and other keys can
reflect different moments during ongoing writes. For strict point-in-time
recovery, use provider snapshots or a maintenance window. This does not configure
Redis AOF/RDB persistence or verify the provider's backup policy.

## Recovery

With `BACKUP_KEY_B64` available securely in the environment and `REDIS_URL`
pointing to an isolated empty local Redis database:

```sh
node scripts/backup-encrypted.js restore /path/to/archive.daobak
```

Authentication of the full archive precedes Redis writes. Remote hosts and
nonempty databases are refused; RESTORE never uses REPLACE. Expired keys stay
expired, and remaining TTLs are preserved. Use a compatible Redis version
(the CI rehearsal uses Redis 8.2). If restoration fails partway through, inspect
and discard only the disposable target, then retry with a new empty database.
Do not point a local tunnel at production: host checks cannot detect tunnels.
Verify recovered graph content before any separate production recovery action.

A synthetic rehearsal (graph, list, hash, operation stream, expiring key) runs
in CI using two empty local databases:

```sh
node scripts/check-backup-recovery.js redis://127.0.0.1:6379/14 redis://127.0.0.1:6379/15
```

It refuses occupied targets and cleans only its known fixture keys. This proves
the format and restore path; periodically rehearse an actual encrypted artifact
in isolation as well. Production recovery has not been exercised in this package.

## Availability

The `availability` workflow checks every 15 minutes when `MONITOR_ENABLED=true`.
Configure `PUBLIC_HEALTH_URL` (the backend's public `/health`) and
`PUBLIC_SITE_URL` (the final website URL) as repository variables. Both must
be HTTPS without credentials, query strings or redirects. It checks API health
and Redis status plus delivery of the website HTML root. Each request times out
after 10 seconds; failures make the job fail without logging response bodies.

This does not test sign-in, rendering, AI quality, or a real user journey.
Scheduled Actions can be delayed. Enable GitHub Actions failure notifications
for the owner and confirm delivery with a deliberate manual test before calling
this monitoring operational. No email/Telegram notifications were sent or
configured by this work. Workflows must exist on the default branch for their
schedules to run.
