-- SPEC-004 parte 4: el PDF de cada versión enviada se genera una sola vez y se guarda (RF-404).
-- Nunca cambia ni se borra; lo leen todos los miembros de la agencia (también Lectura: no tiene
-- datos internos, RF-406). Lo escriben administrador y asesor, y solo para una versión ya enviada.
create table public.quote_pdfs (
  quote_version_id uuid primary key,
  agency_id uuid not null,
  pdf bytea not null check (octet_length(pdf) between 1 and 5242880),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  foreign key (agency_id, quote_version_id) references public.quote_versions (agency_id, id)
);

create function app.quote_pdfs_rules() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_status public.quote_status;
begin
  if tg_op <> 'INSERT' then
    raise exception 'quote_version_locked' using errcode = 'P0001';
  end if;
  select status into v_status from public.quote_versions
    where id = new.quote_version_id and agency_id = new.agency_id for share;
  if v_status is null or v_status = 'borrador' then
    raise exception 'invalid_quote_transition' using errcode = 'P0001';
  end if;
  if encode(pg_catalog.sha256(new.pdf), 'hex') <> new.sha256 then
    raise exception 'invalid_input' using errcode = 'P0001';
  end if;
  new.created_at := now();
  return new;
end;
$$;
create trigger quote_pdfs_rules before insert or update or delete on public.quote_pdfs
  for each row execute function app.quote_pdfs_rules();

alter table public.quote_pdfs enable row level security;
create policy quote_pdfs_select on public.quote_pdfs for select to authenticated using (app.is_member(agency_id));
create policy quote_pdfs_insert on public.quote_pdfs for insert to authenticated
  with check (app.has_role(agency_id, array['admin', 'asesor']::public.agency_role[]) and created_by = auth.uid());

revoke all on public.quote_pdfs from anon, authenticated;
grant select, insert on public.quote_pdfs to authenticated;
revoke all on function app.quote_pdfs_rules() from public;
