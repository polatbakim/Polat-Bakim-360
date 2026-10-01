-- Mevcut Supabase projesinde SQL Editor'da bir kez çalıştırın.
-- Operatör düzeltme isteği ve zorunlu duruş cevabını merkezi kayda taşır.
create or replace function public.update_operator_order(p_id text,p_order_id text,p_patch jsonb)
returns bigint language plpgsql security definer set search_path=public
as $$
declare source jsonb; item jsonb; patched jsonb; orders jsonb='[]'::jsonb; allowed jsonb='{}'::jsonb; key text; tid text; current_version bigint; found boolean=false;
begin
  tid=public.current_technician_id();
  if tid is null then raise exception 'Operatör profili personelle eşleştirilmemiş'; end if;
  select payload,version into source,current_version from public.app_snapshots where id=p_id for update;
  if source is null then raise exception 'Merkezi bakım kaydı bulunamadı'; end if;
foreach key in array array['status','startTime','completionTime','pauseStart','pauseEnd','pauseMinutes','pauseReason','waitingReason','lastWaitingReason','pauseHistory','shiftEntries','actualShiftCount','downtimeMinutes','hasDowntime','purchasedMaterials','additionalTechnicians','maintenanceResults','laborEntries','completionDetails','failureDetails','events','attachments','operatorConfirmation','confirmationRequestedAt','costApprovalStatus','electricalFaults','electricalCauses','mechanicalFaults','mechanicalCauses','otherFault','otherElectricalFault','otherElectricalCause','otherMechanicalFault','otherMechanicalCause','workPerformed','operatorNote','operatorCorrectionPending','operatorCorrectionNote','operatorCorrectionRequestedBy','operatorCorrectionRequestedAt','managerCorrectionPending','safetyConfirmations','lastSafetyConfirmation','updatedAt'] loop
    if p_patch ? key then allowed=allowed||jsonb_build_object(key,p_patch->key); end if;
  end loop;
  for item in select value from jsonb_array_elements(coalesce(source->'orders','[]'::jsonb)) loop
    if item->>'id'=p_order_id then
      if not public.order_assigned_to_technician(item,tid) then raise exception 'Bu iş emri operatöre atanmış değil'; end if;
      if p_patch ? 'status' and p_patch->>'status'<>item->>'status' and not (
        (item->>'status'='Atandı' and p_patch->>'status'='Devam Ediyor') or
        (item->>'status'='Devam Ediyor' and p_patch->>'status' in ('Beklemede','Teyit Bekliyor')) or
        (item->>'status'='Beklemede' and p_patch->>'status'='Devam Ediyor')
      ) then raise exception 'İş emri durumu değişmiş; sayfayı yenileyin'; end if;
      if coalesce(item->>'startTime','')<>'' and coalesce(p_patch->>'startTime','')<>item->>'startTime' then raise exception 'Başlama saatini yalnızca yönetici düzeltebilir'; end if;
      if coalesce(item->>'completionTime','')<>'' and coalesce(p_patch->>'completionTime','')<>item->>'completionTime' then raise exception 'Bitiş saatini yalnızca yönetici düzeltebilir'; end if;
      if coalesce(item->>'pauseStart','')<>'' and coalesce(p_patch->>'pauseStart','')<>item->>'pauseStart' and not (item->>'status'='Devam Ediyor' and p_patch->>'status'='Beklemede') then raise exception 'Ara başlangıcını yalnızca yönetici düzeltebilir'; end if;
      if coalesce(item->>'pauseEnd','')<>'' and coalesce(p_patch->>'pauseEnd','')<>item->>'pauseEnd' and not (item->>'status'='Beklemede' and p_patch->>'status'='Devam Ediyor') then raise exception 'Ara bitişini yalnızca yönetici düzeltebilir'; end if;
      if p_patch->>'status'='Teyit Bekliyor' and coalesce(p_patch->>'hasDowntime','') not in ('true','false') then raise exception 'Duruş seçimi zorunludur'; end if;
      if p_patch ? 'managerCorrectionPending' and coalesce(p_patch->>'managerCorrectionPending','false')<>coalesce(item->>'managerCorrectionPending','false') and not (item->>'managerCorrectionPending'='true' and p_patch->>'managerCorrectionPending'='false' and p_patch->>'status'='Teyit Bekliyor') then raise exception 'Yönetici düzeltme durumu yalnızca iş sonucu gönderildiğinde temizlenebilir'; end if;
      patched=item||allowed;orders=orders||jsonb_build_array(patched);found=true;
    else orders=orders||jsonb_build_array(item);
    end if;
  end loop;
  if not found then raise exception 'İş emri bulunamadı'; end if;
  current_version=current_version+1;
  update public.app_snapshots set payload=jsonb_set(source,'{orders}',orders,true),version=current_version,updated_by=(select auth.uid()),updated_at=now() where id=p_id;
  insert into public.app_sync_events(id,version) values(p_id,current_version)
  on conflict(id) do update set version=excluded.version,updated_at=now();
  return current_version;
end;
$$;
