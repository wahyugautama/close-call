-- Correct the Stage 6.5 rematch archive fallback to match the deployed
-- bigint primary key used by game_questions and game_rounds.question_id.

-- This is a no-op on the live database where the correction was already
-- applied manually. It keeps fresh migration replays safe without dropping
-- the table, the column, or any match history.
do $$
begin
  if exists (
    select 1
    from pg_catalog.pg_attribute attribute
    where attribute.attrelid = 'public.game_match_history'::regclass
      and attribute.attname = 'used_question_ids'
      and not attribute.attisdropped
      and pg_catalog.format_type(
        attribute.atttypid,
        attribute.atttypmod
      ) <> 'bigint[]'
  ) then
    alter table public.game_match_history
      alter column used_question_ids
      type bigint[]
      using used_question_ids::text[]::bigint[];
  end if;
end;
$$;

create or replace function public.prepare_rematch(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms%rowtype;
  v_match_number integer;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select r.*
    into v_room
  from public.rooms r
  where r.id = p_room_id
  for update;

  if not found then
    raise exception 'Room not found' using errcode = 'P0002';
  end if;

  if not exists (
    select 1
    from public.players p
    where p.room_id = p_room_id
      and p.user_id = auth.uid()
  ) then
    raise exception 'You are not a player in this room' using errcode = '42501';
  end if;

  if v_room.host_id <> auth.uid() then
    raise exception 'Only the host can start a rematch' using errcode = '42501';
  end if;

  if v_room.status <> 'finished' then
    raise exception 'Only a finished game can enter rematch mode'
      using errcode = '55000';
  end if;

  select coalesce(max(h.match_number), 0) + 1
    into v_match_number
  from public.game_match_history h
  where h.room_id = p_room_id;

  insert into public.game_match_history (
    room_id,
    match_number,
    rounds,
    submissions,
    round_start_scores,
    used_question_ids
  )
  select
    p_room_id,
    v_match_number,
    coalesce((
      select jsonb_agg(to_jsonb(gr) order by gr.round_number)
      from public.game_rounds gr
      where gr.room_id = p_room_id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(to_jsonb(gs))
      from public.game_submissions gs
      join public.game_rounds gr on gr.id = gs.round_id
      where gr.room_id = p_room_id
    ), '[]'::jsonb),
    coalesce((
      select jsonb_agg(to_jsonb(snapshot))
      from public.game_round_start_scores snapshot
      join public.game_rounds gr on gr.id = snapshot.round_id
      where gr.room_id = p_room_id
    ), '[]'::jsonb),
    coalesce((
      select array_agg(gr.question_id order by gr.round_number)
      from public.game_rounds gr
      where gr.room_id = p_room_id
    ), array[]::bigint[]);

  -- Existing cascading foreign keys clear submissions and comeback snapshots.
  delete from public.game_rounds gr where gr.room_id = p_room_id;

  update public.players
  set score = 500
  where room_id = p_room_id;

  update public.rooms
  set status = 'lobby'
  where id = p_room_id;
end;
$$;

revoke all on function public.prepare_rematch(uuid) from public, anon;
grant execute on function public.prepare_rematch(uuid) to authenticated;

notify pgrst, 'reload schema';
