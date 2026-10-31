-- Fix PostgreSQL 42883 during round creation. The deployed question and
-- archived question-history identifiers are bigint, so the trigger-local
-- comparison array must use the same type.

create or replace function public.balance_game_round_question()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_question_id public.game_questions.id%type;
  v_previous_category text;
  v_previous_match_questions bigint[] := array[]::bigint[];
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
    array[]::bigint[]
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

notify pgrst, 'reload schema';
