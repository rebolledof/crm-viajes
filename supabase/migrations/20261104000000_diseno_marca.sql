-- SPEC-002c · Marca por agencia, preferencias de cada usuario y meta por etapa.
-- Solo aditiva: tablas y una columna nuevas; no cambia datos existentes.

-- Marca de la agencia (RF-240, RF-241). Una fila por agencia; sin fila se usan los colores por defecto.
create table public.agency_branding (
  agency_id uuid primary key references public.agencies (id) on delete cascade,
  primary_color text not null default '#0F6E6E' check (primary_color ~ '^#[0-9A-F]{6}$'),
  accent_color text not null default '#F28C28' check (accent_color ~ '^#[0-9A-F]{6}$'),
  -- Logo guardado en la base (máx. 512 KB), con la misma RLS que el resto de la agencia.
  logo bytea check (logo is null or octet_length(logo) <= 524288),
  logo_type text check (logo_type in ('image/png', 'image/webp', 'image/jpeg')),
  updated_by uuid not null references auth.users (id),
  updated_at timestamptz not null default now(),
  check ((logo is null) = (logo_type is null))
);

alter table public.agency_branding enable row level security;
create policy branding_select on public.agency_branding for select to authenticated using (app.is_member(agency_id));
create policy branding_insert on public.agency_branding for insert to authenticated
  with check (app.has_role(agency_id, array['admin']::public.agency_role[]) and updated_by = auth.uid());
create policy branding_update on public.agency_branding for update to authenticated
  using (app.has_role(agency_id, array['admin']::public.agency_role[]))
  with check (app.has_role(agency_id, array['admin']::public.agency_role[]) and updated_by = auth.uid());

revoke all on public.agency_branding from anon, authenticated;
grant select, insert on public.agency_branding to authenticated;
grant update (primary_color, accent_color, logo, logo_type, updated_by, updated_at) on public.agency_branding to authenticated;

-- Preferencias personales (RF-243, RF-244). No es una tabla de negocio: pertenece a la persona,
-- vale en todas sus agencias y solo ella la lee y la cambia.
create table public.user_preferences (
  user_id uuid primary key references auth.users (id) on delete cascade,
  nav_layout text not null default 'top' check (nav_layout in ('top', 'side')),
  nav_collapsed boolean not null default false,
  theme text not null default 'light' check (theme in ('light', 'dark', 'system')),
  updated_at timestamptz not null default now()
);

alter table public.user_preferences enable row level security;
create policy prefs_select on public.user_preferences for select to authenticated using (user_id = auth.uid());
create policy prefs_insert on public.user_preferences for insert to authenticated with check (user_id = auth.uid());
create policy prefs_update on public.user_preferences for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on public.user_preferences from anon, authenticated;
grant select, insert on public.user_preferences to authenticated;
grant update (nav_layout, nav_collapsed, theme, updated_at) on public.user_preferences to authenticated;

-- Meta corta por etapa que el tablero muestra bajo el nombre (decisión por defecto de SPEC-002c).
alter table public.pipeline_stages add column goal text check (goal is null or length(goal) <= 120);
grant update (goal) on public.pipeline_stages to authenticated;
