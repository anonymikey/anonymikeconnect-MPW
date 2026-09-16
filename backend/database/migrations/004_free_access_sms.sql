-- Isolated MyPublicWiFi free-access SMS automation.
create table if not exists free_access_settings (
  id boolean primary key default true check (id = true),
  enabled boolean not null default false,
  active_voucher varchar(5) not null check (active_voucher in ('RYRNN', 'KSSSS')),
  updated_at timestamptz not null default now(),
  updated_by text not null default 'system'
);
insert into free_access_settings (id, enabled, active_voucher)
values (true, false, 'KSSSS') on conflict (id) do nothing;

create table if not exists free_access_claims (
  id uuid primary key default gen_random_uuid(),
  phone varchar(16) not null,
  voucher varchar(5) not null check (voucher in ('RYRNN', 'KSSSS')),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  event_key text unique,
  session_mac text,
  session_account_id integer,
  session_start_time text,
  created_at timestamptz not null default now()
);
create index if not exists ix_free_access_claims_match on free_access_claims (phone, voucher, expires_at, consumed_at);

insert into sms_message_templates (message_type, template, updated_by)
values ('FREE_ACCESS', 'SUPA LAN: Your 7-minute free access is now active! Voucher: {{voucher}}. Enjoy your connection. Support: {{support}}', 'system')
on conflict (message_type) do nothing;
