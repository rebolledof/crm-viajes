-- SPEC-004 parte 1 · Cotizador: cotizaciones, versiones inmutables, ítems con coste y venta,
-- catálogo simple y ajustes. Migración aditiva: solo crea tipos, tablas, funciones y triggers.
--
-- Reglas que la base garantiza aunque alguien salte la aplicación:
--   * Cada tabla lleva agency_id, RLS y claves compuestas (agency_id, id) hacia su padre.
--   * Número de cotización consecutivo por agencia, sin repetirse (RF-411).
--   * Una versión que no está en Borrador no cambia nunca: ni sus datos ni sus ítems (RF-405).
--   * El total de cada ítem lo calcula la base con decimales exactos y la regla de redondeo de la
--     versión (RF-401); lo que mande el cliente en esas columnas se ignora.
--   * Coste, utilidad, margen y tipo de cambio solo los leen administrador y asesor (RF-406): las
--     tablas quote_items y quote_version_costs no se le muestran a Lectura, que usa
--     app.quote_items_for_client.

create type public.quote_status as enum ('borrador', 'enviada', 'sustituida', 'aceptada', 'rechazada');
create type public.quote_unit as enum ('persona', 'noche', 'habitacion', 'servicio');

-- Ajustes del cotizador por agencia. Sin fila, valen los valores por defecto.
create table public.quote_settings (
  agency_id uuid primary key references public.agencies (id) on delete cascade,
  min_margin_pct numeric(5, 2) not null default 10 check (min_margin_pct between 0 and 90),
  validity_days integer not null default 5 check (validity_days between 1 and 90),
  default_includes text check (default_includes is null or length(default_includes) <= 4000),
  default_excludes text check (default_excludes is null or length(default_excludes) <= 4000),
  default_payment_terms text check (default_payment_terms is null or length(default_payment_terms) <= 4000),
  default_cancellation text check (default_cancellation is null or length(default_cancellation) <= 4000),
  updated_by uuid not null references auth.users (id),
  updated_at timestamptz not null default now()
);

-- Catálogo simple (T-022): se copia a la cotización; cambiarlo no toca cotizaciones existentes.
create table public.catalog_services (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  description text not null check (length(btrim(description)) between 1 and 300),
  supplier text check (supplier is null or length(btrim(supplier)) between 1 and 160),
  unit public.quote_unit not null default 'servicio',
  unit_cost numeric(16, 4) not null default 0 check (unit_cost >= 0 and unit_cost < 1e12),
  cost_currency public.currency_code not null,
  unit_price numeric(16, 4) not null default 0 check (unit_price >= 0 and unit_price < 1e12),
  price_currency public.currency_code not null,
  active boolean not null default true,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, id)
);
create index catalog_services_agency_idx on public.catalog_services (agency_id, active, lower(description));

-- Contador por agencia. Fuera de public: ningún rol de la app lo lee ni lo escribe.
create table app.quote_counters (
  agency_id uuid primary key references public.agencies (id) on delete cascade,
  last_number integer not null
);

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null references public.agencies (id) on delete cascade,
  opportunity_id uuid not null,
  number integer not null,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  unique (agency_id, id),
  unique (agency_id, number),
  foreign key (agency_id, opportunity_id) references public.opportunities (agency_id, id)
);
create index quotes_opportunity_idx on public.quotes (opportunity_id, created_at);

create function app.quotes_number() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  -- El insert ... on conflict bloquea la fila del contador: dos cotizaciones a la vez reciben
  -- números distintos y consecutivos.
  insert into app.quote_counters as c (agency_id, last_number) values (new.agency_id, 1)
    on conflict (agency_id) do update set last_number = c.last_number + 1
    returning last_number into new.number;
  return new;
end;
$$;
create trigger quotes_number before insert on public.quotes
  for each row execute function app.quotes_number();

