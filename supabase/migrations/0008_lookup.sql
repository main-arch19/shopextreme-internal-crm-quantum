-- 0008_lookup.sql
-- Item resolution for the entry screens (§7.1, §8).
--
-- Entry speed is an engineering constraint, not a nicety: under 15 seconds to
-- post a receipt, under 5 to record an issue (§3). If entry is slower than
-- scribbling on the box, people scribble, and the whole system silently
-- drifts. Every function here exists to make one round trip do the work of
-- several.

-- Exact resolution for a scan. A scanner types a barcode and presses Enter,
-- so this must be a single indexed lookup with no ambiguity — a scan either
-- resolves to exactly one item or it does not resolve.
create or replace function resolve_scan(p_code text, p_location_id uuid default null)
returns table (
  item_id       uuid,
  sku           text,
  name          text,
  unit          text,
  unit_cost     numeric(12,2),
  is_serialized boolean,
  on_hand       numeric(12,3),
  matched_on    text
) language sql stable security definer
set search_path = public as $$
  -- Aggregated, not joined row-for-row: an item has one stock_on_hand row per
  -- location, so a plain join would return several rows and `limit 1` would
  -- pick an arbitrary location's balance. With p_location_id given this sums
  -- one row; without it, the total across all locations.
  select i.id, i.sku, i.name, i.unit, i.unit_cost, i.is_serialized,
         coalesce((
           select sum(soh.on_hand) from stock_on_hand soh
           where soh.item_id = i.id
             and (p_location_id is null or soh.location_id = p_location_id)
         ), 0),
         case when i.barcode = upper(trim(p_code)) then 'barcode' else 'sku' end
  from items i
  where i.is_active
    and (i.barcode = upper(trim(p_code)) or i.sku = upper(trim(p_code)))
  limit 1;
$$;

grant execute on function resolve_scan(text, uuid) to authenticated;


-- Search-as-you-type. Ranked so the most likely match is first: an exact SKU
-- beats a prefix match, which beats a substring in the name.
create or replace function search_items(
  p_query text,
  p_location_id uuid default null,
  p_limit integer default 12
)
returns table (
  item_id       uuid,
  sku           text,
  name          text,
  unit          text,
  unit_cost     numeric(12,2),
  is_serialized boolean,
  on_hand       numeric(12,3)
) language sql stable security definer
set search_path = public as $$
  with q as (select upper(trim(p_query)) as term)
  select i.id, i.sku, i.name, i.unit, i.unit_cost, i.is_serialized,
         coalesce((
           select sum(soh.on_hand) from stock_on_hand soh
           where soh.item_id = i.id
             and (p_location_id is null or soh.location_id = p_location_id)
         ), 0)
  from items i, q
  where i.is_active
    and (i.sku like q.term || '%'
      or i.barcode = q.term
      or upper(i.name) like '%' || q.term || '%')
  order by
    case
      when i.sku = q.term then 0
      when i.barcode = q.term then 1
      when i.sku like q.term || '%' then 2
      when upper(i.name) like q.term || '%' then 3
      else 4
    end,
    i.sku
  limit least(coalesce(p_limit, 12), 50);
$$;

grant execute on function search_items(text, uuid, integer) to authenticated;


-- Serial resolution for the scan loop (§ phase 3).
--
-- Returns the serial's current state so the entry screen can reject a
-- duplicate inline — without losing focus or the accumulated list. Rejecting
-- at post time instead would mean discovering the problem after 40 scans.
create or replace function resolve_serial(
  p_item_id uuid,
  p_serial text,
  p_doc_type doc_type,
  p_location_id uuid
)
returns table (
  serial_unit_id uuid,
  serial         text,
  status         serial_status,
  location_id    uuid,
  acceptable     boolean,
  message        text
) language plpgsql stable security definer
set search_path = public as $$
declare
  v_serial text := upper(trim(p_serial));
  su serial_units%rowtype;
begin
  select * into su from serial_units
  where item_id = p_item_id and upper(serial) = v_serial;

  if p_doc_type = 'RECEIPT' then
    if not found then
      -- New serial on a receipt is the normal case.
      return query select null::uuid, v_serial, null::serial_status, null::uuid,
        true, 'New serial'::text;
    elsif su.status = 'in_stock' then
      return query select su.id, su.serial, su.status, su.location_id,
        false, format('Serial %s is already in stock', su.serial);
    else
      return query select su.id, su.serial, su.status, su.location_id,
        true, format('Returning serial %s to stock', su.serial);
    end if;
  else
    if not found then
      return query select null::uuid, v_serial, null::serial_status, null::uuid,
        false, format('Serial %s is not on record for this item', v_serial);
    elsif su.status <> 'in_stock' then
      return query select su.id, su.serial, su.status, su.location_id,
        false, format('Serial %s is %s', su.serial, replace(su.status::text, '_', ' '));
    elsif su.location_id <> p_location_id then
      return query select su.id, su.serial, su.status, su.location_id,
        false, format('Serial %s is at another location', su.serial);
    else
      return query select su.id, su.serial, su.status, su.location_id,
        true, 'OK'::text;
    end if;
  end if;
end; $$;

grant execute on function resolve_serial(uuid, text, doc_type, uuid) to authenticated;


-- Creates a serial row on receipt if it does not exist yet, so the scan loop
-- can register unseen serials without a separate catalog step.
create or replace function ensure_serial_unit(p_item_id uuid, p_serial text)
returns uuid language plpgsql security definer
set search_path = public as $$
declare
  v_serial text := upper(trim(p_serial));
  v_id uuid;
begin
  if not has_role('buyer') then
    raise exception 'registering a serial requires the buyer role'
      using errcode = 'insufficient_privilege';
  end if;

  if length(v_serial) = 0 then
    raise exception 'a serial cannot be blank' using errcode = 'check_violation';
  end if;

  select id into v_id from serial_units
  where item_id = p_item_id and upper(serial) = v_serial;

  if v_id is not null then
    return v_id;
  end if;

  -- Created as written_off with no location: it does not exist in stock until
  -- a receipt posts it. Creating it as in_stock here would inflate on-hand
  -- from a scan that was never posted.
  insert into serial_units (item_id, serial, status, location_id)
  values (p_item_id, v_serial, 'written_off', null)
  returning id into v_id;

  return v_id;
end; $$;

grant execute on function ensure_serial_unit(uuid, text) to authenticated;
