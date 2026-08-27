-- 0007_posting.sql
-- The posting engine (§2, §4.2).
--
-- Posting is the commit. It validates, writes ledger rows, updates serial
-- custody, stamps the document, and logs — all in one transaction, so a
-- document is never half-posted.
--
-- security definer because it writes stock_movements and serial_movements,
-- which no ordinary role may insert into directly. That is the point: the
-- ledger cannot be written around this function.

-- Sign convention by document type. Receipts add, issues remove, transfers do
-- both ends. Adjustments take their direction from the line, and counts from
-- the variance — both handled in post_document rather than here.
create or replace function movement_sign(p_type doc_type)
returns integer language sql immutable as $$
  select case p_type
    when 'RECEIPT'    then  1
    when 'ISSUE'      then -1
    when 'ADJUSTMENT' then  1   -- overridden per line by direction
    when 'COUNT'      then  1   -- overridden by counted - expected
    when 'TRANSFER'   then -1   -- source leg; destination leg written separately
  end;
$$;


create or replace function post_document(p_doc_id uuid)
returns uuid language plpgsql security definer
set search_path = public as $$
declare
  d          documents%rowtype;
  ln         record;
  v_sign     integer;
  v_qty      numeric(12,3);
  v_lines    integer;
  v_serial   serial_units%rowtype;
  v_after    jsonb;
