begin;

select plan(5);

select has_function(
  'public',
  'advance_game_when_all_submitted',
  array[]::text[],
  'server-side completion function exists'
);

select function_returns(
  'public',
  'advance_game_when_all_submitted',
  array[]::text[],
  'trigger',
  'completion function is a trigger'
);

select has_trigger(
  'public',
  'game_submissions',
  'advance_game_when_all_submitted',
  'each accepted submission checks server-side completion'
);

select is(
  (
    select t.tgenabled
    from pg_catalog.pg_trigger t
    where t.tgrelid = 'public.game_submissions'::regclass
      and t.tgname = 'advance_game_when_all_submitted'
  ),
  'O'::char,
  'completion trigger is enabled'
);

select function_privilege_is(
  'public',
  'advance_game_when_all_submitted',
  array[]::text[],
  'public',
  'EXECUTE',
  false,
  'completion trigger is not client-callable'
);

select * from finish();
rollback;
