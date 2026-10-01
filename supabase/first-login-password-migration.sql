-- Mevcut Supabase projesinde bir kez, SQL Editor'de çalıştırın.
-- Mevcut kullanıcıları henüz zorlamaz; yeni arayüz ve Edge Function yayımlandıktan
-- sonra en alttaki isteğe bağlı UPDATE sorgusunu ayrıca çalıştırabilirsiniz.

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

drop policy if exists technicians_read on public.technicians;
create policy technicians_read on public.technicians for select to authenticated using (public.can_use_app() and (active or public.is_manager()));
drop policy if exists assets_read on public.assets;
create policy assets_read on public.assets for select to authenticated using (public.can_use_app());
drop policy if exists materials_read on public.materials;
create policy materials_read on public.materials for select to authenticated using (public.can_use_app() and (active or public.is_manager()));
drop policy if exists activities_insert on public.activities;
create policy activities_insert on public.activities for insert to authenticated with check (public.can_use_app() and actor_id=(select auth.uid()));
drop policy if exists failure_code_catalog_read on public.failure_code_catalog;
create policy failure_code_catalog_read on public.failure_code_catalog for select to authenticated using (public.can_use_app() and (active or public.is_manager()));

-- Daha önce geçici şifre verilmiş tüm aktif, Admin olmayan hesapları da
-- ilk girişte değişime zorlamak için, en son aşamada ayrıca çalıştırın:
-- update public.profiles
--    set must_change_password = true, updated_at = now()
--  where active and not is_admin;
