# Backup and restore

Two things hold data: the MongoDB database and the uploaded documents volume. Both must be backed up together (documents are linked from database records).

## Take a backup

```bash
scripts/backup.sh                 # writes ./backups/mongo-<UTC time>.archive.gz and uploads-<UTC time>.tar.gz
KEEP=30 scripts/backup.sh /srv/backups   # custom folder and retention (default keeps the newest 14 sets)
```

The script refuses to keep an empty file, writes under `umask 077`, and prunes old sets. Schedule it (for example a nightly cron entry) and **copy the files off the machine**, encrypted: they contain confidential business data. `backups/` is git-ignored.

```cron
15 2 * * *  cd /opt/procurax && scripts/backup.sh >> /var/log/procurax-backup.log 2>&1
```

## Restore

```bash
scripts/restore.sh backups/mongo-<time>.archive.gz backups/uploads-<time>.tar.gz
```

It asks you to type `RESTORE`, stops the API and web app, replaces the `steelprocure` database (`--drop`) and the uploads, then starts them again. Omit the second argument to restore only the database.

## Prove it works

A backup you have never restored is unproven. At least once, and after any change to the setup:

1. Start a second stack (a spare machine, or another folder with a different Compose project name and ports).
2. Restore the latest backup there.
3. Check `/health`, sign in, open a purchase order, and download an uploaded document.

## Notes

- The audit log is part of the database dump. Restoring an old backup also rolls the audit log back; keep the newer backup if you need the history.
- Backups taken while users are active are consistent per collection, not as a single point-in-time snapshot across collections. For a stricter guarantee, stop the API first or use `mongodump --oplog` against a replica set (not scripted here).
- Seeded demo data is marked `isDemoData`; it is included in backups like everything else.
