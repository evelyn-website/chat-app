-- name: InsertPushReceipt :exec
INSERT INTO push_receipts (ticket_id, push_token) VALUES ($1, $2);

-- name: InsertPushReceipts :copyfrom
INSERT INTO push_receipts (ticket_id, push_token) VALUES ($1, $2);

-- name: GetPendingReceipts :many
SELECT ticket_id, push_token FROM push_receipts
WHERE created_at < now() - interval '15 minutes'
LIMIT 1000;

-- name: DeleteReceipts :exec
DELETE FROM push_receipts WHERE ticket_id = ANY($1::text[]);

-- name: DeletePushTokenByValue :exec
UPDATE device_keys SET expo_push_token = NULL
WHERE expo_push_token = $1;

-- name: DeleteOldReceipts :exec
DELETE FROM push_receipts WHERE created_at < now() - interval '24 hours';
