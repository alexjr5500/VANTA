# Expired group chat media cleanup

The recurring backend sweeper runs on startup and every five minutes, at most ten attachments per pass, using PostgreSQL row locks to avoid duplicate work across replicas. The existing owner-selected group expiry remains the access cutoff. Physical deletion is eligible only seven days after message expiry and after the file itself is seven days old. Direct conversations, disabled expiry, unbound uploads, moderated or reported content, and known shared references are not purged.

- Cloudinary: authenticated delivery assets in the VANTA message folder only. Legacy public objects are preserved for migration.
- Local storage: only enable `CHAT_MEDIA_CLEANUP_LOCAL_SHARED_STORAGE=true` when all backend replicas use the same persistent upload volume. Never enable on ephemeral disk.
- Emergency stop: `CHAT_MEDIA_CLEANUP_DISABLED=true` disables the physical cleanup worker, not read-time expiry.
- Failed provider calls leave metadata eligible for retry. Confirmed deletion removes matching attachment rows and marks the upload deleted. Previously downloaded copies, backups and provider retention policies are outside the sweeper's control.
- The sweeper is not a general-purpose account deletion, retention compliance or legal-hold system. Review evidence-hold processes before enabling cleanup in production. The seven-day grace period does not replace legal holds.

Inspect the aggregated ChatMediaExpiry logs and verify a disposable expired group attachment on staging before release. Do not test on real user media. 
