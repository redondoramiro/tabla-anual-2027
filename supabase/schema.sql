-- =====================================================================
-- Tabla Anual 2027 — esquema de base de datos para Supabase
--
-- Ejecutar UNA sola vez en un proyecto nuevo:
--   Supabase → SQL Editor → New query → pegar todo este archivo → Run
--
-- Toda la seguridad vive aquí (Row Level Security + triggers): aunque
-- alguien modifique el JavaScript de la página, la base de datos no le
-- deja saltarse las reglas.
-- =====================================================================


-- ---------------------------------------------------------------------
-- Configuración
-- ---------------------------------------------------------------------

-- Tiempo durante el que el autor puede editar o borrar su reclamo.
-- La votación se abre cuando termina este tiempo.
-- Si lo cambias, cambia también EDIT_MINUTES en js/config.js
create or replace function edit_window() returns interval
language sql immutable as $$ select interval '5 minutes' $$;


-- ---------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------

-- Un perfil por usuario (se crea solo, al crear el usuario en Auth)
create table profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  username     text not null unique,
  display_name text not null,
  is_admin     boolean not null default false,
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);

-- Catálogo de acontecimientos con su puntaje fijo (lo gestiona el admin)
create table events (
  id         bigint generated always as identity primary key,
  name       text not null unique,
  points     integer not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- Reclamos: "me pasó este acontecimiento, denme los puntos"
create table claims (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references profiles(id) on delete cascade,
  event_id    bigint not null references events(id),
  description text check (char_length(description) <= 500),
  points      integer not null default 0,   -- copia del puntaje del acontecimiento
  status      text not null default 'pendiente'
              check (status in ('pendiente', 'aceptado', 'rechazado')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  resolved_at timestamptz
);
create index claims_status_created_idx on claims (status, created_at desc);

-- Votos: uno por usuario y reclamo, no se pueden cambiar
create table votes (
  claim_id   bigint not null references claims(id) on delete cascade,
  voter_id   uuid not null default auth.uid() references profiles(id) on delete cascade,
  value      boolean not null,               -- true = Sí, false = No
  created_at timestamptz not null default now(),
  primary key (claim_id, voter_id)
);


-- ---------------------------------------------------------------------
-- Funciones de ayuda para las reglas de seguridad
-- ---------------------------------------------------------------------

create or replace function is_active() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active)
$$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and active and is_admin)
$$;


-- ---------------------------------------------------------------------
-- Crear el perfil automáticamente al crear un usuario
-- (desde la app de admin o desde Supabase → Authentication → Add user)
-- ---------------------------------------------------------------------

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


-- ---------------------------------------------------------------------
-- Protección de reclamos: el usuario no puede tocar el estado, el autor,
-- la fecha ni los puntos. Los puntos salen siempre del catálogo.
-- ---------------------------------------------------------------------

create or replace function claims_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  -- current_user = 'authenticated' cuando el cambio viene de la página web.
  -- Cuando viene de resolve_claim() es el dueño de la base y se permite.
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.user_id     := auth.uid();
      new.status      := 'pendiente';
      new.created_at  := now();
      new.resolved_at := null;
    else
      new.user_id     := old.user_id;
      new.status      := old.status;
      new.created_at  := old.created_at;
      new.resolved_at := old.resolved_at;
    end if;

    new.points := (select points from events where id = new.event_id and active);
    if new.points is null then
      raise exception 'Acontecimiento inválido o inactivo';
    end if;
  end if;

  new.updated_at := now();
  return new;
end $$;

create trigger claims_guard
  before insert or update on claims
  for each row execute function claims_guard();


-- ---------------------------------------------------------------------
-- Resolución de la votación
--
-- Votan todos los usuarios activos menos el autor.
--   Aceptado:  los "Sí" llegan a mayoría (con 4 votantes hacen falta 3).
--   Rechazado: ya es imposible llegar a esa mayoría (con 4 votantes,
--              2 "No" alcanzan; un empate 2-2 se rechaza).
-- Para cambiar la regla, edita solo esta función.
-- ---------------------------------------------------------------------