begin
  select * into d from documents where id = p_doc_id for update;

  if not found then
    raise exception 'document % not found', p_doc_id using errcode = 'no_data_found';
  end if;

  if d.status <> 'DRAFT' then
    raise exception 'document % is already %', d.doc_number, lower(d.status::text)
      using errcode = 'check_violation';
  end if;

  -- Role gates (§1.1). Buyers move stock; only managers may create it from
  -- nothing via an adjustment, or approve a count variance.
  if d.doc_type in ('ADJUSTMENT','COUNT') then
    if not has_role('manager') then
      raise exception 'posting a % requires the manager role', lower(d.doc_type::text)
        using errcode = 'insufficient_privilege';
    end if;
  else
    if not has_role('buyer') then
      raise exception 'posting a % requires the buyer role', lower(d.doc_type::text)
        using errcode = 'insufficient_privilege';
    end if;
  end if;

  if d.location_id is null then
    raise exception 'document % has no location', d.doc_number
      using errcode = 'check_violation';
  end if;

  if d.doc_type = 'ADJUSTMENT'
     and (d.reason is null or length(trim(d.reason)) = 0) then
    raise exception 'an adjustment requires a reason' using errcode = 'check_violation';
  end if;

  select count(*) into v_lines from document_lines where document_id = d.id;
  if v_lines = 0 then
    raise exception 'document % has no lines', d.doc_number using errcode = 'check_violation';
  end if;

  v_sign := movement_sign(d.doc_type);

  for ln in
    select dl.*, i.is_serialized, i.sku, i.unit_cost as item_cost
    from document_lines dl
    join items i on i.id = dl.item_id
    where dl.document_id = d.id
    order by dl.id
  loop
    v_qty := ln.quantity * v_sign;

    if d.doc_type = 'ADJUSTMENT' then
      -- Line quantity is always positive (§ the table constraint); the
      -- direction column carries the sign. Without this an adjustment could
      -- only ever add stock, and shrinkage (§5.9) would be unmeasurable.
      if ln.direction is null then
        raise exception
          'adjustment line for % must state a direction (increase or decrease)', ln.sku
          using errcode = 'check_violation';
      end if;

      v_qty := case when ln.direction = 'decrease' then -ln.quantity else ln.quantity end;
    end if;

    if d.doc_type = 'COUNT' then
      -- A count posts its variance, not its absolute quantity (§6).
      if ln.counted_qty is null or ln.expected_qty is null then
        raise exception 'count line for % is missing counted or expected quantity', ln.sku
          using errcode = 'check_violation';
      end if;
      v_qty := ln.counted_qty - ln.expected_qty;

      if v_qty = 0 then
        continue;   -- no variance, nothing to post for this line
      end if;
    end if;

    -- ---------------------------------------------------------------
    -- Serialized items
    -- ---------------------------------------------------------------
    if ln.is_serialized then
      if ln.quantity <> 1 then
        raise exception
          'item % is serialized: each line must be exactly 1 unit, got %', ln.sku, ln.quantity
          using errcode = 'check_violation';
      end if;

      if ln.serial_unit_id is null then
        raise exception 'item % is serialized: a serial is required on every line', ln.sku
          using errcode = 'check_violation';
      end if;

      select * into v_serial from serial_units where id = ln.serial_unit_id for update;

      if not found then
        raise exception 'serial unit % not found', ln.serial_unit_id
          using errcode = 'no_data_found';
      end if;

      if v_serial.item_id <> ln.item_id then
        raise exception 'serial % belongs to a different item', v_serial.serial
          using errcode = 'check_violation';
      end if;

      -- Legal state transitions. Rejecting by name matters: "serial ABC123 is
      -- already issued" is actionable, "constraint violation" is not.
      if d.doc_type = 'RECEIPT' then
        if v_serial.status = 'in_stock' then
          raise exception 'serial % is already in stock at this location', v_serial.serial
            using errcode = 'check_violation';
        end if;

        insert into serial_movements (serial_unit_id, document_id, doc_type,
                                      from_location, to_location,
                                      from_status, to_status, occurred_at, posted_by)
        values (v_serial.id, d.id, d.doc_type, v_serial.location_id, d.location_id,
                v_serial.status, 'in_stock', d.occurred_at, auth.uid());

        update serial_units
        set status = 'in_stock', location_id = d.location_id,
            unit_cost = coalesce(ln.unit_cost, unit_cost),
            received_doc = coalesce(received_doc, d.id)
        where id = v_serial.id;

      elsif d.doc_type in ('ISSUE','TRANSFER') then
        if v_serial.status <> 'in_stock' then
          raise exception 'serial % is %, it cannot be issued or transferred',
            v_serial.serial, replace(v_serial.status::text, '_', ' ')
            using errcode = 'check_violation';
        end if;

        if v_serial.location_id <> d.location_id then
          raise exception 'serial % is not at this location', v_serial.serial
            using errcode = 'check_violation';
        end if;

        insert into serial_movements (serial_unit_id, document_id, doc_type,
                                      from_location, to_location,
                                      from_status, to_status, occurred_at, posted_by)
        values (v_serial.id, d.id, d.doc_type, v_serial.location_id,
                case when d.doc_type = 'TRANSFER' then d.to_location_id else null end,
                v_serial.status,
                case when d.doc_type = 'TRANSFER' then 'in_stock' else 'issued' end,
                d.occurred_at, auth.uid());

        if d.doc_type = 'TRANSFER' then
          update serial_units set location_id = d.to_location_id where id = v_serial.id;
        else
          update serial_units set status = 'issued', location_id = null
          where id = v_serial.id;
        end if;

      else  -- ADJUSTMENT or COUNT
        insert into serial_movements (serial_unit_id, document_id, doc_type,
                                      from_location, to_location,
                                      from_status, to_status, occurred_at, posted_by)
        values (v_serial.id, d.id, d.doc_type, v_serial.location_id,
                case when v_qty > 0 then d.location_id else null end,
                v_serial.status,
                case when v_qty > 0 then 'in_stock' else 'written_off' end,
                d.occurred_at, auth.uid());

        update serial_units
        set status      = case when v_qty > 0 then 'in_stock' else 'written_off' end,
            location_id = case when v_qty > 0 then d.location_id else null end
        where id = v_serial.id;
      end if;
    end if;

    -- ---------------------------------------------------------------
    -- Ledger. Written for serialized items too, so every metric in §5
    -- works without special-casing.
    -- ---------------------------------------------------------------
    insert into stock_movements (item_id, location_id, quantity, unit_cost,
                                 document_id, doc_type, occurred_at, posted_by)
    values (ln.item_id, d.location_id, v_qty,
            coalesce(ln.unit_cost, ln.item_cost),
            d.id, d.doc_type, d.occurred_at, auth.uid());

    -- Transfers write both legs. Two rows, not one, so each location's
    -- balance is independently correct and the ledger stays a plain sum.
    if d.doc_type = 'TRANSFER' then
      insert into stock_movements (item_id, location_id, quantity, unit_cost,
                                   document_id, doc_type, occurred_at, posted_by)
      values (ln.item_id, d.to_location_id, abs(v_qty),
              coalesce(ln.unit_cost, ln.item_cost),
              d.id, d.doc_type, d.occurred_at, auth.uid());
    end if;
  end loop;

  update documents
  set status = 'POSTED', posted_at = now(), posted_by = auth.uid()
  where id = d.id;

  select jsonb_build_object(
    'doc_number', d.doc_number,
    'doc_type',   d.doc_type,
    'location_id', d.location_id,
    'lines', coalesce(jsonb_agg(jsonb_build_object(
      'sku', i.sku, 'quantity', dl.quantity, 'unit_cost', dl.unit_cost)), '[]'::jsonb)
  ) into v_after
  from document_lines dl join items i on i.id = dl.item_id
  where dl.document_id = d.id;

  perform write_audit('document.post', 'document', d.id::text, null, v_after);

  -- Non-concurrent: REFRESH ... CONCURRENTLY cannot run inside a transaction
  -- block, and posting must be atomic. At this scale the recompute is
  -- milliseconds; the brief lock is the right trade for a correct balance
  -- the instant the document commits (§12).
  refresh materialized view stock_on_hand;

  return d.id;
