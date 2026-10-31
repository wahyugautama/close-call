begin;

select plan(18);

select ok(
  exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'create_room'),
  'create_room exists'
);
select ok(
  exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'join_room'),
  'join_room exists'
);
select has_function('public', 'start_game', array['uuid'], 'start_game exists');
select ok(
  exists (
    select 1
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname = 'submit_guess'
      and proargnames @> array['p_room_id', 'p_guess', 'p_stake']::text[]
  ),
  'submit_guess exposes the frontend parameter names'
);
select has_function('public', 'advance_game', array['uuid'], 'advance_game exists');
select has_function('public', 'get_game_state', array['uuid'], 'get_game_state exists');
select has_function('public', 'prepare_rematch', array['uuid'], 'prepare_rematch exists');

select has_index(
  'public', 'game_submissions', 'game_submissions_round_player_unique',
  'one submission is enforced per player and round'
);
select has_trigger(
  'public', 'game_submissions', 'validate_game_submission_stake',
  'submission stakes are validated transactionally'
);
select has_trigger(
  'public', 'game_submissions', 'reconcile_game_submission_score',
  'confirmed scores are reconciled server-side'
);
select has_trigger(
  'public', 'game_submissions', 'advance_game_when_all_submitted',
  'the final accepted submission expires the question'
);

select col_type_is(
  'public', 'game_questions', 'id', 'bigint',
  'question primary keys are bigint'
);
select col_type_is(
  'public', 'game_rounds', 'question_id', 'bigint',
  'round question references are bigint'
);
select col_type_is(
  'public', 'game_match_history', 'used_question_ids', 'bigint[]',
  'archived question identifiers are bigint arrays'
);

select matches(
  pg_get_functiondef('public.prepare_rematch(uuid)'::regprocedure),
  'for update',
  'rematch preparation locks its room row'
);
select matches(
  pg_get_functiondef('public.prepare_rematch(uuid)'::regprocedure),
  'v_room.host_id <> auth.uid\(\)',
  'rematch preparation enforces host authorization'
);
select matches(
  pg_get_functiondef('public.balance_game_round_question()'::regprocedure),
  'v_previous_match_questions bigint\[\]',
  'question balancing cannot regress to uuid question arrays'
);
select ok(
  not has_table_privilege('authenticated', 'public.game_submissions', 'INSERT'),
  'authenticated clients cannot bypass submit_guess with direct inserts'
);

select * from finish();
rollback;
