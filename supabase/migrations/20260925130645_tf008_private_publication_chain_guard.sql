-- TF-008 preparation: preserve sequential private revision/head relationships.
-- No publication function, application writer, public grant, or eligibility policy.

create function terra_private.check_issue_publication_predecessor()
returns trigger language plpgsql set search_path = pg_catalog as $$
declare
  previous_revision integer;
begin
  if new.revision = 1 then
    if new.predecessor_id is not null then
      raise exception 'First issue publication must have no predecessor' using errcode = '23514';
    end if;
  else
    select revision into previous_revision
      from terra_private.issue_publications
      where id = new.predecessor_id and issue_id = new.issue_id;
    if previous_revision is null or previous_revision <> new.revision - 1 then
      raise exception 'Issue publication predecessor must be the prior revision' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger issue_publication_predecessor_guard
before insert or update of issue_id, revision, predecessor_id
on terra_private.issue_publications
for each row execute function terra_private.check_issue_publication_predecessor();

create function terra_private.check_issue_head_advance()
returns trigger language plpgsql set search_path = pg_catalog as $$
declare
  target_revision integer;
  target_predecessor uuid;
  target_kind text;
  previous_revision integer;
  previous_head uuid;
begin
  if tg_op = 'UPDATE' and new.issue_id is distinct from old.issue_id then
    raise exception 'Issue head identity cannot change' using errcode = '23514';
  end if;
  if new.current_publication_id is null then
    if tg_op = 'UPDATE' and old.current_publication_id is not null then
      raise exception 'Issue head cannot be cleared; use a suppression revision' using errcode = '23514';
    end if;
    return new;
  end if;

  select revision, predecessor_id, publication_kind
    into target_revision, target_predecessor, target_kind
    from terra_private.issue_publications
    where id = new.current_publication_id and issue_id = new.issue_id;
  if target_revision is null or target_kind not in ('accepted', 'correction', 'suppression') then
    raise exception 'Issue head target must be a non-draft publication for this issue' using errcode = '23514';
  end if;

  previous_head := case when tg_op = 'UPDATE' then old.current_publication_id else null end;
  if previous_head is null then
    if target_revision <> 1 or target_predecessor is not null then
      raise exception 'First active issue head must be revision one' using errcode = '23514';
    end if;
  else
    select revision into previous_revision from terra_private.issue_publications
      where id = previous_head and issue_id = new.issue_id;
    if new.current_publication_id = previous_head
       or target_predecessor is distinct from previous_head
       or target_revision <> previous_revision + 1 then
      raise exception 'Issue head must advance by one linked revision' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger issue_head_advance_guard
before insert or update of issue_id, current_publication_id, changed_at
on terra_private.issue_heads
for each row execute function terra_private.check_issue_head_advance();

-- Functions are trigger-only. Default PUBLIC EXECUTE is removed explicitly.
revoke all on function terra_private.check_issue_publication_predecessor() from public;
revoke all on function terra_private.check_issue_head_advance() from public;
