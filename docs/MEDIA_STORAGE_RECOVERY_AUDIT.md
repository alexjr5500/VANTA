# Media storage recovery audit (6.8 / 6.11)

Use a **disposable, isolated staging database restored from a verified backup**, with a matching restored uploads volume mounted read-only. Quiesce writes first. Never point the command at production or the shared staging application database. The explicit opt-in and separate URL are guardrails, not proof that the database is isolated: verify the Railway project, database identity and volume manually.

After building the backend, configure these variables securely in the isolated shell:

- VANTA_STAGING_STORAGE_AUDIT=yes
- VANTA_STORAGE_AUDIT_DATABASE_URL: dedicated read-only database credential with SELECT on UploadedFile
- VANTA_STORAGE_AUDIT_ROOT: absolute, existing non-symlink restored uploads root

Run `npm --prefix backend run media:audit-storage`. No uploads, mutations, directory creation, provider requests or repairs occur. The default audit walks up to 10,000 non-deleted records in pages of 100 using ID keyset pagination. It checks local original regular-file existence, symlink safety, size and readability. Reports contain counts only, not filenames, IDs, credentials or URLs. Exit 0 means the complete nonempty audit passed local checks; exit 2 means missing, unsafe, mismatched or unreadable assets, incomplete scope, unverified remote references, empty data or a failed command. Remote assets require a separate authenticated provider verification. This is not a checksum/content-integrity or derivative audit.

Record backup timestamp, restore start/end, observed RPO/RTO, exact deployment SHA, the aggregate result and separately verified public/private provider access. Do not restore files into production, delete metadata or overwrite originals based on this report. A matching size is not proof of matching bytes; compare verified backup checksums separately. The actual recovery drill and the two historically missing production uploads remain unverified.
