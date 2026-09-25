ALTER TABLE expiry_message_templates
  ADD COLUMN IF NOT EXISTS rule_id BIGINT REFERENCES expiry_rules(id) ON DELETE CASCADE;

ALTER TABLE expiry_events
  ADD COLUMN IF NOT EXISTS rule_id BIGINT REFERENCES expiry_rules(id) ON DELETE SET NULL;

UPDATE expiry_events e
SET rule_id = r.id
FROM expiry_rules r
WHERE e.rule_id IS NULL
  AND e.event_type = r.event_type
  AND e.reminder_offset_minutes = r.offset_minutes;

ALTER TABLE expiry_message_templates
  DROP CONSTRAINT IF EXISTS expiry_message_templates_event_type_key;

INSERT INTO expiry_message_templates (rule_id, event_type, template_text, enabled, updated_by)
SELECT r.id,
       r.event_type,
       COALESCE(legacy.template_text, CASE WHEN r.event_type = 'EXPIRY_EXPIRED'
         THEN 'SUPA LAN: Your {{package}} package has expired. Purchase another package to continue using SUPA LAN.'
         ELSE 'SUPA LAN: Your {{package}} package expires in {{remaining_time}} at {{expiry_time}}. Renew your package to continue browsing.'
       END),
       COALESCE(legacy.enabled, true),
       'migration'
FROM expiry_rules r
LEFT JOIN expiry_message_templates legacy ON legacy.event_type = r.event_type
WHERE NOT EXISTS (
  SELECT 1 FROM expiry_message_templates current WHERE current.rule_id = r.id
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_expiry_message_templates_rule_id
  ON expiry_message_templates(rule_id)
  WHERE rule_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_expiry_events_rule_id
  ON expiry_events(status, rule_id, scheduled_for);

-- Legacy event_type-only rows remain untouched for backward compatibility. New
-- scheduler and admin writes use rule_id-specific rows.
