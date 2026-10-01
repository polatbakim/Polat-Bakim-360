-- Polat Bakım 360 - Supabase altyapısı
-- Supabase Dashboard > SQL Editor bölümünde bir kez çalıştırın.
-- Tarayıcıda yalnızca publishable/anon key kullanın; service_role kullanmayın.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  role text not null default 'operator' check (role in ('manager','operator')),
  technician_id text unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists manager_access boolean not null default false;
alter table public.profiles add column if not exists operator_access boolean not null default false;
alter table public.profiles add column if not exists is_admin boolean not null default false;
alter table public.profiles add column if not exists specialty text not null default '';
alter table public.profiles add column if not exists phone text not null default '';
alter table public.profiles add column if not exists hourly_rate numeric not null default 0;
alter table public.profiles add column if not exists visible_pages jsonb not null default '[]'::jsonb;
alter table public.profiles add column if not exists delete_permissions jsonb not null default '{}'::jsonb;
alter table public.profiles add column if not exists must_change_password boolean not null default false;

create or replace function public.can_use_app()
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.profiles where id=(select auth.uid()) and active and not must_change_password) $$;

create or replace function public.is_admin_manager()
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.profiles where id=(select auth.uid()) and manager_access and is_admin and active and not must_change_password) $$;

create or replace function public.is_manager()
returns boolean language sql stable security definer set search_path=public
as $$ select exists(select 1 from public.profiles where id=(select auth.uid()) and manager_access and active and not must_change_password) $$;

create or replace function public.current_technician_id()
returns text language sql stable security definer set search_path=public
as $$ select technician_id from public.profiles where id=(select auth.uid()) and operator_access and active and not must_change_password $$;

