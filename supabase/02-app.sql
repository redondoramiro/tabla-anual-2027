-- =====================================================================
-- Tabla Anual 2027 — PARTE 2: acontecimientos, votos y reclamos
--
-- ⚠️ NO lo vuelvas a ejecutar en un proyecto que ya tiene datos.
--    Las mejoras futuras van en archivos nuevos (03-..., 04-...).
--
-- Ejecuta este archivo UNA vez (Supabase → SQL Editor → New query → Run).
-- Si tu proyecto tenía la versión anterior (reclamos con votación),
-- la sección 0 la borra. Los usuarios NO se tocan.
--
-- Toda la seguridad vive aquí: aunque alguien modifique el JavaScript de
-- la página, la base de datos no le deja saltarse estas reglas.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. Quitar la versión anterior (si existe)
-- ---------------------------------------------------------------------
drop function if exists profiles_after_active_change() cascade;
drop function if exists votes_after_insert() cascade;
drop function if exists resolve_claim(bigint) cascade;
drop function if exists claims_guard() cascade;
drop view if exists leaderboard;
drop table if exists votes, claims, events cascade;


-- ---------------------------------------------------------------------
-- 1. Configuración
-- ---------------------------------------------------------------------

-- Tiempo que dura la votación de cada acontecimiento.
-- Si lo cambias, afecta solo a los acontecimientos nuevos.
create or replace function voting_window() returns interval
language sql immutable as $$ select interval '24 hours' $$;


-- ---------------------------------------------------------------------
-- 2. Tablas
-- ---------------------------------------------------------------------

-- Las 4 categorías con su puntaje (el admin puede cambiar nombre y puntos)
create table categories (
  id     text primary key,
  name   text not null,
  points integer not null,
  sort   integer not null default 0
);

insert into categories (id, name, points, sort) values
  ('basico',     'Novio nivel básico',      25, 1),
  ('intermedio', 'Novio nivel intermedio',  50, 2),
  ('avanzado',   'Novio nivel avanzado',    75, 3),
  ('extremo',    'Novio nivel extremo',    100, 4);