create table public.quote_versions (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  quote_id uuid not null,
  version integer not null check (version >= 1),
  status public.quote_status not null default 'borrador',
  title text not null check (length(btrim(title)) between 1 and 160),
  client_name text not null check (length(btrim(client_name)) between 1 and 160),
  destination text check (destination is null or length(btrim(destination)) between 1 and 160),
  travel_start date,
  travel_end date,
  travelers integer check (travelers is null or travelers between 1 and 999),
  sale_currency public.currency_code not null default 'COP',
  valid_until date,
  includes text check (includes is null or length(includes) <= 4000),
  excludes text check (excludes is null or length(excludes) <= 4000),
  payment_terms text check (payment_terms is null or length(payment_terms) <= 4000),
  cancellation_policy text check (cancellation_policy is null or length(cancellation_policy) <= 4000),
  show_item_prices boolean not null default true,
  rounding_rule text not null default 'half_up_item_v1',
  -- Se llenan solos al enviar (RF-404): total y marca de la agencia de ese momento.
  sale_total numeric(14, 2),
  brand jsonb,
  brand_logo bytea,
  brand_logo_type text,
  sent_at timestamptz,
  sent_by uuid references auth.users (id),
  decided_at timestamptz,
  decided_by uuid references auth.users (id),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_id, id),
  unique (quote_id, version),
  foreign key (agency_id, quote_id) references public.quotes (agency_id, id),
  check (travel_end is null or travel_start is null or travel_end >= travel_start),
  check ((status = 'borrador') = (sent_at is null))
);
-- RF-413: como máximo un borrador por cotización; una sola versión aceptada.
create unique index quote_versions_one_draft_idx on public.quote_versions (quote_id) where status = 'borrador';
create unique index quote_versions_one_accepted_idx on public.quote_versions (quote_id) where status = 'aceptada';
create index quote_versions_agency_idx on public.quote_versions (agency_id, status, valid_until);

-- Datos internos de la versión, que Lectura no ve (RF-406): tipo de cambio (pesos colombianos por
-- 1 dólar, obligatorio para enviar si algún coste está en otra moneda) y margen mínimo, que se
-- copia de los ajustes al enviar. Sin fila, no hay tipo de cambio.
create table public.quote_version_costs (
  quote_version_id uuid primary key,
  agency_id uuid not null,
  exchange_rate numeric(14, 4) check (exchange_rate is null or (exchange_rate > 0 and exchange_rate <= 1000000)),
  min_margin_pct numeric(5, 2),
  foreign key (agency_id, quote_version_id) references public.quote_versions (agency_id, id) on delete cascade
);

create table public.quote_items (
  id uuid primary key default gen_random_uuid(),
  agency_id uuid not null,
  quote_version_id uuid not null,
  position integer not null check (position between 0 and 999),
  description text not null check (length(btrim(description)) between 1 and 300),
  supplier text check (supplier is null or length(btrim(supplier)) between 1 and 160),
  quantity numeric(10, 2) not null check (quantity > 0 and quantity <= 9999),
  unit public.quote_unit not null default 'servicio',
  unit_price numeric(16, 4) not null check (unit_price >= 0 and unit_price < 1e12),
  unit_cost numeric(16, 4) not null default 0 check (unit_cost >= 0 and unit_cost < 1e12),
  cost_currency public.currency_code not null,
  catalog_service_id uuid,
  -- Calculados por la base (app.quote_items_compute); en la moneda de venta de la versión.
  line_total numeric(14, 2) not null default 0,
  line_cost numeric(14, 2),
  created_at timestamptz not null default now(),
  foreign key (agency_id, quote_version_id) references public.quote_versions (agency_id, id) on delete cascade,
  foreign key (agency_id, catalog_service_id) references public.catalog_services (agency_id, id)
);
create index quote_items_version_idx on public.quote_items (quote_version_id, position);

-- Total de un ítem con la regla half_up_item_v1: cantidad × unitario, convertido a la moneda de
-- venta y redondeado una sola vez (round de numeric redondea el medio hacia arriba en positivos).
create function app.quote_line_amount(p_quantity numeric, p_unit numeric, p_from public.currency_code,
  p_to public.currency_code, p_rate numeric) returns numeric
language sql immutable set search_path = ''
as $$
  select case
    when p_from = p_to then round(p_quantity * p_unit, case when p_to = 'COP' then 0 else 2 end)
    when p_rate is null or p_rate <= 0 then null
    when p_from = 'USD' then round(p_quantity * p_unit * p_rate, 0)
    else round(p_quantity * p_unit / p_rate, 2)
  end;
$$;

-- Lee la versión con FOR SHARE: así choca con el UPDATE que la envía y un ítem no se puede
-- colar en una versión que se está enviando en otra transacción (informe de QA, 5 nov 2026).
create function app.quote_items_compute() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v public.quote_versions%rowtype;
  v_rate numeric;
