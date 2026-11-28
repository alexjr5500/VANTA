-- Fail if relationships, balances or uniqueness are lost after restore.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "Wallet" w JOIN "WalletTransaction" l ON l."walletId"=w.id
    WHERE w.id='ci-wallet' AND w."coinBalance"=100 AND l.balance=100 AND l."balanceBefore"=0
      AND l.amount=100 AND l."userId"=w."userId"
  ) THEN RAISE EXCEPTION 'wallet fixture failed'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "Message" m JOIN "Conversation" c ON c.id=m."conversationId"
    JOIN "Participant" p ON p."conversationId"=c.id AND p."userId"=m."senderId"
    WHERE m.id='ci-message' AND m.content='Synthetic recovery message'
  ) THEN RAISE EXCEPTION 'message fixture failed'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "UploadedFile" u JOIN "Post" p ON p.id=u."recordId" AND p."authorId"=u."userId"
    WHERE u.id='ci-upload' AND u.filename='fixture.txt' AND u.size=22
  ) THEN RAISE EXCEPTION 'upload fixture failed'; END IF;
  BEGIN
    INSERT INTO "User"(id, username, "updatedAt") VALUES ('ci-duplicate', 'ci_recovery_alice', NOW());
    RAISE EXCEPTION 'unique constraint missing';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO "Post"(id, "authorId", content, "updatedAt") VALUES ('ci-orphan', 'ci-missing', 'orphan', NOW());
    RAISE EXCEPTION 'foreign key missing';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
END
$$;
