-- Update only the system-provided FREE_ACCESS default. Preserve admin edits.
UPDATE sms_message_templates
SET template = 'SUPA LAN: Your 7-minute free access is now active! Voucher: {{voucher}}. Enjoy your connection. For unlimited premium packages, visit {{portal_url}}. Support: {{support}}',
    updated_at = NOW(),
    updated_by = 'system'
WHERE message_type = 'FREE_ACCESS'
  AND template = 'SUPA LAN: Your 7-minute free access is now active! Voucher: {{voucher}}. Enjoy your connection. Support: {{support}}';

INSERT INTO sms_message_templates (message_type, template, updated_by)
VALUES ('FREE_ACCESS', 'SUPA LAN: Your 7-minute free access is now active! Voucher: {{voucher}}. Enjoy your connection. For unlimited premium packages, visit {{portal_url}}. Support: {{support}}', 'system')
ON CONFLICT (message_type) DO NOTHING;

COMMENT ON TABLE sms_message_templates IS 'Editable SMS templates for purchase confirmation and verified FREE_ACCESS confirmation.';
COMMENT ON COLUMN sms_message_templates.template IS 'Plain-text SMS template using event-specific supported placeholders.';
