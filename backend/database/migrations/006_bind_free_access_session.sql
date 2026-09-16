-- Bind free-access challenges to the independently observed MyPublicWiFi session tuple.
-- Safe when migrations 001-005 have already been applied.
ALTER TABLE free_access_challenges
  ADD COLUMN IF NOT EXISTS account_id INTEGER,
  ADD COLUMN IF NOT EXISTS start_time TEXT;

CREATE INDEX IF NOT EXISTS ix_free_access_challenges_session_tuple
  ON free_access_challenges (token_hash, voucher, session_mac, account_id, start_time, expires_at, consumed_at);

COMMENT ON COLUMN free_access_challenges.account_id IS 'AccountID read from MyPublicWiFi Sessions by the bridge; never supplied by the browser.';
COMMENT ON COLUMN free_access_challenges.start_time IS 'StartTime read from MyPublicWiFi Sessions by the bridge; never supplied by the browser.';

-- Existing challenges cannot be proven against a session tuple, so expire them safely.
UPDATE free_access_challenges
SET expires_at = LEAST(expires_at, NOW())
WHERE consumed_at IS NULL
  AND (account_id IS NULL OR start_time IS NULL)
  AND expires_at > NOW();

REVOKE ALL ON free_access_challenges FROM PUBLIC;

INSERT INTO sms_message_templates (message_type, template, updated_by)
VALUES ('FREE_ACCESS', 'SUPA LAN: Your 7-minute free access is now active! Voucher: {{voucher}}. Enjoy your connection. Support: {{support}}', 'system')
ON CONFLICT (message_type) DO NOTHING;

-- TextSMS timeout ambiguity remains intentional: do not add automatic retry behavior here.
COMMENT ON TABLE free_access_challenges IS 'One-time post-authentication phone/session bindings. AccountID and StartTime are populated only from an authenticated bridge event.';
