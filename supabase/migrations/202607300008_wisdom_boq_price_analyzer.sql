-- Deterministic, auditable WisdomAI price analysis.
-- It uses only verified/comparable data and leaves the final decision to Sale.

create or replace function public.analyze_boq_item_prices(p_boq_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.boq_items;
  v_kind text;
  v_latest numeric(16,4);
  v_government numeric(16,4);
  v_min numeric(16,4);
  v_max numeric(16,4);
  v_avg numeric(16,4);
  v_count integer;
  v_recommended numeric(16,4);
  v_confidence numeric(5,4);
  v_reason text;
begin
  if not public.is_work_manager() then
    raise exception 'Forbidden';
  end if;

  select * into v_item from public.boq_items where id = p_boq_item_id;
  if not found then raise exception 'BOQ item not found'; end if;

  foreach v_kind in array array['material','labour'] loop
    v_latest := null; v_government := null; v_min := null; v_max := null;
    v_avg := null; v_count := 0; v_recommended := null;

    if v_kind = 'material' and v_item.inventory_item_id is not null then
      select p.effective_unit_price into v_latest
      from public.vendor_product_prices p
      where p.inventory_item_id = v_item.inventory_item_id
        and (p.unit is null or lower(p.unit) = lower(v_item.unit))
      order by p.observed_at desc, p.created_at desc limit 1;
    end if;

    select
      min(r.unit_price), max(r.unit_price), avg(r.unit_price), count(*)::integer,
      (array_agg(r.unit_price order by r.effective_date desc, r.created_at desc)
        filter (where r.source_type = 'cgd_reference'))[1]
    into v_min, v_max, v_avg, v_count, v_government
    from public.cost_reference_prices r
    where r.verified and r.cost_kind = v_kind and lower(r.unit) = lower(v_item.unit)
      and (
        (v_item.boq_code <> '' and lower(coalesce(r.item_code,'')) = lower(v_item.boq_code))
        or lower(regexp_replace(r.description, '\s+', ' ', 'g'))
          = lower(regexp_replace(v_item.description, '\s+', ' ', 'g'))
      );

    if v_latest is not null then
      v_min := least(coalesce(v_min, v_latest), v_latest);
      v_max := greatest(coalesce(v_max, v_latest), v_latest);
      v_count := v_count + 1;
    end if;

    -- Recent actual cost has priority; government/verified references anchor it.
    v_recommended := case
      when v_latest is not null and v_government is not null then round((v_latest * 0.60 + v_government * 0.40)::numeric, 4)
      when v_latest is not null and v_avg is not null then round((v_latest * 0.70 + v_avg * 0.30)::numeric, 4)
      when v_latest is not null then v_latest
      when v_government is not null and v_avg is not null then round((v_government * 0.60 + v_avg * 0.40)::numeric, 4)
      when v_government is not null then v_government
      else v_avg
    end;
    v_confidence := least(0.95, case when v_count >= 5 then 0.90 when v_count >= 3 then 0.75 when v_count >= 1 then 0.55 else 0.20 end);
    v_reason := case
      when v_recommended is null then 'ไม่มีข้อมูลที่สเปกและหน่วยตรงกัน ห้ามประมาณราคาอัตโนมัติ'
      else format('วิเคราะห์จากข้อมูลเปรียบเทียบ %s แหล่ง%s%s โดย Sale ต้องยืนยันราคาสุดท้าย',
        v_count,
        case when v_latest is not null then ', มีราคาจ่ายจริงล่าสุด' else '' end,
        case when v_government is not null then ', มีราคากลางกรมบัญชีกลาง' else '' end)
    end;

    insert into public.boq_item_price_decisions(
      boq_item_id, cost_kind, latest_actual_price, government_reference_price,
      comparable_min_price, comparable_max_price, ai_recommended_price,
      ai_confidence, ai_reason, status, analysis_snapshot, updated_at
    ) values (
      v_item.id, v_kind, v_latest, v_government, v_min, v_max, v_recommended,
      v_confidence, v_reason,
      case when v_recommended is null then 'awaiting_data' else 'awaiting_sale' end,
      jsonb_build_object('analyzed_at', now(), 'source_count', v_count, 'unit', v_item.unit,
        'matching_rule', 'boq_code_or_exact_normalized_description'), now()
    )
    on conflict (boq_item_id, cost_kind) do update set
      latest_actual_price = excluded.latest_actual_price,
      government_reference_price = excluded.government_reference_price,
      comparable_min_price = excluded.comparable_min_price,
      comparable_max_price = excluded.comparable_max_price,
      ai_recommended_price = excluded.ai_recommended_price,
      ai_confidence = excluded.ai_confidence,
      ai_reason = excluded.ai_reason,
      status = case when public.boq_item_price_decisions.sale_decided_price is null
        then excluded.status else public.boq_item_price_decisions.status end,
      analysis_snapshot = excluded.analysis_snapshot,
      updated_at = now();
  end loop;
end;
$$;

revoke all on function public.analyze_boq_item_prices(uuid) from public;
grant execute on function public.analyze_boq_item_prices(uuid) to authenticated;

