-- Outdoor Wi-Fi client tracking. Additive and idempotent; review before production execution.
create table if not exists outdoor_wifi_clients (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete set null,
  package_id text references packages(id) on delete set null,
  customer_name text,
  phone text not null,
  package_name text not null,
  package_price numeric(12,2),
  voucher_code text,
  order_reference text,
  mac_address text not null,
  wifi_credentials_issued boolean not null default false,
  airtel_mac_rule_added boolean not null default false,
  blacklist_enabled boolean not null default false,
  activation_at timestamptz not null,
  expected_expiry_at timestamptz not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','EXPIRING_SOON','ACTION_REQUIRED','BLACKLISTED','CANCELLED')),
  notes text,
  action_required_at timestamptz,
  blacklist_enabled_at timestamptz,
  blacklist_enabled_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint outdoor_wifi_clients_mac_format check (mac_address ~ '^[0-9A-F]{2}(:[0-9A-F]{2}){5}$'),
  constraint outdoor_wifi_clients_expiry_after_activation check (expected_expiry_at > activation_at)
);
create unique index if not exists idx_outdoor_wifi_clients_mac_active on outdoor_wifi_clients(mac_address) where status <> 'CANCELLED';
create index if not exists idx_outdoor_wifi_clients_expiry on outdoor_wifi_clients(status, expected_expiry_at);
create index if not exists idx_outdoor_wifi_clients_phone on outdoor_wifi_clients(phone);

create table if not exists outdoor_wifi_action_events (
  id bigserial primary key,
  client_id uuid not null references outdoor_wifi_clients(id) on delete cascade,
  event_type text not null default 'ACTION_REQUIRED',
  status text not null default 'PENDING' check (status in ('PENDING','SENT','FAILED','COMPLETED')),
  sms_recipient text,
  sms_message text,
  provider_message_id text,
  error_message text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  completed_at timestamptz,
  unique(client_id, event_type)
);
create index if not exists idx_outdoor_wifi_action_events_status on outdoor_wifi_action_events(status, created_at);

-- No existing payment, voucher, expiry, router, or SMS records are changed.
-- Admin SMS recipient is intentionally supplied at runtime via OUTDOOR_WIFI_ADMIN_PHONE or ADMIN_PHONE.
-- This migration is safe to run repeatedly.

create or replace function outdoor_wifi_touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists outdoor_wifi_clients_touch_updated_at on outdoor_wifi_clients;
create trigger outdoor_wifi_clients_touch_updated_at before update on outdoor_wifi_clients for each row execute function outdoor_wifi_touch_updated_at();
