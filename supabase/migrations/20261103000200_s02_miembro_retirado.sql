-- SPEC-002 · Ajustes tras la prueba independiente (1 nov 2026).
-- Solo se exige "miembro activo" al asignar o cambiar responsable. Antes también al
-- completar, mover o editar, y lo de una persona retirada quedaba sin poder cerrarse.
-- No borra ni cambia datos: solo reemplaza las funciones de los triggers.

create or replace function app.opportunities_rules() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_stage public.pipeline_stages%rowtype;
begin
  select * into v_stage from public.pipeline_stages where id = new.stage_id and agency_id = new.agency_id;
  if not found then
    raise exception 'stage_not_found' using errcode = 'P0001';
  end if;
  if (tg_op = 'INSERT' or new.stage_id is distinct from old.stage_id) and not v_stage.active then
    raise exception 'stage_inactive' using errcode = 'P0001';
  end if;
  if tg_op = 'INSERT' or new.owner_id is distinct from old.owner_id then
    perform app.assert_active_member(new.agency_id, new.owner_id);
  end if;

  if v_stage.kind = 'perdida' then
    if new.lost_reason is null then
      raise exception 'lost_reason_required' using errcode = 'P0001';
    end if;
    if new.lost_reason = 'otro' and coalesce(btrim(new.lost_note), '') = '' then
      raise exception 'lost_note_required' using errcode = 'P0001';
    end if;
    new.won_evidence := null;
  elsif v_stage.kind = 'ganada' then
    if coalesce(btrim(new.won_evidence), '') = '' then
      raise exception 'won_evidence_required' using errcode = 'P0001';
    end if;
    new.lost_reason := null;
    new.lost_note := null;
  else
    new.lost_reason := null;
    new.lost_note := null;
    new.won_evidence := null;
  end if;

  if v_stage.kind = 'abierta' then
    new.closed_at := null;
  elsif tg_op = 'INSERT' or new.closed_at is null or new.stage_id is distinct from old.stage_id then
    new.closed_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function app.contacts_rules() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.owner_id is distinct from old.owner_id then
    perform app.assert_active_member(new.agency_id, new.owner_id);
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function app.tasks_rules() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.assignee_id is distinct from old.assignee_id then
    perform app.assert_active_member(new.agency_id, new.assignee_id);
  end if;
  if new.opportunity_id is not null and not exists (
    select 1 from public.opportunities o where o.id = new.opportunity_id and o.contact_id = new.contact_id
  ) then
    raise exception 'task_contact_mismatch' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
