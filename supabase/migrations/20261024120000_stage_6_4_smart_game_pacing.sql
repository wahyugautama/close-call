-- Close Call Stage 6.4: end question phases as soon as every registered
-- player has submitted. Registered players remain eligible until the existing
-- room lifecycle explicitly removes them; disconnects are not forfeits.

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

  -- Serialize final-submission checks for this room. A waiter takes a fresh
  -- READ COMMITTED snapshot after the preceding submission commits, so two
  -- simultaneous final submissions cannot both miss completion.
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
    -- advance_game remains the single phase/scoring authority. Moving only
    -- the server deadline makes its existing authorization, row locking,
    -- idempotency, missing-guess handling, and 8s/5s phase durations apply.
    update public.rooms r
    set phase_deadline = least(r.phase_deadline, statement_timestamp())
    where r.id = v_room_id
      and r.status = 'playing'
      and r.phase = 'question';

    perform public.advance_game(v_room_id);
  end if;

  return new;
end;
$$;

revoke all on function public.advance_game_when_all_submitted() from public;

drop trigger if exists advance_game_when_all_submitted
  on public.game_submissions;
create trigger advance_game_when_all_submitted
after insert on public.game_submissions
for each row
execute function public.advance_game_when_all_submitted();

comment on function public.advance_game_when_all_submitted() is
  'Serializes submission completion checks and delegates an early question transition to advance_game.';
