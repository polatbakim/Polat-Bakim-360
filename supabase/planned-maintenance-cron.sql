-- Ana şema (schema.sql) kurulduktan sonra SQL Editor'da bir kez çalıştırılır.
-- Aktif, otomatik açılış seçili bakım kartlarını saat başında kontrol eder.
-- Eski kartlar kendiliğinden etkinleşmez; kart düzenleme ekranından açılabilir.

create extension if not exists pg_cron with schema extensions;

create or replace function public.planned_maintenance_next_due(
  p_due date, p_period text, p_interval_days integer,
  p_interval_months integer, p_anchor_day integer
)
returns date language plpgsql immutable set search_path=public
as $$
declare v_months integer; v_first date; v_last_day integer;
begin
  v_months := case p_period
    when 'Aylık' then 1 when '3 Aylık' then 3
    when '6 Aylık' then 6 when 'Yıllık' then 12
    when 'Özel (ay)' then greatest(1,coalesce(p_interval_months,1))
    else 0 end;
  if v_months > 0 then
    v_first := (date_trunc('month',p_due::timestamp)::date + make_interval(months=>v_months))::date;
    v_last_day := extract(day from (v_first + interval '1 month' - interval '1 day'))::integer;
    return make_date(extract(year from v_first)::integer,extract(month from v_first)::integer,
      least(greatest(1,coalesce(p_anchor_day,extract(day from p_due)::integer)),v_last_day));
  end if;
  return p_due + case p_period
    when 'Günlük' then 1 when 'Haftalık' then 7
    else greatest(1,coalesce(p_interval_days,1)) end;
end;
$$;

create or replace function public.open_due_planned_maintenance(p_workspace text default 'polat-bakim-main')
returns integer language plpgsql security definer set search_path=public
as $$
declare
  v_payload jsonb; v_version bigint; v_cards jsonb; v_cards_out jsonb='[]'::jsonb;
  v_orders jsonb; v_card jsonb; v_asset jsonb; v_order jsonb; v_event jsonb;
  v_today date := (clock_timestamp() at time zone 'Europe/Istanbul')::date;
  v_due date; v_next date; v_anchor integer; v_days integer; v_months integer;
  v_id text; v_year text := to_char(clock_timestamp() at time zone 'Europe/Istanbul','YYYY');
  v_sequence integer; v_created integer := 0; v_changed boolean := false;
  v_now text;
