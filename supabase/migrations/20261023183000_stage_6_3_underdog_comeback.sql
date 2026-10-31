-- Close Call Stage 6.3: frozen round-start underdog eligibility and earned
-- comeback bonuses. Stage 6.2 thresholds, stakes, and score floor are unchanged.

create table public.game_round_start_scores (
  round_id uuid not null references public.game_rounds(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  starting_score integer not null,
  leader_starting_score integer not null,
  comeback_eligible boolean not null,
  primary key (round_id, player_id)
);

revoke all on public.game_round_start_scores from public, anon, authenticated;

create or replace function public.is_comeback_eligible(
  p_round_number integer,
  p_starting_score integer,
  p_leader_starting_score integer
)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select p_round_number between 5 and 7
    and p_leader_starting_score > 0
    and p_starting_score < p_leader_starting_score
    and p_starting_score::bigint * 100
      <= p_leader_starting_score::bigint * 70;
$$;

revoke all on function public.is_comeback_eligible(integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.is_comeback_eligible(integer, integer, integer)
  to service_role;

create or replace function public.calculate_comeback_bonus(
  p_round_number integer,
  p_eligible boolean,
  p_guess numeric,
  p_answer numeric
)
returns integer
language sql
immutable
set search_path = ''
as $$
  select case
    when p_round_number not between 5 and 7 then 0
    when not coalesce(p_eligible, false) then 0
    when p_guess is null or p_answer is null then 0
    when p_guess = p_answer then 100
    when p_answer <> 0
      and abs(p_guess - p_answer) / abs(p_answer) <= 0.15 then 100
    else 0
  end;
$$;

revoke all on function public.calculate_comeback_bonus(integer, boolean, numeric, numeric)
  from public, anon, authenticated;
grant execute on function public.calculate_comeback_bonus(integer, boolean, numeric, numeric)
  to service_role;

create or replace function public.snapshot_game_round_start_scores()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- One INSERT...SELECT statement gives every player the same MVCC snapshot.
  -- The rows are immutable and therefore cannot drift as scoring is applied.
  insert into public.game_round_start_scores (
    round_id,
    player_id,
    starting_score,
    leader_starting_score,
    comeback_eligible
  )
  select
    new.id,
    p.id,
    p.score,
    scores.leader_score,
    public.is_comeback_eligible(
      new.round_number,
      p.score,
      scores.leader_score
    )
  from public.players p
  cross join lateral (
    select max(room_player.score)::integer as leader_score
    from public.players room_player
    where room_player.room_id = new.room_id
  ) scores
  where p.room_id = new.room_id
  on conflict (round_id, player_id) do nothing;

  return new;
end;
$$;

revoke all on function public.snapshot_game_round_start_scores() from public;

drop trigger if exists snapshot_game_round_start_scores on public.game_rounds;
create trigger snapshot_game_round_start_scores
after insert on public.game_rounds
for each row
execute function public.snapshot_game_round_start_scores();

alter table public.game_submissions
  add column if not exists comeback_bonus integer not null default 0;

alter table public.game_submissions
  drop constraint if exists game_submissions_comeback_bonus_check;
alter table public.game_submissions
  add constraint game_submissions_comeback_bonus_check
  check (comeback_bonus in (0, 100));

-- Extend the Stage 6.2 reconciliation point. The bonus is calculated from the
-- immutable snapshot, persisted with the submission, and included in earned.
create or replace function public.reconcile_game_submission_score()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_answer numeric;
  v_round_number integer;
  v_eligible boolean := false;
  v_comeback_bonus integer;
  v_balanced_earned integer;
  v_legacy_earned integer := coalesce(new.earned, 0);
begin
  select q.answer, gr.round_number, coalesce(snapshot.comeback_eligible, false)
    into v_answer, v_round_number, v_eligible
  from public.game_rounds gr
  join public.game_questions q on q.id = gr.question_id
  left join public.game_round_start_scores snapshot
    on snapshot.round_id = gr.id
   and snapshot.player_id = new.player_id
  where gr.id = new.round_id;

  if not found then
    raise exception 'Game round answer not found'
      using errcode = '23503';
  end if;

  v_comeback_bonus := public.calculate_comeback_bonus(
    v_round_number,
    v_eligible,
    new.guess::numeric,
    v_answer
  );
  v_balanced_earned := public.calculate_close_call_points(
    new.guess::numeric,
    v_answer,
    new.stake::integer
  ) + v_comeback_bonus;

  if new.earned is not distinct from v_balanced_earned
    and new.comeback_bonus = v_comeback_bonus then
    return null;
  end if;

  update public.game_submissions
  set earned = v_balanced_earned,
      comeback_bonus = v_comeback_bonus
  where id = new.id;

  update public.players
  set score = greatest(0, score - v_legacy_earned + v_balanced_earned)
  where id = new.player_id;

  return null;
end;
$$;

create or replace function public.get_comeback_state(p_room_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_round_id uuid;
  v_round_number integer;
  v_player_id uuid;
  v_eligible boolean := false;
  v_bonuses jsonb := '[]'::jsonb;
begin
  select p.id
    into v_player_id
  from public.players p
  where p.room_id = p_room_id
    and p.user_id = auth.uid();

  if not found then
    raise exception 'You are not a player in this room'
      using errcode = '42501';
  end if;

  select gr.id, gr.round_number
    into v_round_id, v_round_number
  from public.game_rounds gr
  where gr.room_id = p_room_id
  order by gr.round_number desc
  limit 1;

  if v_round_id is null then
    return jsonb_build_object(
      'round', null,
      'eligible', false,
      'bonuses', v_bonuses
    );
  end if;

  select snapshot.comeback_eligible
    into v_eligible
  from public.game_round_start_scores snapshot
  where snapshot.round_id = v_round_id
    and snapshot.player_id = v_player_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'player_id', submission.player_id,
        'comeback_bonus', submission.comeback_bonus
      )
    ),
    '[]'::jsonb
  )
    into v_bonuses
  from public.game_submissions submission
  where submission.round_id = v_round_id;

  return jsonb_build_object(
    'round', v_round_number,
    'eligible', coalesce(v_eligible, false),
    'bonuses', v_bonuses
  );
end;
$$;

revoke all on function public.get_comeback_state(uuid) from public, anon;
grant execute on function public.get_comeback_state(uuid) to authenticated;

comment on table public.game_round_start_scores is
  'Immutable pre-round score snapshots used for deterministic comeback eligibility.';
comment on column public.game_submissions.comeback_bonus is
  'Server-confirmed comeback bonus included in earned; always 0 or 100.';

-- Make the newly created RPC and table visible immediately even when this
-- migration is applied through a workflow that does not auto-refresh PostgREST.
notify pgrst, 'reload schema';
