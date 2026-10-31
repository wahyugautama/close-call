-- Stage 6.4 correction: phase and deadline belong to game_rounds, not rooms.
-- Keep submission acceptance independent from the host-authorized advance RPC.

create or replace function public.advance_game_when_all_submitted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room_id uuid;
  v_eligible_count bigint;
  v_submitted_count bigint;
begin
  select gr.room_id
    into v_room_id
  from public.game_rounds gr
  where gr.id = new.round_id;

  if v_room_id is null then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_room_id::text, 6400)
  );

  select count(*)
    into v_eligible_count
  from public.players p
  where p.room_id = v_room_id;

  select count(distinct s.player_id)
    into v_submitted_count
  from public.game_submissions s
  join public.players p
    on p.id = s.player_id
   and p.room_id = v_room_id
  where s.round_id = new.round_id;

  if v_eligible_count > 0 and v_submitted_count >= v_eligible_count then
    update public.game_rounds gr
    set deadline = coalesce(
      least(gr.deadline, statement_timestamp()),
      statement_timestamp()
    )
    where gr.id = new.round_id
      and gr.room_id = v_room_id
      and gr.phase = 'question';
  end if;

  return new;
end;
$$;

revoke all on function public.advance_game_when_all_submitted() from public;

comment on function public.advance_game_when_all_submitted() is
  'Serializes submission completion and expires game_rounds.deadline without coupling submission acceptance to host-authorized advancement.';

notify pgrst, 'reload schema';
