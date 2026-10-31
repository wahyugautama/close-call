# Database tests

Run these after starting the local Supabase stack and applying migrations:

```sh
supabase db reset
supabase test db
```

`stage_6_1_question_variety.sql` verifies the seven-round difficulty mapping,
pool capacity/category variety, answer-bank privacy, and the selector contracts
for room uniqueness, category rotation, recency, and scarcity fallback. It also
verifies that every round insert passes through the one shared server-side
selector, which persists one question for every player in the room.

`stage_6_2_betting_scoring.sql` exercises every accuracy boundary, zero and
null handling, all stake outcomes, invalid stakes, duplicate protection, and
the server-side validation/reconciliation triggers. Affordability and concurrent
phase advancement remain transactional invariants of the existing RPC and are
additionally protected by row locking and the round/player unique index.

`stage_6_3_underdog_comeback.sql` covers early-round exclusion, the exact
30-percent eligibility boundary, ties and zero-score leaders, missing guesses,
the 15-percent accuracy boundary, Stage 6.2 composition, snapshot creation,
persisted bonus breakdowns, and deferred concurrent reconciliation.

`stage_6_4_smart_game_pacing.sql` verifies that accepted submissions pass
through the non-client-callable server completion trigger used to serialize
early question advancement.

`stage_6_5_rematches.sql` verifies the private match archive, authenticated
host rematch RPC contract, and finished-room reconnection RPC permissions.

`stage_7_2_prepare_rematch.sql` verifies that rematch question-history IDs and
the `prepare_rematch` fallback match the deployed bigint question primary key.

`stage_7_2_question_balance.sql` verifies that the question-selection trigger
compares the bigint question primary key with a bigint history array.

`stage_7_8_multiplayer_hardening.sql` verifies the core RPC surface, submission
invariants, score/phase triggers, rematch locking and authorization, direct
write restrictions, and bigint question-ID consistency.

The opt-in client concurrency harness uses separate anonymous sessions and must
only target a disposable Supabase project. It refuses the repository's linked
project reference:

```sh
SUPABASE_TEST_URL=https://DISPOSABLE_REF.supabase.co \
SUPABASE_TEST_ANON_KEY=... \
SUPABASE_TEST_ALLOW_DESTRUCTIVE=1 \
npm run test:multiplayer
```

The harness intentionally leaves its generated room in the disposable project;
reset or delete that disposable project after the run.