begin
  select * into v from public.quote_versions
    where id = coalesce(new.quote_version_id, old.quote_version_id)
      and agency_id = coalesce(new.agency_id, old.agency_id)
    for share;
  if not found then
    -- Borrado en cascada de un borrador: la versión ya no está.
    if tg_op = 'DELETE' then
      return old;
    end if;
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v.status <> 'borrador' then
    raise exception 'quote_version_locked' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE' and (new.quote_version_id <> old.quote_version_id or new.agency_id <> old.agency_id) then
    raise exception 'quote_version_locked' using errcode = 'P0001';
  end if;
  select c.exchange_rate into v_rate from public.quote_version_costs c where c.quote_version_id = v.id;
  new.line_total := app.quote_line_amount(new.quantity, new.unit_price, v.sale_currency, v.sale_currency, null);
  new.line_cost := app.quote_line_amount(new.quantity, new.unit_cost, new.cost_currency, v.sale_currency, v_rate);
  return new;
end;
$$;
create trigger quote_items_compute before insert or update or delete on public.quote_items
  for each row execute function app.quote_items_compute();

-- Los datos internos solo cambian en borrador; al cambiar el tipo de cambio se recalculan los ítems.
create function app.quote_version_costs_rules() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_status public.quote_status;
begin
  select status into v_status from public.quote_versions
    where id = coalesce(new.quote_version_id, old.quote_version_id)
      and agency_id = coalesce(new.agency_id, old.agency_id)
    for share;
  if not found then
    if tg_op = 'DELETE' then
      return old;
    end if;
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if v_status <> 'borrador' then
    raise exception 'quote_version_locked' using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE' and (new.quote_version_id <> old.quote_version_id or new.agency_id <> old.agency_id) then
    raise exception 'quote_version_locked' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger quote_version_costs_rules before insert or update or delete on public.quote_version_costs
  for each row execute function app.quote_version_costs_rules();

create function app.quote_version_costs_after() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.exchange_rate is distinct from old.exchange_rate then
    update public.quote_items set quantity = quantity where quote_version_id = new.quote_version_id;
  end if;
  return null;
end;
$$;
create trigger quote_version_costs_after after insert or update on public.quote_version_costs
  for each row execute function app.quote_version_costs_after();

create function app.quote_versions_rules() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'America/Bogota')::date;
  v_brand public.agency_branding%rowtype;
  v_agency_name text;
  v_ignored text[] := array['status', 'decided_at', 'decided_by', 'updated_at'];
