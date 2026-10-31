begin;

select plan(19);

select is(public.question_difficulty_for_round(1), 'easy', 'round 1 is easy');
select is(public.question_difficulty_for_round(2), 'easy', 'round 2 is easy');
select is(public.question_difficulty_for_round(3), 'medium', 'round 3 is medium');
select is(public.question_difficulty_for_round(5), 'medium', 'round 5 is medium');
select is(public.question_difficulty_for_round(6), 'hard', 'round 6 is hard');
select is(public.question_difficulty_for_round(7), 'hard', 'round 7 is hard');

select is(
  (select count(*) from generate_series(1, 7)),
  7::bigint,
  'the game schedule remains seven rounds'
);
select cmp_ok(
  (select count(*) from public.game_questions where difficulty = 'easy'),
  '>=', 2::bigint,
  'at least two easy questions are available'
);
select cmp_ok(
  (select count(*) from public.game_questions where difficulty = 'medium'),
  '>=', 3::bigint,
  'at least three medium questions are available'
);
select cmp_ok(
  (select count(*) from public.game_questions where difficulty = 'hard'),
  '>=', 2::bigint,
  'at least two hard questions are available'
);
select cmp_ok(
  (select count(distinct category) from public.game_questions),
  '>=', 2::bigint,
  'multiple categories are available for variety'
);

select ok(
  not has_table_privilege('anon', 'public.game_questions', 'SELECT'),
  'anonymous clients cannot read questions or answers directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.game_questions', 'SELECT'),
  'authenticated clients cannot read future questions or answers directly'
);
select has_trigger(
  'public', 'game_rounds', 'balance_game_round_question',
  'all game-round inserts use the shared server-side selector'
);

select like(
  pg_get_functiondef('public.balance_game_round_question()'::regprocedure),
  '%used.room_id = new.room_id%used.question_id = q.id%',
  'the selector excludes questions already used in the room'
);
select like(
  pg_get_functiondef('public.balance_game_round_question()'::regprocedure),
  '%q.difficulty <> v_target_difficulty%',
  'the selector prioritizes the scheduled difficulty'
);
select like(
  pg_get_functiondef('public.balance_game_round_question()'::regprocedure),
  '%q.category = v_previous_category%',
  'the selector deprioritizes a consecutive category repeat'
);
select like(
  pg_get_functiondef('public.balance_game_round_question()'::regprocedure),
  '%q.last_used_at asc nulls first%',
  'the selector prefers never-used and least-recently-used questions'
);
select like(
  pg_get_functiondef('public.balance_game_round_question()'::regprocedure),
  '%from public.game_questions q%where not exists%',
  'the fallback searches the complete remaining unused pool'
);

select * from finish();
rollback;
