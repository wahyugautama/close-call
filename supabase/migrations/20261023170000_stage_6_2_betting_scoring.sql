-- Close Call Stage 6.2: deterministic server-side betting and scoring.
--
-- Legacy multiplayer scoring is retained as the phase-transition mechanism.
-- A deferred trigger replaces its earned value at transaction end and adjusts
-- the player score by the difference. Deferral is important: it runs after the
-- existing advance_game transaction has completed all of its score writes.
-- Scores retain the existing zero-point floor.

create or replace function public.calculate_close_call_points(
  p_guess numeric,
  p_answer numeric,
  p_stake integer
)
returns integer
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_error_ratio numeric;
  v_base_points integer;
  v_stake_points integer := 0;
begin
  if p_guess is null then
    return 0;
  end if;

  if p_answer is null then
    raise exception 'A correct answer is required for scoring'
      using errcode = '22004';
  end if;

  if p_stake not in (0, 100, 250) then
    raise exception 'Stake must be 0, 100, or 250'
      using errcode = '22023';
  end if;

  -- Zero has no meaningful relative-error denominator. Zero guesses are exact;
  -- every nonzero guess is treated as outside all accuracy bands.
  if p_answer = 0 then
    v_error_ratio := null;
  else
    v_error_ratio := abs(p_guess - p_answer) / abs(p_answer);
  end if;

  v_base_points := case
    when p_guess = p_answer then 300
    when v_error_ratio <= 0.05 then 200
    when v_error_ratio <= 0.15 then 120
    when v_error_ratio <= 0.30 then 60
    else 0
  end;

  v_stake_points := case
    when p_stake = 0 then 0
    when p_stake = 100
      and (p_guess = p_answer or v_error_ratio <= 0.15) then 100
    when p_stake = 100 then -100
    when p_stake = 250
      and (p_guess = p_answer or v_error_ratio <= 0.05) then 250
    when p_stake = 250 then -250
  end;

  return v_base_points + v_stake_points;
end;
$$;

revoke all on function public.calculate_close_call_points(numeric, numeric, integer)
  from public, anon, authenticated;
grant execute on function public.calculate_close_call_points(numeric, numeric, integer)
  to service_role;

create or replace function public.can_afford_close_call_stake(
  p_score integer,
  p_stake integer
)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select p_stake in (0, 100, 250) and p_stake <= p_score;
$$;

revoke all on function public.can_afford_close_call_stake(integer, integer)
  from public, anon, authenticated;
grant execute on function public.can_afford_close_call_stake(integer, integer)
  to service_role;

create or replace function public.validate_game_submission_stake()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_score integer;
begin
  if tg_op = 'UPDATE' then
    if new.guess is distinct from old.guess
      or new.stake is distinct from old.stake then
      raise exception 'Submitted guesses and stakes cannot be changed'
        using errcode = '23514';
    end if;

    return new;
  end if;

  if new.stake not in (0, 100, 250) then
    raise exception 'Stake must be 0, 100, or 250'
      using errcode = '22023';
  end if;

  select p.score
    into v_score
  from public.players p
  where p.id = new.player_id
  for update;

  if not found then
    raise exception 'Player not found'
      using errcode = '23503';
  end if;

  if not public.can_afford_close_call_stake(v_score, new.stake) then
    raise exception 'Insufficient points for stake'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_game_submission_stake() from public;

drop trigger if exists validate_game_submission_stake on public.game_submissions;
create trigger validate_game_submission_stake
before insert or update on public.game_submissions
for each row
execute function public.validate_game_submission_stake();

-- The existing submission RPC already rejects duplicates. This database-level
-- invariant also protects simultaneous requests that race before either sees
-- the other's row.
create unique index if not exists game_submissions_round_player_unique
  on public.game_submissions (round_id, player_id);

create or replace function public.reconcile_game_submission_score()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_answer numeric;
  v_balanced_earned integer;
  v_legacy_earned integer := coalesce(new.earned, 0);
begin
  select q.answer
    into v_answer
  from public.game_rounds gr
  join public.game_questions q on q.id = gr.question_id
  where gr.id = new.round_id;

  if not found then
    raise exception 'Game round answer not found'
      using errcode = '23503';
  end if;

  v_balanced_earned := public.calculate_close_call_points(
    new.guess::numeric,
    v_answer,
    new.stake::integer
  );

  if new.earned is not distinct from v_balanced_earned then
    return null;
  end if;

  update public.game_submissions
  set earned = v_balanced_earned
  where id = new.id;

  -- advance_game has already applied v_legacy_earned by the time this deferred
  -- trigger runs. Replace only that delta and retain the established score floor.
  update public.players
  set score = greatest(0, score - v_legacy_earned + v_balanced_earned)
  where id = new.player_id;

  return null;
end;
$$;

revoke all on function public.reconcile_game_submission_score() from public;

drop trigger if exists reconcile_game_submission_score on public.game_submissions;
create constraint trigger reconcile_game_submission_score
after update on public.game_submissions
deferrable initially deferred
for each row
when (old.earned is distinct from new.earned)
execute function public.reconcile_game_submission_score();

-- Answers, guesses, stakes, and earned points remain available only through
-- the phase-aware RPCs. Clients cannot write an earned value directly.
revoke all on public.game_submissions from anon, authenticated;

comment on function public.calculate_close_call_points(numeric, numeric, integer) is
  'Stage 6.2 scoring: 300/200/120/60 accuracy points plus the selected stake outcome.';
comment on function public.can_afford_close_call_stake(integer, integer) is
  'True only for an allowed stake that does not exceed the player score.';
comment on function public.reconcile_game_submission_score() is
  'Replaces legacy earned points once, after advance_game completes its atomic phase transition.';