begin
  if tg_op = 'INSERT' then
    new.status := 'borrador';
    new.rounding_rule := 'half_up_item_v1';
    new.sale_total := null;
    new.brand := null;
    new.brand_logo := null;
    new.brand_logo_type := null;
    new.sent_at := null;
    new.sent_by := null;
    new.decided_at := null;
    new.decided_by := null;
    select coalesce(max(version), 0) + 1 into new.version from public.quote_versions where quote_id = new.quote_id;
    new.updated_at := now();
    return new;
  end if;

  if old.status = 'borrador' then
    if new.quote_id <> old.quote_id or new.agency_id <> old.agency_id or new.version <> old.version then
      raise exception 'quote_version_locked' using errcode = 'P0001';
    end if;
    new.updated_at := now();
    if new.status = 'borrador' then
      return new;
    elsif new.status <> 'enviada' then
      raise exception 'invalid_quote_transition' using errcode = 'P0001';
    end if;
    -- Enviar: validar y congelar (RF-403, RF-404).
    if not exists (select 1 from public.quote_items i where i.quote_version_id = new.id) then
      raise exception 'quote_no_items' using errcode = 'P0001';
    end if;
    if exists (select 1 from public.quote_items i where i.quote_version_id = new.id and i.line_cost is null) then
      raise exception 'exchange_rate_required' using errcode = 'P0001';
    end if;
    if new.valid_until is null then
      raise exception 'valid_until_required' using errcode = 'P0001';
    end if;
    if new.valid_until < v_today then
      raise exception 'valid_until_past' using errcode = 'P0001';
    end if;
    select coalesce(sum(i.line_total), 0) into new.sale_total from public.quote_items i where i.quote_version_id = new.id;
    -- La versión sigue en borrador dentro de este trigger, así que la fila interna se puede escribir.
    insert into public.quote_version_costs (quote_version_id, agency_id, min_margin_pct)
      values (new.id, new.agency_id,
        coalesce((select s.min_margin_pct from public.quote_settings s where s.agency_id = new.agency_id), 10))
      on conflict (quote_version_id) do update set min_margin_pct = excluded.min_margin_pct;
    select a.name into v_agency_name from public.agencies a where a.id = new.agency_id;
    select * into v_brand from public.agency_branding b where b.agency_id = new.agency_id;
    new.brand := jsonb_build_object(
      'name', v_agency_name,
      'primary_color', coalesce(v_brand.primary_color, '#0F6E6E'),
      'accent_color', coalesce(v_brand.accent_color, '#F28C28'));
    new.brand_logo := v_brand.logo;
    new.brand_logo_type := v_brand.logo_type;
    new.sent_at := now();
    new.sent_by := auth.uid();
    return new;
  end if;

  -- Versión ya enviada: nada cambia salvo el estado, y solo hacia adelante (RF-405).
  if (to_jsonb(new) - v_ignored) is distinct from (to_jsonb(old) - v_ignored) then
    raise exception 'quote_version_locked' using errcode = 'P0001';
  end if;
  if new.status = old.status then
    new.decided_at := old.decided_at;
    new.decided_by := old.decided_by;
    new.updated_at := old.updated_at;
    return new;
  end if;
  if old.status <> 'enviada' or new.status not in ('sustituida', 'aceptada', 'rechazada') then
    raise exception 'invalid_quote_transition' using errcode = 'P0001';
  end if;
  -- Solo queda sustituida cuando se envía otra versión de la misma cotización.
  if new.status = 'sustituida' and not exists (
    select 1 from public.quote_versions o
    where o.quote_id = new.quote_id and o.id <> new.id and o.status = 'enviada' and o.sent_at >= old.sent_at
  ) then
    raise exception 'invalid_quote_transition' using errcode = 'P0001';
  end if;
  if new.status in ('aceptada', 'rechazada') then
    new.decided_at := now();
    new.decided_by := auth.uid();
  else
    new.decided_at := null;
    new.decided_by := null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger quote_versions_rules before insert or update on public.quote_versions
  for each row execute function app.quote_versions_rules();

-- Después de guardar una versión: al enviarla, las enviadas anteriores pasan a Sustituida; si en
-- borrador cambia la moneda o el tipo de cambio, se recalculan sus ítems.
create function app.quote_versions_after() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.status = 'borrador' and new.status = 'enviada' then
    update public.quote_versions set status = 'sustituida'
      where quote_id = new.quote_id and id <> new.id and status = 'enviada';
  elsif new.status = 'borrador' and new.sale_currency is distinct from old.sale_currency then
    update public.quote_items set quantity = quantity where quote_version_id = new.id;
  end if;
  return null;
end;
$$;
create trigger quote_versions_after after update on public.quote_versions
  for each row execute function app.quote_versions_after();

-- Una versión enviada no se borra. Un borrador sí (por ejemplo, si se creó por error), salvo que
-- sea la única versión de la cotización.
create function app.quote_versions_no_delete() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.quotes q where q.id = old.quote_id) then
    if old.status <> 'borrador' then
      raise exception 'quote_version_locked' using errcode = 'P0001';
    end if;
    if not exists (select 1 from public.quote_versions o where o.quote_id = old.quote_id and o.id <> old.id) then
      raise exception 'quote_last_version' using errcode = 'P0001';
    end if;
  end if;
  return old;
end;
$$;
create trigger quote_versions_no_delete before delete on public.quote_versions
  for each row execute function app.quote_versions_no_delete();

create function app.catalog_services_touch() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger catalog_services_touch before update on public.catalog_services
  for each row execute function app.catalog_services_touch();

-- Ítems sin coste ni margen, para el rol Lectura y para lo que ve el cliente (RF-406).
create function app.quote_items_for_client(p_version uuid)
returns table (id uuid, quote_version_id uuid, "position" integer, description text, quantity numeric,
  unit public.quote_unit, unit_price numeric, line_total numeric)
language sql stable security definer set search_path = ''
as $$
  select i.id, i.quote_version_id, i.position, i.description, i.quantity, i.unit, i.unit_price, i.line_total
  from public.quote_items i
  where i.quote_version_id = p_version and app.is_member(i.agency_id)
  order by i.position, i.created_at;
$$;

-- RLS
alter table public.quote_settings enable row level security;
alter table public.catalog_services enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_versions enable row level security;
alter table public.quote_items enable row level security;
alter table public.quote_version_costs enable row level security;