create or replace function resolve_claim(p_claim_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_claim    claims;
  v_eligible int;
  v_needed   int;
  v_yes      int;
  v_no       int;
begin
  select * into v_claim from claims where id = p_claim_id for update;
  if not found or v_claim.status <> 'pendiente' then
    return;
  end if;

  select count(*) into v_eligible
    from profiles where active and id <> v_claim.user_id;

  select count(*) filter (where v.value), count(*) filter (where not v.value)
    into v_yes, v_no
    from votes v join profiles p on p.id = v.voter_id and p.active
   where v.claim_id = p_claim_id;

  v_needed := v_eligible / 2 + 1;

  if v_yes >= v_needed then
    update claims set status = 'aceptado', resolved_at = now() where id = p_claim_id;
  elsif v_no > v_eligible - v_needed then
    update claims set status = 'rechazado', resolved_at = now() where id = p_claim_id;
  end if;
end $$;

revoke execute on function resolve_claim(bigint) from public, anon, authenticated;

-- Cada voto nuevo intenta resolver el reclamo
create or replace function votes_after_insert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform resolve_claim(new.claim_id);
  return null;
end $$;

create trigger votes_resolve
  after insert on votes
  for each row execute function votes_after_insert();

-- Si el admin activa/desactiva a alguien, cambia el número de votantes:
-- se revisan otra vez los reclamos pendientes
create or replace function profiles_after_active_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform resolve_claim(c.id) from claims c where c.status = 'pendiente';
  return null;
end $$;

create trigger profiles_reresolve
  after update of active on profiles
  for each row when (old.active is distinct from new.active)
  execute function profiles_after_active_change();


-- ---------------------------------------------------------------------
-- Vista de la tabla de puntos
-- ---------------------------------------------------------------------

create view leaderboard with (security_invoker = true) as
select p.id,
       p.username,
       p.display_name,
       coalesce(sum(c.points) filter (where c.status = 'aceptado'), 0)::int as points,
       count(c.id) filter (where c.status = 'aceptado')::int               as accepted,
       count(c.id) filter (where c.status = 'pendiente')::int              as pending
  from profiles p
  left join claims c on c.user_id = p.id
 where p.active
 group by p.id;


-- ---------------------------------------------------------------------
-- Row Level Security (quién puede leer / escribir qué)
-- ---------------------------------------------------------------------

alter table profiles enable row level security;
alter table events   enable row level security;
alter table claims   enable row level security;
alter table votes    enable row level security;

-- Perfiles: los ve cualquier usuario activo; solo el admin los edita
create policy "ver perfiles" on profiles for select to authenticated
  using (is_active() or id = auth.uid());
create policy "admin edita perfiles" on profiles for update to authenticated
  using (is_admin()) with check (is_admin());
-- Desde la web solo se pueden cambiar estas dos columnas
-- ("active" se cambia con la función admin-users)
revoke update on profiles from anon, authenticated;
grant update (display_name, is_admin) on profiles to authenticated;

-- Acontecimientos: los ve cualquiera; solo el admin crea y edita
create policy "ver acontecimientos" on events for select to authenticated
  using (is_active());
create policy "admin crea acontecimientos" on events for insert to authenticated
  with check (is_admin());
create policy "admin edita acontecimientos" on events for update to authenticated
  using (is_admin()) with check (is_admin());

-- Reclamos
create policy "ver reclamos" on claims for select to authenticated
  using (is_active());
create policy "crear reclamo propio" on claims for insert to authenticated
  with check (user_id = auth.uid() and is_active());
create policy "editar reclamo propio dentro del plazo" on claims for update to authenticated
  using (user_id = auth.uid() and status = 'pendiente' and now() < created_at + edit_window())
  with check (user_id = auth.uid());
create policy "borrar reclamo propio dentro del plazo o admin" on claims for delete to authenticated
  using ((user_id = auth.uid() and status = 'pendiente' and now() < created_at + edit_window())
         or is_admin());

-- Votos: se vota en reclamos ajenos, pendientes y fuera del plazo de edición
create policy "ver votos" on votes for select to authenticated
  using (is_active());
create policy "votar" on votes for insert to authenticated
  with check (
    voter_id = auth.uid()
    and is_active()
    and exists (
      select 1 from claims c
       where c.id = claim_id
         and c.status = 'pendiente'
         and c.user_id <> auth.uid()
         and now() >= c.created_at + edit_window()
    )
  );


-- ---------------------------------------------------------------------
-- Acontecimientos de ejemplo (edítalos desde la pantalla Admin)
-- ---------------------------------------------------------------------

insert into events (name, points) values
  ('Organizar una juntada', 10),
  ('Pagar una ronda', 8),
  ('Ganar un partido', 5),
  ('Llegar primero a la juntada', 3),
  ('Hacer un viaje con el grupo', 15);


-- ---------------------------------------------------------------------
-- DESPUÉS de crear tu usuario en Authentication → Users → Add user,
-- conviértelo en admin ejecutando esta línea (sin los dos guiones):
--
-- update profiles set is_admin = true where username = 'ramiroredondo';
-- ---------------------------------------------------------------------
