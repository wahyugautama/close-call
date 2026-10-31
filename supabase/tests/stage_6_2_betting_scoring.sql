begin;

select plan(37);

-- Accuracy boundaries, stake 0.
select is(public.calculate_close_call_points(100, 100, 0), 300, 'exact answer');
select is(public.calculate_close_call_points(104, 100, 0), 200, '4 percent error');
select is(public.calculate_close_call_points(105, 100, 0), 200, '5 percent error');
select is(public.calculate_close_call_points(106, 100, 0), 120, '6 percent error');
select is(public.calculate_close_call_points(114, 100, 0), 120, '14 percent error');
select is(public.calculate_close_call_points(115, 100, 0), 120, '15 percent error');
select is(public.calculate_close_call_points(116, 100, 0), 60, '16 percent error');
select is(public.calculate_close_call_points(129, 100, 0), 60, '29 percent error');
select is(public.calculate_close_call_points(130, 100, 0), 60, '30 percent error');
select is(public.calculate_close_call_points(131, 100, 0), 0, '31 percent error');

-- Zero-answer and missing-guess behavior.
select is(public.calculate_close_call_points(0, 0, 0), 300, 'zero answer exact match');
select is(public.calculate_close_call_points(1, 0, 0), 0, 'zero answer nonzero guess misses');
select is(public.calculate_close_call_points(null, 100, 0), 0, 'null guess earns zero');

-- Stake 0 never changes base points.
select is(public.calculate_close_call_points(100, 100, 0), 300, 'safe exact earns base only');
select is(public.calculate_close_call_points(120, 100, 0), 60, 'safe miss has no loss');

-- Stake 100 succeeds through 15 percent and otherwise loses 100.
select is(public.calculate_close_call_points(100, 100, 100), 400, '100 stake exact');
select is(public.calculate_close_call_points(105, 100, 100), 300, '100 stake at 5 percent');
select is(public.calculate_close_call_points(115, 100, 100), 220, '100 stake at 15 percent');
select is(public.calculate_close_call_points(116, 100, 100), -40, '100 stake outside 15 percent');
select is(public.calculate_close_call_points(200, 100, 100), -100, '100 stake complete miss');

-- Stake 250 succeeds through 5 percent and otherwise loses 250.
select is(public.calculate_close_call_points(100, 100, 250), 550, '250 stake exact');
select is(public.calculate_close_call_points(104, 100, 250), 450, '250 stake at 4 percent');
select is(public.calculate_close_call_points(105, 100, 250), 450, '250 stake at 5 percent');
select is(public.calculate_close_call_points(106, 100, 250), -130, '250 stake at 6 percent');
select is(public.calculate_close_call_points(200, 100, 250), -250, '250 stake complete miss');
select is(public.calculate_close_call_points(0, 0, 250), 550, '250 stake wins on exact zero');
select is(public.calculate_close_call_points(1, 0, 250), -250, '250 stake loses on nonzero zero-answer guess');

select throws_ok(
  $$select public.calculate_close_call_points(100, 100, 50)$$,
  '22023', 'Stake must be 0, 100, or 250',
  'invalid stake is rejected'
);

select ok(public.can_afford_close_call_stake(0, 0), 'zero stake is always affordable');
select ok(not public.can_afford_close_call_stake(99, 100), '100 stake rejects 99 points');
select ok(public.can_afford_close_call_stake(100, 100), '100 stake accepts 100 points');
select ok(not public.can_afford_close_call_stake(249, 250), '250 stake rejects 249 points');
select ok(public.can_afford_close_call_stake(250, 250), '250 stake accepts 250 points');

select has_index(
  'public', 'game_submissions', 'game_submissions_round_player_unique',
  'duplicate submissions are prevented per player and round'
);
select has_trigger(
  'public', 'game_submissions', 'validate_game_submission_stake',
  'stake values and affordability are validated server-side'
);
select ok(
  (
    select tgdeferrable and tginitdeferred
    from pg_trigger
    where tgrelid = 'public.game_submissions'::regclass
      and tgname = 'reconcile_game_submission_score'
  ),
  'score reconciliation waits until concurrent phase-transition writes finish'
);
select has_trigger(
  'public', 'game_submissions', 'reconcile_game_submission_score',
  'earned points and player totals are reconciled server-side'
);

select * from finish();
rollback;