create policy quote_settings_select on public.quote_settings for select to authenticated using (app.is_member(agency_id));
create policy quote_settings_insert on public.quote_settings for insert to authenticated
  with check (app.has_role(agency_id, array['admin']::public.agency_role[]) and updated_by = auth.uid());
create policy quote_settings_update on public.quote_settings for update to authenticated
  using (app.has_role(agency_id, array['admin']::public.agency_role[]))
  with check (app.has_role(agency_id, array['admin']::public.agency_role[]) and updated_by = auth.uid());

create policy catalog_select on public.catalog_services for select to authenticated
  using (app.has_role(agency_id, array['admin', 'asesor']::public.agency_role[]));
create policy catalog_insert on public.catalog_services for insert to authenticated
  with check (app.has_role(agency_id, array['admin']::public.agency_role[]) and created_by = auth.uid());
create policy catalog_update on public.catalog_services for update to authenticated
  using (app.has_role(agency_id, array['admin']::public.agency_role[]))
  with check (app.has_role(agency_id, array['admin']::public.agency_role[]));

create policy quotes_select on public.quotes for select to authenticated using (app.is_member(agency_id));
create policy quotes_insert on public.quotes for insert to authenticated
  with check (app.has_role(agency_id, array['admin', 'asesor']::public.agency_role[]) and created_by = auth.uid());

create policy quote_versions_select on public.quote_versions for select to authenticated using (app.is_member(agency_id));
create policy quote_versions_insert on public.quote_versions for insert to authenticated
  with check (app.has_role(agency_id, array['admin', 'asesor']::public.agency_role[]) and created_by = auth.uid());
create policy quote_versions_update on public.quote_versions for update to authenticated
  using (app.has_role(agency_id, array['admin', 'asesor']::public.agency_role[]))
  with check (app.has_role(agency_id, array['admin', 'asesor']::public.agency_role[]));
create policy quote_versions_delete on public.quote_versions for delete to authenticated
  using (app.has_role(agency_id, array['admin', 'asesor']::public.agency_role[]) and status = 'borrador');

create policy quote_version_costs_select on public.quote_version_costs for select to authenticated
  using (app.has_role(agency_id, array['admin', 'asesor']::public.agency_role[]));
create policy quote_version_costs_write on public.quote_version_costs for all to authenticated
  using (app.has_role(agency_id, array['admin', 'asesor']::public.agency_role[]))
  with check (app.has_role(agency_id, array['admin', 'asesor']::public.agency_role[]));

create policy quote_items_select on public.quote_items for select to authenticated
  using (app.has_role(agency_id, array['admin', 'asesor']::public.agency_role[]));
create policy quote_items_write on public.quote_items for all to authenticated
  using (app.has_role(agency_id, array['admin', 'asesor']::public.agency_role[]))
  with check (app.has_role(agency_id, array['admin', 'asesor']::public.agency_role[]));

-- Privilegios mínimos.
revoke all on public.quote_settings, public.catalog_services, public.quotes, public.quote_versions,
  public.quote_items, public.quote_version_costs from anon, authenticated;
revoke all on app.quote_counters from anon, authenticated;
grant select, insert on public.quote_settings to authenticated;
grant update (min_margin_pct, validity_days, default_includes, default_excludes, default_payment_terms,
  default_cancellation, updated_by) on public.quote_settings to authenticated;
grant select, insert on public.catalog_services to authenticated;
grant update (description, supplier, unit, unit_cost, cost_currency, unit_price, price_currency, active)
  on public.catalog_services to authenticated;
grant select, insert on public.quotes to authenticated;
grant select, insert, delete on public.quote_versions to authenticated;
grant update (status, title, client_name, destination, travel_start, travel_end, travelers, sale_currency,
  valid_until, includes, excludes, payment_terms, cancellation_policy, show_item_prices)
  on public.quote_versions to authenticated;
grant select, insert, delete on public.quote_items to authenticated;
grant select, insert on public.quote_version_costs to authenticated;
grant update (exchange_rate) on public.quote_version_costs to authenticated;
grant update (position, description, supplier, quantity, unit, unit_price, unit_cost, cost_currency, catalog_service_id)
  on public.quote_items to authenticated;
revoke all on all functions in schema app from public;
grant execute on function app.is_member(uuid), app.has_role(uuid, public.agency_role[]) to authenticated;
grant execute on function app.quote_items_for_client(uuid) to authenticated;
