-- Close Call Stage 6.5: archive completed matches and reopen the same room.

create table public.game_match_history (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  match_number integer not null,
  completed_at timestamptz not null default statement_timestamp(),
  rounds jsonb not null,
  submissions jsonb not null,
  round_start_scores jsonb not null,
  used_question_ids uuid[] not null,
  unique (room_id, match_number)
);

revoke all on public.game_match_history from public, anon, authenticated;

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
    ), array[]::uuid[]);

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

-- Stage 6.1 selection for an active match, preferring questions that were not
-- used in the immediately preceding archived match. Scarcity falls back via
-- ordering rather than failing when the bank is small.
create or replace function public.balance_game_round_question()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_question_id public.game_questions.id%type;
  v_previous_category text;
  v_previous_match_questions uuid[] := array[]::uuid[];
  v_target_difficulty text;
begin
  if new.round_number not between 1 and 7 then
    return new;
  end if;

  v_target_difficulty := public.question_difficulty_for_round(new.round_number);

  select q.category
    into v_previous_category
  from public.game_rounds gr
  join public.game_questions q on q.id = gr.question_id
  where gr.room_id = new.room_id
    and gr.round_number < new.round_number
  order by gr.round_number desc
  limit 1;

  select h.used_question_ids
    into v_previous_match_questions
  from public.game_match_history h
  where h.room_id = new.room_id
  order by h.match_number desc
  limit 1;

  v_previous_match_questions := coalesce(
    v_previous_match_questions,
    array[]::uuid[]
  );

  select q.id
    into v_question_id
  from public.game_questions q
  where not exists (
    select 1
    from public.game_rounds used
    where used.room_id = new.room_id
      and used.question_id = q.id
  )
  order by
    (q.difficulty <> v_target_difficulty),
    (q.id = any(v_previous_match_questions)),
    (v_previous_category is not null and q.category = v_previous_category),
    (q.last_used_at is not null),
    q.last_used_at asc nulls first,
    q.use_count asc,
    random()
  for update of q skip locked
  limit 1;

  if v_question_id is null then
    raise exception 'No questions are available for room % round %',
      new.room_id, new.round_number using errcode = 'P0001';
  end if;

  new.question_id := v_question_id;

  update public.game_questions
  set last_used_at = statement_timestamp(),
      use_count = use_count + 1
  where id = v_question_id;

  return new;
end;
$$;

revoke all on function public.balance_game_round_question() from public;

create or replace function public.get_my_latest_room()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(r)
  from public.rooms r
  join public.players p on p.room_id = r.id
  where p.user_id = auth.uid()
  order by p.joined_at desc
  limit 1;
$$;

revoke all on function public.get_my_latest_room() from public, anon;
grant execute on function public.get_my_latest_room() to authenticated;

notify pgrst, 'reload schema';
