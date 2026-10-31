begin;

select plan(3);

select col_type_is(
  'public',
  'game_match_history',
  'used_question_ids',
  'bigint[]',
  'archived question IDs match game_questions.id'
);

select matches(
  pg_get_functiondef('public.prepare_rematch(uuid)'::regprocedure),
  'array\[\]::bigint\[\]',
  'prepare_rematch uses a bigint empty-array fallback'
);

select unlike(
  pg_get_functiondef('public.prepare_rematch(uuid)'::regprocedure),
  'array\[\]::uuid\[\]',
  'prepare_rematch no longer contains the UUID fallback'
);

select * from finish();
rollback;