-- Acontecimientos: "De" un usuario "Para" otro, con categoría y comentario
create table happenings (
  id          bigint generated always as identity primary key,
  from_user   uuid not null default auth.uid() references profiles(id) on delete cascade,
  to_user     uuid not null references profiles(id) on delete cascade,
  category_id text not null references categories(id),
  points      integer not null default 0,     -- copia del puntaje de la categoría
  comment     text not null check (char_length(comment) between 1 and 1000),
  defense     text check (char_length(defense) <= 1000),   -- descargo del destinatario
  defense_at  timestamptz,
  status      text not null default 'abierto'
              check (status in ('abierto', 'aceptado', 'rechazado')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  closes_at   timestamptz not null default now() + interval '24 hours',
  closed_at   timestamptz,
  closed_by   uuid references profiles(id) on delete set null,  -- admin que lo cerró antes
  check (from_user <> to_user)
);
create index happenings_created_idx on happenings (created_at desc);

-- Votos: like (true) o no like (false). Se pueden cambiar mientras esté abierto.
create table happening_votes (
  happening_id bigint not null references happenings(id) on delete cascade,
  voter_id     uuid not null default auth.uid() references profiles(id) on delete cascade,
  value        boolean not null,
  primary key (happening_id, voter_id)
);

-- Reclamos generales sobre el sistema (los responde el admin)
create table complaints (
  id          bigint generated always as identity primary key,
  user_id     uuid not null default auth.uid() references profiles(id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 1000),
  status      text not null default 'abierto' check (status in ('abierto', 'resuelto')),
  response    text check (char_length(response) <= 1000),
  created_at  timestamptz not null default now(),
  resolved_at timestamptz
);


-- ---------------------------------------------------------------------
-- 3. Protección de acontecimientos
--   - El remitente puede cambiar destinatario, categoría y comentario
--     durante edit_window() (5 minutos).
--   - El destinatario puede escribir o cambiar su descargo mientras esté abierto.
--   - Nadie puede tocar desde la web el estado, las fechas ni los puntos.
-- ---------------------------------------------------------------------

create or replace function happenings_guard() returns trigger
language plpgsql set search_path = public as $$
declare
  v_can_edit   boolean := false;
  v_can_defend boolean := false;
begin
  -- Cambios hechos por funciones internas (cierre, admin): se permiten
  if current_user not in ('authenticated', 'anon') then
    new.updated_at := now();
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_can_edit      := true;
    new.from_user   := auth.uid();
    new.status      := 'abierto';
    new.created_at  := now();
    new.closes_at   := now() + voting_window();
    new.defense     := null;
    new.defense_at  := null;
    new.closed_at   := null;
    new.closed_by   := null;
  else
    v_can_edit := auth.uid() = old.from_user and old.status = 'abierto'
                  and now() < old.created_at + edit_window();
    v_can_defend := auth.uid() = old.to_user and old.status = 'abierto'
                    and now() < old.closes_at;

    if not v_can_edit then
      new.to_user     := old.to_user;
      new.category_id := old.category_id;
      new.comment     := old.comment;
    end if;

    if v_can_defend then
      new.defense    := nullif(trim(new.defense), '');
      new.defense_at := case when new.defense is distinct from old.defense
                             then now() else old.defense_at end;
    else
      new.defense    := old.defense;
      new.defense_at := old.defense_at;
    end if;

    new.from_user  := old.from_user;
    new.status     := old.status;
    new.created_at := old.created_at;
    new.closes_at  := old.closes_at;
    new.closed_at  := old.closed_at;
    new.closed_by  := old.closed_by;
  end if;

  if v_can_edit then
    if new.to_user = new.from_user then
      raise exception 'No puedes cargarte un acontecimiento a ti mismo';
    end if;
    if not exists (select 1 from profiles where id = new.to_user and active) then
      raise exception 'El destinatario no está activo';
    end if;
    new.points := (select points from categories where id = new.category_id);
    if new.points is null then
      raise exception 'Categoría inválida';
    end if;
  else
    new.points := old.points;
  end if;

  new.updated_at := now();
  return new;
end $$;

create trigger happenings_guard
  before insert or update on happenings
  for each row execute function happenings_guard();


-- ¿Puede el usuario actual votar este acontecimiento?
-- Abierto, dentro de las 24 h, y no siendo el destinatario.
create or replace function can_vote(p_happening_id bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select is_active() and exists (
    select 1 from happenings h
     where h.id = p_happening_id
       and h.status = 'abierto'
       and now() < h.closes_at
       and h.to_user <> auth.uid()
  )
$$;


-- ---------------------------------------------------------------------
-- 4. Cierre de votaciones
--
-- Al pasar las 24 h: ACEPTADO si hay más likes que no likes entre los
-- votos emitidos; si no (empate o sin votos), RECHAZADO.
-- La página llama a esta función cada vez que se abre la tabla o el
-- historial, así que los puntos se suman solos.
-- Para cambiar la regla, edita solo esta función.
-- ---------------------------------------------------------------------

create or replace function close_due_happenings() returns void
language plpgsql security definer set search_path = public as $$
begin
  update happenings h
     set status    = case when s.likes > s.dislikes then 'aceptado' else 'rechazado' end,
         closed_at = now()
    from (
      select h2.id,
             count(v.voter_id) filter (where v.value)     as likes,
             count(v.voter_id) filter (where not v.value) as dislikes
        from happenings h2
        left join (happening_votes v
                   join profiles p on p.id = v.voter_id and p.active)
               on v.happening_id = h2.id
       where h2.status = 'abierto'
         and h2.closes_at <= now()
       group by h2.id
    ) s
   where h.id = s.id;
end $$;

revoke execute on function close_due_happenings() from public, anon;
grant execute on function close_due_happenings() to authenticated;

-- El admin puede aprobar o rechazar antes de las 24 h
create or replace function admin_close_happening(p_id bigint, p_accept boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then
    raise exception 'Solo el admin puede cerrar acontecimientos';
  end if;

  update happenings
     set status    = case when p_accept then 'aceptado' else 'rechazado' end,
         closed_at = now(),
         closed_by = auth.uid()
   where id = p_id and status = 'abierto';

  if not found then
    raise exception 'El acontecimiento ya está cerrado';
  end if;
end $$;

revoke execute on function admin_close_happening(bigint, boolean) from public, anon;
grant execute on function admin_close_happening(bigint, boolean) to authenticated;


-- ---------------------------------------------------------------------
-- 5. Protección de reclamos generales
-- ---------------------------------------------------------------------

create or replace function complaints_guard() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.user_id     := auth.uid();
      new.status      := 'abierto';
      new.response    := null;
      new.resolved_at := null;
      new.created_at  := now();
    else
      -- Solo el admin llega aquí (ver reglas); no puede cambiar autor ni texto
      new.user_id     := old.user_id;
      new.body        := old.body;
      new.created_at  := old.created_at;
      new.resolved_at := case
        when new.status = 'resuelto' and old.status <> 'resuelto' then now()
        when new.status = 'abierto' then null
        else old.resolved_at end;
    end if;
  end if;
  return new;
end $$;

create trigger complaints_guard
  before insert or update on complaints
  for each row execute function complaints_guard();


-- ---------------------------------------------------------------------
-- 6. Tabla de puntos: suma de los acontecimientos ACEPTADOS recibidos
-- ---------------------------------------------------------------------

create view leaderboard with (security_invoker = true) as
select p.id,
       p.username,
       p.display_name,
       coalesce(sum(h.points) filter (where h.status = 'aceptado'), 0)::int as points,
       count(h.id) filter (where h.status = 'aceptado')::int               as accepted,
       count(h.id) filter (where h.status = 'abierto')::int                as pending
  from profiles p
  left join happenings h on h.to_user = p.id
 where p.active
 group by p.id;


-- ---------------------------------------------------------------------
-- 7. Row Level Security (quién puede leer / escribir qué)
-- ---------------------------------------------------------------------

alter table categories      enable row level security;
alter table happenings      enable row level security;
alter table happening_votes enable row level security;
alter table complaints      enable row level security;

-- Categorías: las ve cualquiera; solo el admin cambia nombre y puntos
create policy "ver categorias" on categories for select to authenticated
  using (is_active());
create policy "admin edita categorias" on categories for update to authenticated
  using (is_admin()) with check (is_admin());
revoke insert, update, delete on categories from anon, authenticated;
grant update (name, points) on categories to authenticated;

-- Acontecimientos
create policy "ver acontecimientos" on happenings for select to authenticated
  using (is_active());
create policy "crear acontecimiento" on happenings for insert to authenticated
  with check (from_user = auth.uid() and is_active());
create policy "editar (remitente) o descargo (destinatario)" on happenings for update to authenticated
  using (status = 'abierto' and is_active()
         and (from_user = auth.uid() or to_user = auth.uid()))
  with check (is_active());
create policy "borrar propio dentro del plazo o admin" on happenings for delete to authenticated
  using ((from_user = auth.uid() and status = 'abierto' and now() < created_at + edit_window())
         or is_admin());

-- Votos: cada uno solo crea, cambia o quita SU voto, y solo si can_vote()
create policy "ver votos" on happening_votes for select to authenticated
  using (is_active());
create policy "votar" on happening_votes for insert to authenticated
  with check (voter_id = auth.uid() and can_vote(happening_id));
create policy "cambiar voto" on happening_votes for update to authenticated
  using (voter_id = auth.uid() and can_vote(happening_id))
  with check (voter_id = auth.uid() and can_vote(happening_id));
create policy "quitar voto" on happening_votes for delete to authenticated
  using (voter_id = auth.uid() and can_vote(happening_id));

-- Reclamos generales
create policy "ver reclamos" on complaints for select to authenticated
  using (is_active());
create policy "crear reclamo" on complaints for insert to authenticated
  with check (user_id = auth.uid() and is_active());
create policy "admin responde reclamos" on complaints for update to authenticated
  using (is_admin()) with check (is_admin());
create policy "borrar reclamo propio abierto o admin" on complaints for delete to authenticated
  using ((user_id = auth.uid() and status = 'abierto') or is_admin());
