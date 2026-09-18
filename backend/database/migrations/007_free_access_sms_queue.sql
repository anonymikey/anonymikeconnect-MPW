-- Durable FREE_ACCESS SMS outbox fields and processing index.
ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0;
ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz;
ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS locked_at timestamptz;
ALTER TABLE sms_messages ADD COLUMN IF NOT EXISTS last_error text;

CREATE INDEX IF NOT EXISTS idx_sms_messages_free_access_queue
  ON sms_messages (status, message_type, next_attempt_at, created_at);

UPDATE sms_message_templates
SET template = 'Hello there! Your 7-minute free access is now active. Voucher: {{voucher}}. Enjoy your connection! Support: {{support}}. Visit https://supalan.anonymiketech.space to purchase a package before you get disconnected.',
    updated_at = now(),
    updated_by = 'system'
WHERE message_type = 'FREE_ACCESS';

INSERT INTO sms_message_templates (message_type, template, updated_by)
SELECT 'FREE_ACCESS', 'Hello there! Your 7-minute free access is now active. Voucher: {{voucher}}. Enjoy your connection! Support: {{support}}. Visit https://supalan.anonymiketech.space to purchase a package before you get disconnected.', 'system'
WHERE NOT EXISTS (SELECT 1 FROM sms_message_templates WHERE message_type = 'FREE_ACCESS');

-- UNKNOWN is intentionally terminal: an ambiguous provider result must not auto-retry.
ALTER TABLE sms_messages DROP CONSTRAINT IF EXISTS sms_messages_status_check;
ALTER TABLE sms_messages ADD CONSTRAINT sms_messages_status_check CHECK (status IN ('QUEUED', 'SENDING', 'SENT', 'FAILED', 'UNKNOWN'));

UPDATE sms_messages SET next_attempt_at = created_at WHERE next_attempt_at IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sms_messages_attempt_count_nonnegative') THEN
    ALTER TABLE sms_messages ADD CONSTRAINT sms_messages_attempt_count_nonnegative CHECK (attempt_count >= 0);
  END IF;
END $$;

-- Migration is safe to run repeatedly: all schema operations are IF NOT EXISTS.
-- Existing purchase/manual rows are preserved and are never selected by the worker.
