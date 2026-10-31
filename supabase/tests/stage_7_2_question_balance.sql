begin;

select plan(4);

select col_type_is(
  'public',
  'game_match_history',
  'used_question_ids',
  'bigint[]',
  'archived question IDs are bigint[]'
);

select matches(
  pg_get_functiondef('public.balance_game_round_question()'::regprocedure),
  'v_previous_match_questions bigint\[\]',
  'question balancing declares a bigint history array'
);

select matches(
  pg_get_functiondef('public.balance_game_round_question()'::regprocedure),
  'array\[\]::bigint\[\]',
  'question balancing uses a bigint empty-array fallback'
);

select unlike(
  pg_get_functiondef('public.balance_game_round_question()'::regprocedure),
  'v_previous_match_questions uuid\[\]',
  'question balancing no longer declares a UUID history array'
);

select * from finish();
rollback;
