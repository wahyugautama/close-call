-- Do not run the host-authorized advance_game RPC inside a player's
-- submit_guess transaction. If that call rejects the player, PostgreSQL rolls
-- back the accepted submission as well. The deadline update remains the
-- server-authoritative completion signal; its room UPDATE wakes the existing
-- Realtime subscribers, which invoke the normal advance_game RPC.

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
    update public.rooms r
    set phase_deadline = coalesce(
      least(r.phase_deadline, statement_timestamp()),
      statement_timestamp()
    )
    where r.id = v_room_id
      and r.status = 'playing'
      and r.phase = 'question';
  end if;

  return new;
end;
$$;

revoke all on function public.advance_game_when_all_submitted() from public;

comment on function public.advance_game_when_all_submitted() is
  'Serializes submission completion and expires the question without coupling submission acceptance to host-authorized advancement.';

notify pgrst, 'reload schema';
