begin;

select plan(8);

select has_table(
  'public',
  'game_match_history',
  'completed match history is retained'
);

select has_function(
  'public',
  'prepare_rematch',
  array['uuid'],
  'host rematch RPC exists'
);

select function_returns(
  'public',
  'prepare_rematch',
  array['uuid'],
  'void',
  'rematch RPC returns void'
);

select function_privilege_is(
  'public',
  'prepare_rematch',
  array['uuid'],
  'authenticated',
  'EXECUTE',
  true,
  'authenticated users may request an authorized rematch'
);

select function_privilege_is(
  'public',
  'prepare_rematch',
  array['uuid'],
  'anon',
  'EXECUTE',
  false,
  'anonymous users cannot request a rematch'
);

select table_privilege_is(
  'public',
  'game_match_history',
  'authenticated',
  'SELECT',
  false,
  'match archives are not directly exposed'
);

select has_function(
  'public',
  'get_my_latest_room',
  array[]::text[],
  'reconnection RPC includes finished rooms'
);

select function_privilege_is(
  'public',
  'get_my_latest_room',
  array[]::text[],
  'anon',
  'EXECUTE',
  false,
  'anonymous users cannot inspect room membership'
);

select * from finish();
rollback;
