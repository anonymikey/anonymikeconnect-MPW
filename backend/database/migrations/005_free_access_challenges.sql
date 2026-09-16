create table if not exists free_access_challenges (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  phone varchar(16) not null,
  voucher varchar(5) not null check (voucher in ('RYRNN', 'KSSSS')),
  session_mac text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  event_key text unique,
  created_at timestamptz not null default now()
);
create index if not exists ix_free_access_challenges_match
  on free_access_challenges (voucher, session_mac, expires_at, consumed_at);
update free_access_settings set enabled = false where id = true;
update free_access_claims set expires_at = least(expires_at, now()) where consumed_at is null and expires_at > now();

insert into sms_message_templates (message_type, template, updated_by)
values ('FREE_ACCESS', 'SUPA LAN: Your 7-minute free access is now active! Voucher: {{voucher}}. Enjoy your connection. Support: {{support}}', 'system')
on conflict (message_type) do nothing;

comment on table free_access_challenges is 'One-time post-authentication phone/session bindings for MyPublicWiFi free access.';
comment on column free_access_challenges.session_mac is 'MAC observed on the authenticated success page and independently verified by the bridge session event.';
comment on column free_access_challenges.token_hash is 'SHA-256 hash of the opaque browser challenge token; raw token is never stored.';

revoke all on free_access_challenges from public;
revoke all on free_access_settings from public;
revoke all on free_access_claims from public;