begin
  select payload,version into v_payload,v_version
    from public.app_snapshots where id=p_workspace for update;
  if not found then return 0; end if;
  v_cards := case when jsonb_typeof(v_payload->'maintenanceCards')='array'
    then v_payload->'maintenanceCards' else '[]'::jsonb end;
  v_orders := case when jsonb_typeof(v_payload->'orders')='array'
    then v_payload->'orders' else '[]'::jsonb end;
  select coalesce(max((regexp_match(item->>'id','^IE-'||v_year||'-([0-9]+)$'))[1]::integer),0)
    into v_sequence from jsonb_array_elements(v_orders) as existing(item);

  for v_card in select value from jsonb_array_elements(v_cards) loop
    if coalesce(v_card->>'autoGenerate','false')='true'
      and coalesce(v_card->>'active','false')='true'
      and coalesce(v_card->>'nextDueDate','') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    then
      v_due := (v_card->>'nextDueDate')::date;
      if v_due <= v_today then
        if not exists (
          select 1 from jsonb_array_elements(v_orders) as existing(item)
          where item->>'maintenanceCardId'=v_card->>'id'
            and coalesce(item->>'scheduledDate',item->>'dueDate')=v_due::text
        ) then
          v_asset := null;
          select value into v_asset
            from jsonb_array_elements(coalesce(v_payload->'assets','[]'::jsonb)) as asset(value)
            where value->>'id'=v_card->>'assetId' limit 1;
          v_sequence := v_sequence+1;
          v_id := 'IE-'||v_year||'-'||lpad(v_sequence::text,4,'0');
          v_now := to_char(clock_timestamp() at time zone 'Europe/Istanbul','YYYY-MM-DD"T"HH24:MI:SS');
          v_event := jsonb_build_object(
            'id','EV-AUTO-'||v_id,'orderId',v_id,'assetId',coalesce(v_card->>'assetId',''),
            'eventType','created','title','Planlı bakım iş emri otomatik oluşturuldu',
            'detail','Bakım periyodu geldi; personel ataması bekleniyor.',
            'statusFrom','','statusTo','Bekliyor','actorId','SYSTEM',
            'actorName','Sistem','actorRole','Sistem','source','cron',
            'metadata',jsonb_build_object('maintenanceCardId',v_card->>'id'),'timestamp',v_now
          );
          v_order := jsonb_build_object(
            'id',v_id,'title',coalesce(v_card->>'title','Planlı Bakım'),
            'assetId',coalesce(v_card->>'assetId',''),'location',coalesce(v_asset->>'location',''),
            'type','Planlı Bakım','maintenanceBranch',coalesce(v_card->>'branch','Genel Bakım'),
            'priority','Planlı','assignmentMode','selected','technicianId','',
            'assignedTechnicians','[]'::jsonb,'additionalTechnicians','[]'::jsonb,
            'claimedTechnicians','[]'::jsonb,'startedTechnicians','[]'::jsonb,
            'dueDate',v_due::text,'scheduledDate',v_due::text,
            'period',coalesce(v_card->>'period','Aylık'),
            'intervalMonths',coalesce((v_card->>'intervalMonths')::integer,0),
            'description',coalesce(nullif(v_card->>'instructions',''),coalesce(v_card->>'title','Planlı Bakım')||' kontrol listesini uygula.'),
            'status','Bekliyor','createdAt',v_now,'updatedAt',v_now,
            'faultStart','','notificationStatus','Yok','notificationNo','',
            'purchaseOrderNo','','sapSyncStatus','Yerel','ptNo',coalesce(v_asset->>'code',''),
            'costCenter',coalesce(v_asset->>'costCenter',''),'estimatedCost',0,'plannedHours',coalesce((v_card->>'plannedHours')::numeric,1),
            'startTime','','completionTime','','laborCost',0,'materialCost',0,
            'serviceCost',0,'otherCost',0,'totalCost',0,
            'maintenanceCardId',v_card->>'id','events',jsonb_build_array(v_event)
          );
          v_orders := jsonb_build_array(v_order)||v_orders;
          v_card := v_card||jsonb_build_object('lastOrderId',v_id);
          v_created := v_created+1;
        end if;
        v_anchor := coalesce(nullif(v_card->>'scheduleAnchorDay','')::integer,extract(day from v_due)::integer);
        v_days := coalesce(nullif(v_card->>'intervalDays','')::integer,1);
        v_months := coalesce(nullif(v_card->>'intervalMonths','')::integer,0);
        v_next := public.planned_maintenance_next_due(v_due,v_card->>'period',v_days,v_months,v_anchor);
        -- Bir kesinti nedeniyle eski tarih kaldıysa tek telafi işi açılır; geçmiş aylar yığılmaz.
        while v_next <= v_today loop
          v_next := public.planned_maintenance_next_due(v_next,v_card->>'period',v_days,v_months,v_anchor);
        end loop;
        v_card := v_card||jsonb_build_object('nextDueDate',v_next::text);
        v_changed := true;
      end if;
    end if;
    v_cards_out := v_cards_out||jsonb_build_array(v_card);
  end loop;

  if v_changed then
    update public.app_snapshots set
      payload=jsonb_set(jsonb_set(v_payload,'{orders}',v_orders,true),'{maintenanceCards}',v_cards_out,true),
      version=v_version+1,updated_by=null,updated_at=now()
      where id=p_workspace;
    insert into public.app_sync_events(id,version) values(p_workspace,v_version+1)
      on conflict(id) do update set version=excluded.version,updated_at=now();
  end if;
  return v_created;
end;
$$;

revoke all on function public.open_due_planned_maintenance(text) from public,anon,authenticated;
revoke all on function public.planned_maintenance_next_due(date,text,integer,integer,integer) from public,anon,authenticated;

-- Saatte bir kontrol; tarih hesabı Europe/Istanbul saat dilimindedir.
select cron.schedule(
  'polat-bakim-planned-maintenance',
  '5 * * * *',
  $$select public.open_due_planned_maintenance('polat-bakim-main');$$
);