end; $$;

grant execute on function post_document(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- Voiding (§4.2) — reverses, never erases
-- ---------------------------------------------------------------------------

create or replace function void_document(p_doc_id uuid, p_reason text)
returns uuid language plpgsql security definer
set search_path = public as $$
declare
  d        documents%rowtype;
  mv       record;
  sm       record;
  v_new_id uuid;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'voiding requires a reason' using errcode = 'check_violation';
  end if;

  select * into d from documents where id = p_doc_id for update;

  if not found then
    raise exception 'document % not found', p_doc_id using errcode = 'no_data_found';
  end if;

  if d.status <> 'POSTED' then
    raise exception 'only a posted document can be voided (% is %)',
      d.doc_number, lower(d.status::text) using errcode = 'check_violation';
  end if;

  if not has_role('manager') then
    raise exception 'voiding requires the manager role' using errcode = 'insufficient_privilege';
  end if;

  -- The reversing document is a real document with its own number, so the
  -- register shows both and neither disappears.
  insert into documents (doc_type, status, location_id, to_location_id, supplier_id,
                         issue_reason, reference, reason, occurred_at,
                         posted_at, posted_by, voids_document, created_by)
  values (d.doc_type, 'POSTED', d.location_id, d.to_location_id, d.supplier_id,
          d.issue_reason, d.reference,
          'Reversal of ' || d.doc_number || ': ' || p_reason,
          now(), now(), auth.uid(), d.id, auth.uid())
  returning id into v_new_id;

  -- Offsetting ledger entries, one per original movement.
  for mv in select * from stock_movements where document_id = d.id order by id loop
    insert into stock_movements (item_id, location_id, quantity, unit_cost,
                                 document_id, doc_type, occurred_at, posted_by)
    values (mv.item_id, mv.location_id, -mv.quantity, mv.unit_cost,
            v_new_id, mv.doc_type, now(), auth.uid());
  end loop;

  -- Reverse serial custody by replaying each movement backwards.
  for sm in select * from serial_movements where document_id = d.id order by id desc loop
    insert into serial_movements (serial_unit_id, document_id, doc_type,
                                  from_location, to_location,
                                  from_status, to_status, occurred_at, posted_by)
    values (sm.serial_unit_id, v_new_id, sm.doc_type,
            sm.to_location, sm.from_location,
            sm.to_status, sm.from_status, now(), auth.uid());

    update serial_units
    set status      = sm.from_status,
        location_id = sm.from_location
    where id = sm.serial_unit_id;
  end loop;

  update documents
  set status = 'VOIDED', voided_at = now(), voided_by = auth.uid(), void_reason = p_reason
  where id = d.id;

  perform write_audit('document.void', 'document', d.id::text,
    jsonb_build_object('doc_number', d.doc_number, 'status', 'POSTED'),
    jsonb_build_object('status', 'VOIDED', 'reason', p_reason,
                       'reversing_document', v_new_id));

  refresh materialized view stock_on_hand;

  return v_new_id;
end; $$;

grant execute on function void_document(uuid, text) to authenticated;
