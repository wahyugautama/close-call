begin;

select plan(20);

select ok(not public.is_comeback_eligible(1, 0, 1000), 'round 1 is ineligible');
select ok(not public.is_comeback_eligible(4, 0, 1000), 'round 4 is ineligible');
select ok(public.is_comeback_eligible(5, 700, 1000), 'exactly 30 percent behind qualifies');
select ok(not public.is_comeback_eligible(5, 701, 1000), 'less than 30 percent behind does not qualify');
select ok(not public.is_comeback_eligible(5, 1000, 1000), 'leader and tied leaders are ineligible');
select ok(not public.is_comeback_eligible(7, 0, 0), 'zero-point leader disables eligibility');
select ok(public.is_comeback_eligible(6, 350, 500), 'round 6 supports eligibility');
select ok(public.is_comeback_eligible(7, 350, 500), 'round 7 supports eligibility');

select is(public.calculate_comeback_bonus(4, true, 100, 100), 0, 'rounds 1-4 award no bonus');
select is(public.calculate_comeback_bonus(5, true, 100, 100), 100, 'eligible accurate round 5 guess earns bonus');
select is(public.calculate_comeback_bonus(5, false, 100, 100), 0, 'ineligible accurate player earns no bonus');
select is(public.calculate_comeback_bonus(5, true, null, 100), 0, 'missing guess earns no bonus');
select is(public.calculate_comeback_bonus(5, true, 115, 100), 100, '15 percent boundary qualifies');
select is(public.calculate_comeback_bonus(5, true, 116, 100), 0, 'above 15 percent does not qualify');
select is(public.calculate_comeback_bonus(5, true, 0, 0), 100, 'exact zero answer qualifies');
select is(public.calculate_comeback_bonus(5, true, 1, 0), 0, 'nonzero guess against zero answer misses');

select is(
  public.calculate_close_call_points(115, 100, 250)
    + public.calculate_comeback_bonus(5, true, 115, 100),
  -30,
  'bonus adds to Stage 6.2 scoring without changing its stake rules'
);
select has_trigger(
  'public', 'game_rounds', 'snapshot_game_round_start_scores',
  'round-start scores are snapshotted server-side'
);
select has_column(
  'public', 'game_submissions', 'comeback_bonus',
  'the server persists the awarded bonus breakdown'
);
select ok(
  (
    select tgdeferrable and tginitdeferred
    from pg_trigger
    where tgrelid = 'public.game_submissions'::regclass
      and tgname = 'reconcile_game_submission_score'
  ),
  'duplicate or concurrent advancement uses deferred idempotent reconciliation'
);

select * from finish();
rollback;
