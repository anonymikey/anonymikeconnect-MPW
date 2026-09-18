-- Durable FREE_ACCESS SMS outbox fields and queue index.
ALTER TABLE sms_messages
  ADD COLUMN IF NOT EXISTS event_key TEXT,
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_error TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_sms_messages_event_key
  ON sms_messages(event_key)
  WHERE event_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sms_messages_free_access_queue
  ON sms_messages(status, message_type, next_attempt_at, created_at)
  WHERE message_type = 'FREE_ACCESS';

COMMENT ON COLUMN sms_messages.locked_at IS 'Lease timestamp for an in-flight FREE_ACCESS worker claim.';
COMMENT ON COLUMN sms_messages.last_error IS 'Most recent worker/provider error, retained for admin review.';

UPDATE sms_messages
SET next_attempt_at = COALESCE(next_attempt_at, created_at)
WHERE next_attempt_at IS NULL;

UPDATE sms_messages
SET status = 'UNKNOWN', last_error = COALESCE(last_error, error_message)
WHERE message_type = 'FREE_ACCESS' AND status = 'SENDING';
