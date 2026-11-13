-- =====================================================================
-- Tabla Anual 2027 — PARTE 1: usuarios y permisos básicos
--
-- Proyecto nuevo: ejecuta este archivo y después 02-app.sql
--   (Supabase → SQL Editor → New query → pegar → Run)
-- Tu proyecto actual ya tiene esta parte: no hace falta volver a ejecutarla.
-- =====================================================================


-- Tiempo durante el que el remitente puede editar o borrar un acontecimiento.
-- Si lo cambias, cambia también EDIT_MINUTES en js/config.js
create or replace function edit_window() returns interval
language sql immutable as $$ select interval '5 minutes' $$;


-- Un perfil por usuario (se crea solo, al crear el usuario en Auth)
create table profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  username     text not null unique,
  display_name text not null,
  is_admin     boolean not null default false,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);


-- Funciones de ayuda para las reglas de seguridad
create or replace function is_active() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active)
$$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active and is_admin)
$$;


-- Crear el perfil automáticamente al crear un usuario
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_username text := lower(coalesce(new.raw_user_meta_data->>'username',
                                    split_part(new.email, '@', 1)));
begin
  insert into profiles (id, username, display_name)
  values (new.id, v_username,
          coalesce(nullif(new.raw_user_meta_data->>'display_name', ''), v_username));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();


-- Reglas de acceso a perfiles
alter table profiles enable row level security;

create policy "ver perfiles" on profiles for select to authenticated
  using (is_active() or id = auth.uid());
create policy "admin edita perfiles" on profiles for update to authenticated
  using (is_admin()) with check (is_admin());

-- Desde la web solo se pueden cambiar estas dos columnas
-- ("active" se cambia con la función admin-users)
revoke update on profiles from anon, authenticated;
grant update (display_name, is_admin) on profiles to authenticated;


-- ---------------------------------------------------------------------
-- DESPUÉS de crear tu usuario en Authentication → Users → Add user,
-- ejecuta esto para confirmarlo y hacerlo admin:
--
-- update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now())
--  where email = 'ramiroredondo@tablaanual2027.app';
-- insert into profiles (id, username, display_name, is_admin)
-- select id, 'ramiroredondo', 'Ramiro', true from auth.users
--  where email = 'ramiroredondo@tablaanual2027.app'
-- on conflict (id) do update set is_admin = true;
-- ---------------------------------------------------------------------
