-- Stable synthetic-row snapshot, including all columns of the selected tables.
SELECT 'User', row_to_json(t)::text FROM "User" t ORDER BY id;
SELECT 'Wallet', row_to_json(t)::text FROM "Wallet" t ORDER BY id;
SELECT 'WalletTransaction', row_to_json(t)::text FROM "WalletTransaction" t ORDER BY id;
SELECT 'Post', row_to_json(t)::text FROM "Post" t ORDER BY id;
SELECT 'Conversation', row_to_json(t)::text FROM "Conversation" t ORDER BY id;
SELECT 'Participant', row_to_json(t)::text FROM "Participant" t ORDER BY id;
SELECT 'Message', row_to_json(t)::text FROM "Message" t ORDER BY id;
SELECT 'Notification', row_to_json(t)::text FROM "Notification" t ORDER BY id;
SELECT 'UploadedFile', row_to_json(t)::text FROM "UploadedFile" t ORDER BY id;
