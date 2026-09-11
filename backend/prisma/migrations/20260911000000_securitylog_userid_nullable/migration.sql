-- Make SecurityLog.userId optional so anonymous/system security events (no
-- authenticated actor) can be recorded with a NULL userId instead of a fabricated
-- value that would violate the User foreign key (production P2003 errors).
--
-- Background: auditLog.ts previously stored 'anonymous' for events without an
-- authenticated user. 'anonymous' is not a valid User.id, so the insert violated
-- SecurityLog_userId_fkey. Making the column nullable (while keeping the FK
-- and its enforcement intact, onDelete: Cascade) lets legitimate anonymous/system
-- events be stored with NULL userId.

-- PostgreSQL
ALTER TABLE "SecurityLog" ALTER COLUMN "userId" DROP NOT NULL;