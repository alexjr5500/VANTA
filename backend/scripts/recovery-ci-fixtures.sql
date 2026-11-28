-- Synthetic data only, for a freshly created disposable schema.
BEGIN;
INSERT INTO "User" (id, username, "updatedAt") VALUES
  ('ci-alice', 'ci_recovery_alice', NOW()), ('ci-bob', 'ci_recovery_bob', NOW());
INSERT INTO "Wallet" (id, "userId", "coinBalance", "updatedAt")
  VALUES ('ci-wallet', 'ci-alice', 100, NOW());
INSERT INTO "WalletTransaction" (id, "walletId", "userId", type, currency, amount, balance, "balanceBefore")
  VALUES ('ci-ledger', 'ci-wallet', 'ci-alice', 'DEPOSIT', 'VANTA', 100, 100, 0);
INSERT INTO "Post" (id, "authorId", content, "updatedAt")
  VALUES ('ci-post', 'ci-alice', 'Synthetic recovery post', NOW());
INSERT INTO "Conversation" (id, "updatedAt") VALUES ('ci-chat', NOW());
INSERT INTO "Participant" (id, "conversationId", "userId") VALUES
  ('ci-participant-1', 'ci-chat', 'ci-alice'), ('ci-participant-2', 'ci-chat', 'ci-bob');
INSERT INTO "Message" (id, "conversationId", "senderId", content, "updatedAt")
  VALUES ('ci-message', 'ci-chat', 'ci-alice', 'Synthetic recovery message', NOW());
INSERT INTO "Notification" (id, "userId", type, title, message, "referenceKey")
  VALUES ('ci-notification', 'ci-bob', 'TEST', 'Synthetic', 'Recovery notification', 'ci-recovery');
INSERT INTO "UploadedFile" (id, "userId", filename, "originalName", url, path, "mimeType", "fileType", size, category, "recordType", "recordId", "updatedAt")
  VALUES ('ci-upload', 'ci-alice', 'fixture.txt', 'fixture.txt', '/uploads/fixture.txt',
    'fixture.txt', 'text/plain', 'DOCUMENT', 22, 'generic', 'Post', 'ci-post', NOW());
COMMIT;
