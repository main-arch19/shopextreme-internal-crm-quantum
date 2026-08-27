-- 0003_catalog.sql
-- Locations, suppliers, items (§4.1).
--
-- The SKU format constraint here is the highest-leverage line in the schema.
-- Without it MUG12, mug-12, and MUG 12 become three items inside a month, and
-- no amount of later cleanup fully recovers — the movements are already split
-- across the duplicates.

create table locations (
  id            uuid primary key default gen_random_uuid(),
  code          text unique not null,
  name          text not null,
  type          text not null default 'warehouse',   -- warehouse | shop | van | quarantine
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  constraint location_type_known
    check (type in ('warehouse','shop','van','quarantine')),
  constraint location_code_format
    check (code ~ '^[A-Z0-9][A-Z0-9-]*$')
);

create table suppliers (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  contact_name   text,
  contact_email  text,
  phone          text,
  lead_time_days integer,
  currency       text not null default 'USD',
  notes          text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  -- Lead time drives the reorder point (§5.4) and the runway marker (§7.2).
  -- A zero or negative value silently makes everything look safe.
  constraint supplier_lead_time_positive
    check (lead_time_days is null or lead_time_days > 0)
);

create index on suppliers (is_active) where is_active;

create table items (
  id                   uuid primary key default gen_random_uuid(),
  sku                  text unique not null,
  name                 text not null,
  category             text,
  unit                 text not null default 'each',   -- each | kg | litre | box | case
  units_per_case       integer not null default 1,
  barcode              text unique,
  unit_cost            numeric(12,2),
  sell_price           numeric(12,2),
  supplier_id          uuid references suppliers(id),
  moq                  integer not null default 1,
  target_cover_days    integer not null default 45,
  service_level        numeric(4,3) not null default 0.95,
  manual_reorder_point integer,
  velocity_window_days integer not null default 28,
  exclude_from_reorder boolean not null default false,
  is_tracked           boolean not null default true,
  is_active            boolean not null default true,
  -- Serial tracking (§14.6). Per-item, so serialized and bulk goods coexist
  -- in one ledger. Serialized items require one serial per unit on every
  -- document line; bulk items post quantities as normal.
  is_serialized        boolean not null default false,
  created_at           timestamptz not null default now(),

  -- PREFIX-NNNN. Category prefix plus zero-padded sequence: MUG-0012.
  constraint item_sku_format check (sku ~ '^[A-Z]{2,6}-[0-9]{3,6}$'),

  constraint item_unit_known
    check (unit in ('each','kg','litre','box','case')),
  constraint item_units_per_case_positive check (units_per_case >= 1),
  constraint item_moq_positive check (moq >= 1),
  constraint item_target_cover_positive check (target_cover_days > 0),
  constraint item_velocity_window_positive check (velocity_window_days > 0),
  -- Z is unbounded as service level approaches 1, so 0.999 is the practical
  -- ceiling; 0.5 or below means the safety stock formula is being misused.
  constraint item_service_level_range
    check (service_level > 0.5 and service_level <= 0.999),
  constraint item_cost_non_negative
    check (unit_cost is null or unit_cost >= 0),
  constraint item_price_non_negative
    check (sell_price is null or sell_price >= 0),

  -- A serialized item is counted in whole units by definition. Allowing kg or
  -- a case pack would make "one serial per unit" ambiguous at posting time.
  constraint serialized_items_are_discrete
    check (not is_serialized or (unit = 'each' and units_per_case = 1))
);

create index on items (sku);
create index on items (barcode);
create index on items (supplier_id);
create index on items (category);
create index on items (is_active) where is_active;
create index on items (is_serialized) where is_serialized;


-- ---------------------------------------------------------------------------
-- SKU normalization and sequence generation
-- ---------------------------------------------------------------------------

-- Uppercase and trim before the constraint is checked, so a lowercase entry
-- is corrected rather than rejected. Rejecting 'mug-0012' would be defensible
-- but teaches nothing; normalizing quietly does the right thing and the
-- constraint still catches genuinely malformed input.
create or replace function normalize_item_sku()
returns trigger language plpgsql as $$
begin
  new.sku := upper(trim(new.sku));
  if new.barcode is not null then
    new.barcode := nullif(trim(new.barcode), '');
  end if;
  return new;
end; $$;

create trigger items_normalize_sku
  before insert or update on items
  for each row execute function normalize_item_sku();

create or replace function normalize_location_code()
returns trigger language plpgsql as $$
begin
  new.code := upper(trim(new.code));
  return new;
end; $$;

create trigger locations_normalize_code
  before insert or update on locations
  for each row execute function normalize_location_code();

-- Next SKU for a prefix. Reads the existing maximum rather than keeping a
-- counter, so an imported catalog continues its own numbering instead of
-- colliding with it.
create or replace function next_sku(p_prefix text)
returns text language plpgsql stable as $$
declare
  v_prefix text := upper(trim(p_prefix));
  v_max integer;
begin
  if v_prefix !~ '^[A-Z]{2,6}$' then
    raise exception 'SKU prefix must be 2-6 letters, got %', p_prefix
      using errcode = 'check_violation';
  end if;

  select max((regexp_replace(sku, '^[A-Z]+-', ''))::integer)
    into v_max
  from items
  where sku like v_prefix || '-%';

  return v_prefix || '-' || lpad((coalesce(v_max, 0) + 1)::text, 4, '0');
end; $$;

grant execute on function next_sku(text) to authenticated;


-- ---------------------------------------------------------------------------
-- Cost and price changes are audited (§10.6 "Money")
-- ---------------------------------------------------------------------------

create or replace function audit_item_money_change()
returns trigger language plpgsql security definer
set search_path = public as $$
begin
  if new.unit_cost is distinct from old.unit_cost then
    perform write_audit('item.cost_change', 'item', new.id::text,
      jsonb_build_object('unit_cost', old.unit_cost),
      jsonb_build_object('unit_cost', new.unit_cost, 'sku', new.sku));
  end if;

  if new.sell_price is distinct from old.sell_price then
    perform write_audit('item.price_change', 'item', new.id::text,
      jsonb_build_object('sell_price', old.sell_price),
      jsonb_build_object('sell_price', new.sell_price, 'sku', new.sku));
  end if;

  return new;
end; $$;

-- AFTER, not BEFORE: the log should record changes that actually committed.
create trigger items_audit_money
  after update on items
  for each row execute function audit_item_money_change();


-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table locations enable row level security;
alter table suppliers enable row level security;
alter table items     enable row level security;

-- Read: any active employee, viewer upward.
create policy locations_read on locations for select using (is_active_employee());
create policy suppliers_read on suppliers for select using (is_active_employee());
create policy items_read     on items     for select using (is_active_employee());

-- Write: manager upward (§1.1 — managers edit costs and reorder policy and
-- manage suppliers; buyers post documents but do not reshape the catalog).
create policy locations_write on locations for all
  using (has_role('manager')) with check (has_role('manager'));
create policy suppliers_write on suppliers for all
  using (has_role('manager')) with check (has_role('manager'));
create policy items_write on items for all
  using (has_role('manager')) with check (has_role('manager'));

-- Catalog rows are referenced by ledger history forever. Deactivate, never
-- delete — the same reasoning as employees (§9.3).
revoke delete on locations, suppliers, items from anon, authenticated;