create or replace function public.create_profile_for_new_user()
returns trigger language plpgsql security definer set search_path=public
as $$
begin
  insert into public.profiles(id,full_name,role)
  values(new.id,coalesce(new.raw_user_meta_data->>'full_name',''),'operator')
  on conflict(id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute function public.create_profile_for_new_user();

-- Mevcut localStorage veri modelinin güvenli geçiş katmanı.
-- Bu tabloya yalnızca yönetici erişir; operatörler maliyet içeren JSON verisini göremez.
create table if not exists public.app_snapshots (
  id text primary key,
  payload jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

-- Büyük JSON paketi Realtime kanalına taşınmaz; küçük sürüm olayı yayınlanır.
create table if not exists public.app_sync_events (
  id text primary key references public.app_snapshots(id) on delete cascade,
  version bigint not null,
  updated_at timestamptz not null default now()
);

create or replace function public.save_app_snapshot(p_id text,p_payload jsonb,p_expected_version bigint default 0)
returns bigint language plpgsql security definer set search_path=public
as $$
declare current_version bigint; next_version bigint;
begin
  if not public.is_manager() then raise exception 'Yönetici yetkisi gerekli'; end if;
  select version into current_version from public.app_snapshots where id=p_id for update;
  if current_version is null then
    if coalesce(p_expected_version,0)<>0 then raise exception 'SNAPSHOT_CONFLICT'; end if;
    insert into public.app_snapshots(id,payload,version,updated_by)
    values(p_id,p_payload,1,(select auth.uid()));
    insert into public.app_sync_events(id,version) values(p_id,1)
    on conflict(id) do update set version=excluded.version,updated_at=now();
    return 1;
  end if;
  if current_version<>p_expected_version then raise exception 'SNAPSHOT_CONFLICT'; end if;
  next_version=current_version+1;
  update public.app_snapshots set payload=p_payload,version=next_version,updated_by=(select auth.uid()),updated_at=now() where id=p_id;
  insert into public.app_sync_events(id,version) values(p_id,next_version)
  on conflict(id) do update set version=excluded.version,updated_at=now();
  return next_version;
end;
$$;

-- Bir iş emri ana sorumluya, ek personele veya işçilik satırındaki personele atanmış olabilir.
create or replace function public.order_assigned_to_technician(p_order jsonb,p_tid text)
returns boolean language sql immutable set search_path=public
as $$
  select coalesce(p_order->>'technicianId','')=p_tid
  or exists (
    select 1 from jsonb_array_elements(case when jsonb_typeof(p_order->'additionalTechnicians')='array' then p_order->'additionalTechnicians' else '[]'::jsonb end) as elem(value)
    where elem.value #>> '{}' = p_tid or elem.value->>'technicianId'=p_tid or elem.value->>'id'=p_tid
  )
  or exists (
    select 1 from jsonb_array_elements(case when jsonb_typeof(p_order->'laborEntries')='array' then p_order->'laborEntries' else '[]'::jsonb end) as elem(value)
    where elem.value->>'technicianId'=p_tid
  )
  or exists (
    select 1 from jsonb_array_elements(case when jsonb_typeof(p_order->'shiftEntries')='array' then p_order->'shiftEntries' else '[]'::jsonb end) as elem(value)
    where elem.value->>'technicianId'=p_tid
  )
$$;

-- Operatöre yalnızca kendi işleri ve maliyetsiz alanlar gönderilir.
create or replace function public.get_operator_snapshot(p_id text)
returns jsonb language plpgsql stable security definer set search_path=public
as $$
declare source jsonb; result jsonb; item jsonb; clean jsonb; orders jsonb='[]'::jsonb; people jsonb='[]'::jsonb; stock jsonb='[]'::jsonb; nested jsonb; tid text;
begin
  tid=public.current_technician_id();
  if tid is null then raise exception 'Operatör profili personelle eşleştirilmemiş'; end if;
  select payload into source from public.app_snapshots where id=p_id;
  if source is null then return null; end if;
  for item in select value from jsonb_array_elements(coalesce(source->'orders','[]'::jsonb)) loop
    if public.order_assigned_to_technician(item,tid) then
      clean=item-array['laborCost','materialCost','serviceCost','otherCost','totalCost','approvedLaborCost','approvedMaterialCost','managerCostApproval','purchaseOrderNo'];
      if jsonb_typeof(clean->'purchasedMaterials')='array' then
        select coalesce(jsonb_agg(value-array['unitPrice','cost','total','totalCost','approvedCost']),'[]'::jsonb) into nested from jsonb_array_elements(clean->'purchasedMaterials');
        clean=jsonb_set(clean,'{purchasedMaterials}',nested,true);
      end if;
      if jsonb_typeof(clean->'laborEntries')='array' then
        select coalesce(jsonb_agg(value-array['hourlyRate','total','cost']),'[]'::jsonb) into nested from jsonb_array_elements(clean->'laborEntries');
        clean=jsonb_set(clean,'{laborEntries}',nested,true);
      end if;
      if jsonb_typeof(clean->'events')='array' then
        select coalesce(jsonb_agg(value-array['metadata']),'[]'::jsonb) into nested from jsonb_array_elements(clean->'events');
        clean=jsonb_set(clean,'{events}',nested,true);
      end if;
      orders=orders||jsonb_build_array(clean);
    end if;
  end loop;
  for item in select value from jsonb_array_elements(coalesce(source->'technicians','[]'::jsonb)) loop
    people=people||jsonb_build_array(item-array['passwordHash','hourlyRate','email','phone','accountId']);
  end loop;
  for item in select value from jsonb_array_elements(coalesce(source->'materials','[]'::jsonb)) loop
    stock=stock||jsonb_build_array(item-array['unitPrice','supplier','invoiceNo','cost']);
  end loop;
  result=source-array['activities','assetContracts','monthlyCapacity','approvers','budgetPlans','purchaseRecords','costImports'];
  result=jsonb_set(result,'{orders}',orders,true);
  result=jsonb_set(result,'{technicians}',people,true);
  result=jsonb_set(result,'{materials}',stock,true);
  return result;
end;
$$;

-- Operatör yalnızca izin verilen saha alanlarını güncelleyebilir.
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

-- Normalize edilmiş üretim tabloları. Operatör maliyet tablolarına erişemez.
create table if not exists public.technicians (
  id text primary key,
  auth_user_id uuid unique references auth.users(id) on delete set null,
  name text not null,
  role_name text not null default '',
  phone text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.assets (
  id text primary key,
  code text not null unique,
  name text not null,
  category text not null default 'Makine',
  location text not null default '',
  status text not null default 'Çalışıyor',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.work_orders (
  id text primary key,
  asset_id text references public.assets(id) on delete set null,
  technician_id text references public.technicians(id) on delete set null,
  title text not null,
  description text not null default '',
  maintenance_type text not null default '',
  maintenance_branch text not null default '',
  priority text not null default 'Orta',
  status text not null default 'Bekliyor',
  due_date date,
  started_at timestamptz,
  completed_at timestamptz,
  pause_started_at timestamptz,
  pause_ended_at timestamptz,
  pause_minutes integer not null default 0 check (pause_minutes>=0),
  operator_result jsonb not null default '{}'::jsonb,
  manager_approved_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- SAP bağlantısı için kalıcı eşleştirme alanları. API bağlantısı kurulduğunda
-- bildirim ve satın alma siparişi bu alanlar üzerinden çift yönlü eşitlenir.
alter table public.work_orders add column if not exists notification_status text not null default 'Yok';
alter table public.work_orders add column if not exists notification_no text not null default '';
alter table public.work_orders add column if not exists purchase_order_no text not null default '';
alter table public.work_orders add column if not exists sap_sync_status text not null default 'Yerel';
alter table public.work_orders add column if not exists sap_last_synced_at timestamptz;
alter table public.work_orders add column if not exists sap_external_updated_at timestamptz;
create index if not exists work_orders_notification_no_idx on public.work_orders(notification_no) where notification_no<>'';
create index if not exists work_orders_purchase_order_no_idx on public.work_orders(purchase_order_no) where purchase_order_no<>'';
create index if not exists work_orders_sap_sync_status_idx on public.work_orders(sap_sync_status);

create table if not exists public.work_order_costs (
  work_order_id text primary key references public.work_orders(id) on delete cascade,
  labor_cost numeric(14,2) not null default 0 check (labor_cost>=0),
  material_cost numeric(14,2) not null default 0 check (material_cost>=0),
  service_cost numeric(14,2) not null default 0 check (service_cost>=0),
  other_cost numeric(14,2) not null default 0 check (other_cost>=0),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.materials (
  id text primary key,
  code text not null unique,
  name text not null,
  unit text not null default 'Adet',
  warehouse text not null default '',
  stock numeric(14,3) not null default 0,
  min_stock numeric(14,3) not null default 0,
  active boolean not null default true,
  updated_at timestamptz not null default now()
);

create table if not exists public.material_costs (
  material_id text primary key references public.materials(id) on delete cascade,
  unit_cost numeric(14,2) not null default 0 check (unit_cost>=0),
  supplier text not null default '',
  invoice_no text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.work_order_materials (
  id bigint generated always as identity primary key,
  work_order_id text not null references public.work_orders(id) on delete cascade,
  material_id text references public.materials(id) on delete set null,
  material_name text not null,
  quantity numeric(14,3) not null check (quantity>0),
  unit text not null default 'Adet',
  note text not null default '',
  entered_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.work_order_material_costs (
  work_order_material_id bigint primary key references public.work_order_materials(id) on delete cascade,
  unit_cost numeric(14,2) not null default 0 check (unit_cost>=0),
  approved_by uuid references auth.users(id),
  approved_at timestamptz
);

alter table public.work_order_material_costs add column if not exists purchase_order_no text not null default '';

create table if not exists public.activities (
  id bigint generated always as identity primary key,
  work_order_id text references public.work_orders(id) on delete cascade,
  actor_id uuid references auth.users(id),
  action text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Değiştirilemeyen iş emri olay günlüğü. Her durum geçişi yeni satırdır.
create table if not exists public.work_order_events (
  id text primary key,
  work_order_id text not null references public.work_orders(id) on delete restrict,
  asset_id text references public.assets(id) on delete set null,
  event_type text not null,
  title text not null,
  detail text not null default '',
  status_from text not null default '',
  status_to text not null default '',
  actor_id uuid references auth.users(id),
  actor_name text not null default '',
  actor_role text not null default '',
  source text not null default 'web',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.failure_code_catalog (
  code text primary key,
  stage text not null check(stage in ('symptom','electricalFault','electricalCause','mechanicalFault','mechanicalCause','correctiveAction')),
  label text not null,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.work_order_failure_codes (
  work_order_id text not null references public.work_orders(id) on delete cascade,
  code text not null references public.failure_code_catalog(code),
  entered_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  primary key(work_order_id,code)
);

create index if not exists work_orders_technician_status_idx on public.work_orders(technician_id,status);
create index if not exists work_orders_asset_idx on public.work_orders(asset_id);
create index if not exists work_orders_due_date_idx on public.work_orders(due_date);
create index if not exists work_order_materials_order_idx on public.work_order_materials(work_order_id);
create index if not exists activities_order_time_idx on public.activities(work_order_id,created_at desc);
create index if not exists work_order_events_order_time_idx on public.work_order_events(work_order_id,created_at desc);
create index if not exists work_order_events_asset_time_idx on public.work_order_events(asset_id,created_at desc);
create index if not exists failure_code_catalog_stage_idx on public.failure_code_catalog(stage,sort_order,label);

alter table public.profiles enable row level security;
alter table public.app_snapshots enable row level security;
alter table public.app_sync_events enable row level security;
alter table public.technicians enable row level security;
alter table public.assets enable row level security;
alter table public.work_orders enable row level security;
alter table public.work_order_costs enable row level security;
alter table public.materials enable row level security;
alter table public.material_costs enable row level security;
alter table public.work_order_materials enable row level security;
alter table public.work_order_material_costs enable row level security;
alter table public.activities enable row level security;
alter table public.work_order_events enable row level security;
alter table public.failure_code_catalog enable row level security;
alter table public.work_order_failure_codes enable row level security;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (id=(select auth.uid()) or public.is_manager());
drop policy if exists profiles_manager_write on public.profiles;
-- Profil değişiklikleri yalnızca Admin Edge Function üzerinden yapılır.

drop policy if exists snapshots_manager_only on public.app_snapshots;
create policy snapshots_manager_only on public.app_snapshots for all to authenticated using (public.is_manager()) with check (public.is_manager());
drop policy if exists sync_events_read on public.app_sync_events;
create policy sync_events_read on public.app_sync_events for select to authenticated using (public.is_manager() or public.current_technician_id() is not null);
drop policy if exists sync_events_manager_write on public.app_sync_events;
create policy sync_events_manager_write on public.app_sync_events for all to authenticated using (public.is_manager()) with check (public.is_manager());

drop policy if exists technicians_read on public.technicians;
create policy technicians_read on public.technicians for select to authenticated using (public.can_use_app() and (active or public.is_manager()));
drop policy if exists technicians_manager_write on public.technicians;
create policy technicians_manager_write on public.technicians for all to authenticated using (public.is_manager()) with check (public.is_manager());

drop policy if exists assets_read on public.assets;
create policy assets_read on public.assets for select to authenticated using (public.can_use_app());
drop policy if exists assets_manager_write on public.assets;
create policy assets_manager_write on public.assets for all to authenticated using (public.is_manager()) with check (public.is_manager());

drop policy if exists work_orders_read on public.work_orders;
create policy work_orders_read on public.work_orders for select to authenticated using (public.is_manager() or technician_id=public.current_technician_id());
drop policy if exists work_orders_manager_write on public.work_orders;
create policy work_orders_manager_write on public.work_orders for all to authenticated using (public.is_manager()) with check (public.is_manager());

drop policy if exists work_order_costs_manager_only on public.work_order_costs;
create policy work_order_costs_manager_only on public.work_order_costs for all to authenticated using (public.is_manager()) with check (public.is_manager());
drop policy if exists material_costs_manager_only on public.material_costs;
create policy material_costs_manager_only on public.material_costs for all to authenticated using (public.is_manager()) with check (public.is_manager());
drop policy if exists work_order_material_costs_manager_only on public.work_order_material_costs;
create policy work_order_material_costs_manager_only on public.work_order_material_costs for all to authenticated using (public.is_manager()) with check (public.is_manager());

drop policy if exists materials_read on public.materials;
create policy materials_read on public.materials for select to authenticated using (public.can_use_app() and (active or public.is_manager()));
drop policy if exists materials_manager_write on public.materials;
create policy materials_manager_write on public.materials for all to authenticated using (public.is_manager()) with check (public.is_manager());

drop policy if exists work_order_materials_read on public.work_order_materials;
create policy work_order_materials_read on public.work_order_materials for select to authenticated using (public.is_manager() or exists(select 1 from public.work_orders w where w.id=work_order_id and w.technician_id=public.current_technician_id()));
drop policy if exists work_order_materials_insert on public.work_order_materials;
create policy work_order_materials_insert on public.work_order_materials for insert to authenticated with check (public.is_manager() or exists(select 1 from public.work_orders w where w.id=work_order_id and w.technician_id=public.current_technician_id()));

drop policy if exists activities_read on public.activities;
create policy activities_read on public.activities for select to authenticated using (public.is_manager() or exists(select 1 from public.work_orders w where w.id=work_order_id and w.technician_id=public.current_technician_id()));
drop policy if exists activities_insert on public.activities;
create policy activities_insert on public.activities for insert to authenticated with check (public.can_use_app() and actor_id=(select auth.uid()));

drop policy if exists work_order_events_read on public.work_order_events;
create policy work_order_events_read on public.work_order_events for select to authenticated using (public.is_manager() or exists(select 1 from public.work_orders w where w.id=work_order_id and w.technician_id=public.current_technician_id()));
drop policy if exists work_order_events_insert on public.work_order_events;
create policy work_order_events_insert on public.work_order_events for insert to authenticated with check (public.is_manager() or (actor_id=(select auth.uid()) and exists(select 1 from public.work_orders w where w.id=work_order_id and w.technician_id=public.current_technician_id())));

drop policy if exists failure_code_catalog_read on public.failure_code_catalog;
create policy failure_code_catalog_read on public.failure_code_catalog for select to authenticated using (public.can_use_app() and (active or public.is_manager()));
drop policy if exists failure_code_catalog_manager_write on public.failure_code_catalog;
create policy failure_code_catalog_manager_write on public.failure_code_catalog for all to authenticated using (public.is_manager()) with check (public.is_manager());

drop policy if exists work_order_failure_codes_read on public.work_order_failure_codes;
create policy work_order_failure_codes_read on public.work_order_failure_codes for select to authenticated using (public.is_manager() or exists(select 1 from public.work_orders w where w.id=work_order_id and w.technician_id=public.current_technician_id()));
drop policy if exists work_order_failure_codes_insert on public.work_order_failure_codes;
create policy work_order_failure_codes_insert on public.work_order_failure_codes for insert to authenticated with check (public.is_manager() or exists(select 1 from public.work_orders w where w.id=work_order_id and w.technician_id=public.current_technician_id()));

grant usage on schema public to authenticated;
revoke insert,update,delete on public.profiles from authenticated;
grant select on public.profiles to authenticated;
grant select,insert,update,delete on public.technicians,public.assets,public.work_orders,public.work_order_costs,public.materials,public.material_costs,public.work_order_materials,public.work_order_material_costs,public.app_snapshots,public.app_sync_events to authenticated;
grant select,insert on public.activities,public.work_order_events,public.work_order_failure_codes to authenticated;
grant select,insert,update,delete on public.failure_code_catalog to authenticated;
revoke update,delete on public.activities,public.work_order_events from authenticated;
grant execute on function public.save_app_snapshot(text,jsonb,bigint) to authenticated;
grant execute on function public.get_operator_snapshot(text) to authenticated;
grant execute on function public.update_operator_order(text,text,jsonb) to authenticated;
revoke execute on function public.save_app_snapshot(text,jsonb,bigint) from public,anon;
revoke execute on function public.get_operator_snapshot(text) from public,anon;
revoke execute on function public.update_operator_order(text,text,jsonb) from public,anon;
revoke all on public.app_snapshots,public.app_sync_events,public.work_order_costs,public.material_costs,public.work_order_material_costs from anon;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('maintenance-attachments','maintenance-attachments',false,31457280,array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict(id) do update set public=false,file_size_limit=31457280,allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists maintenance_attachments_manager_all on storage.objects;
create policy maintenance_attachments_manager_all on storage.objects for all to authenticated
using(bucket_id='maintenance-attachments' and public.is_manager())
with check(bucket_id='maintenance-attachments' and public.is_manager());

do $$
begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='app_sync_events') then
    alter publication supabase_realtime add table public.app_sync_events;
  end if;
end $$;
