-- Close Call Stage 6.1: server-side question variety and balancing.
--
-- The existing start_game/advance_game RPC signatures remain unchanged. Both
-- RPCs create game_rounds rows, so a trigger is the narrowest reliable place
-- to apply the selection policy while preserving the current game lifecycle.

alter table public.game_questions
  add column if not exists category text not null default 'general',
  add column if not exists difficulty text not null default 'medium',
  add column if not exists last_used_at timestamptz,
  add column if not exists use_count bigint not null default 0;

alter table public.game_questions
  drop constraint if exists game_questions_difficulty_check;

alter table public.game_questions
  add constraint game_questions_difficulty_check
  check (difficulty in ('easy', 'medium', 'hard'));

alter table public.game_questions
  drop constraint if exists game_questions_category_not_blank;

alter table public.game_questions
  add constraint game_questions_category_not_blank
  check (btrim(category) <> '');

create index if not exists game_questions_selection_idx
  on public.game_questions (difficulty, last_used_at, use_count);

create or replace function public.question_difficulty_for_round(
  p_round_number integer
)
returns text
language sql
immutable
strict
set search_path = ''
as $$
  select case
    when p_round_number between 1 and 2 then 'easy'
    when p_round_number between 3 and 5 then 'medium'
    when p_round_number between 6 and 7 then 'hard'
    else null
  end;
$$;

revoke all on function public.question_difficulty_for_round(integer) from public;
grant execute on function public.question_difficulty_for_round(integer) to service_role;

create or replace function public.balance_game_round_question()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_question_id public.game_questions.id%type;
  v_previous_category text;
  v_target_difficulty text;
begin
  -- Preserve non-game/setup uses of the table, if any.
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

  -- A row lock serializes recency updates. SKIP LOCKED lets simultaneous games
  -- choose another good candidate rather than waiting on the same question.
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
    (v_previous_category is not null and q.category = v_previous_category),
    (q.last_used_at is not null),
    q.last_used_at asc nulls first,
    q.use_count asc,
    random()
  for update of q skip locked
  limit 1;

  if v_question_id is null then
    raise exception 'No unused questions remain for room % round %',
      new.room_id, new.round_number
      using errcode = 'P0001';
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

drop trigger if exists balance_game_round_question on public.game_rounds;
create trigger balance_game_round_question
before insert on public.game_rounds
for each row
execute function public.balance_game_round_question();

-- Supplement the existing bank with enough categorized questions to guarantee
-- the intended 2/3/2 curve on databases whose legacy questions all receive the
-- backward-compatible "medium/general" defaults.
insert into public.game_questions (question, answer, explanation, category, difficulty)
select seed.question, seed.answer, seed.explanation, seed.category, seed.difficulty
from (values
  ('How many minutes are in one day?', 1440, 'There are 24 hours in a day and 60 minutes in each hour.', 'time', 'easy'),
  ('How many squares are on a standard chessboard?', 64, 'A standard chessboard has 8 rows and 8 columns.', 'games', 'easy'),
  ('How many bones are in a typical adult human body?', 206, 'A typical adult human skeleton has 206 bones.', 'science', 'easy'),
  ('How many keys are on a standard piano?', 88, 'A standard modern piano has 52 white keys and 36 black keys.', 'music', 'easy'),
  ('How many degrees are in a full circle?', 360, 'One complete rotation measures 360 degrees.', 'math', 'easy'),
  ('How many players from one team are on the field in association football?', 11, 'Each team fields 11 players, including the goalkeeper.', 'sports', 'easy'),

  ('How many minutes are in a non-leap year?', 525600, 'Multiplying 365 days by 24 hours and 60 minutes gives 525,600.', 'time', 'medium'),
  ('How many total dots are on a standard pair of six-sided dice?', 42, 'Each die has 21 pips across its six faces, so a pair has 42.', 'games', 'medium'),
  ('How many elements are in the periodic table?', 118, 'The currently recognized periodic table contains 118 elements.', 'science', 'medium'),
  ('How many strings does a concert harp typically have?', 47, 'A modern concert pedal harp typically has 47 strings.', 'music', 'medium'),
  ('How many distinct permutations are there of four different objects?', 24, 'Four factorial is 4 × 3 × 2 × 1, which equals 24.', 'math', 'medium'),
  ('How many events are in a decathlon?', 10, 'The name and competition format both specify ten events.', 'sports', 'medium'),
  ('How many cards are in a standard deck including two jokers?', 54, 'A standard 52-card deck plus two jokers contains 54 cards.', 'games', 'medium'),
  ('How many chromosomes are normally present in a human body cell?', 46, 'Human somatic cells normally contain 23 chromosome pairs.', 'science', 'medium'),
  ('How many semitones are in two octaves in twelve-tone equal temperament?', 24, 'Each octave contains 12 semitones.', 'music', 'medium'),

  ('How many seconds are in a non-leap year?', 31536000, '365 × 24 × 60 × 60 equals 31,536,000 seconds.', 'time', 'hard'),
  ('How many possible five-card hands can be dealt from a standard 52-card deck?', 2598960, 'The combination 52 choose 5 equals 2,598,960.', 'games', 'hard'),
  ('Approximately how many kilometres is the equatorial circumference of Earth?', 40075, 'Earth’s equatorial circumference is approximately 40,075 kilometres.', 'science', 'hard'),
  ('How many possible melodies of four notes exist if each note can be any of 12 pitches and repetition is allowed?', 20736, 'There are 12 choices for each of four positions: 12 to the fourth power.', 'music', 'hard'),
  ('How many distinct arrangements are there of eight different objects?', 40320, 'Eight factorial equals 40,320.', 'math', 'hard'),
  ('How many metres long is an Olympic marathon?', 42195, 'The official marathon distance is 42.195 kilometres.', 'sports', 'hard')
) as seed(question, answer, explanation, category, difficulty)
where not exists (
  select 1
  from public.game_questions existing
  where existing.question = seed.question
);

-- Keep the answer bank private. Reveals continue to flow exclusively through
-- get_game_state, whose existing phase checks are intentionally unchanged.
revoke select on public.game_questions from anon, authenticated;

comment on column public.game_questions.category is
  'Question topic used to avoid consecutive category repeats.';
comment on column public.game_questions.difficulty is
  'Selection tier: easy, medium, or hard.';
comment on column public.game_questions.last_used_at is
  'Global recency signal used only to improve cross-game replayability.';
comment on function public.balance_game_round_question() is
  'Selects one server-side question per game round with difficulty, variety, uniqueness, and scarcity fallbacks.';
