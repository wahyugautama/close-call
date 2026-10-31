# Database baseline recovery

Audit date: 2026-10-25

## Finding

The linked database and the local migration ledger both begin at
`20261023152000_stage_6_1_question_variety.sql`. That migration alters tables
and functions which it does not create. The original room/game schema was
therefore created outside the checked-in migration history. Repository-wide
search and `git log --all -- supabase` found no earlier tracked definition
from which to reconstruct it.

The missing baseline is broader than table DDL. A fresh database needs the
pre-Stage-6 versions of:

- Tables: `rooms`, `players`, `game_questions`, `game_rounds`, and
  `game_submissions`.
- Functions: `create_room(text)`, `join_room(text,text)`, `start_game(uuid)`,
  `submit_guess(uuid,bigint,integer)`, `advance_game(uuid)`,
  `get_game_state(uuid)`, `get_my_active_room()`, `get_room_players(uuid)`,
  `is_room_member(uuid)`, and the legacy `calculate_round_score(...)` helper.
- The original constraints, foreign keys, indexes, grants, RLS enablement, and
  member-read policies on `rooms`, `players`, and `game_rounds`.

The later migrations correctly own these additions and must not be copied into
the baseline:

- Stage 6.1: question metadata, selection index, balancing function/trigger.
- Stage 6.2: betting helpers, stake trigger, submission uniqueness, deferred
  score reconciliation, and direct submission revocation.
- Stage 6.3: round-start score snapshots and comeback state.
- Stage 6.4 plus two corrections: submission pacing trigger behavior.
- Stage 6.5: match history and rematch functions.
- The two 2026-10-25 corrections: `used_question_ids bigint[]` and the matching
  balancing-function local type.

## Live verification

Read-only catalog queries confirmed:

- Seven deployed tables exist. Question IDs and round question IDs are
  `bigint`; match-history `used_question_ids` is `bigint[]`.
- `rooms`, `players`, `game_questions`, `game_rounds`, and `game_submissions`
  have RLS enabled. Member SELECT policies exist only on `rooms`, `players`,
  and `game_rounds`. Hidden question/submission tables have no client table
  privileges.
- `game_round_start_scores` and `game_match_history` do not have RLS enabled,
  but neither `anon` nor `authenticated` has table privileges on them.
- Core RPCs are `SECURITY DEFINER` with `search_path = ''`.
  `authenticated` can execute them. `anon` cannot execute gameplay/state RPCs;
  `create_room` and `join_room` are executable by `anon`/PUBLIC but both reject
  a null `auth.uid()` internally.
- `submit_guess` authenticates the caller, resolves membership by
  `(room_id,user_id)`, locks the room, requires question phase, and rejects at
  or after the deadline. The unique round/player index provides the final
  duplicate-submission guard.
- `advance_game` authenticates membership, locks both room and current round,
  and gates transitions on the current phase and deadline. Concurrent calls
  serialize and do not skip a phase/round.
- `get_game_state` checks membership and emits the answer only when its
  `v_revealed` condition is true; that condition is tied to reveal/leaderboard
  phases.
- `join_room` locks the lobby room and returns the existing room ID when the
  authenticated user is already a member, before inserting a new player.

The linked CLI linter completed with one non-security warning in `create_room`:
the integer loop variable `v_attempt` shadows/duplicates a declared unused
variable.

## Safe recovery strategy

Do not generate a baseline by dumping the current schema wholesale. Doing so
would place Stage 6 objects before the migrations that create them and would
cause conflicts or silently lose migration-order coverage.

1. Obtain a schema-only dump of the linked database and retain it as audit
   evidence (not as an apply-ready migration).
2. Recover the last pre-Stage-6 definitions from project history if available.
   Compare every recovered object with the deployed catalog definitions.
3. Create one migration timestamped before `20261023152000` containing only
   the pre-Stage-6 objects listed above. Preserve exact security clauses,
   ownership-independent grants, constraints, and policy expressions.
4. Make the baseline safe for the already-initialized production project by
   using a narrowly scoped bootstrap guard around baseline creation. The guard
   must no-op only when all expected baseline objects already exist and match
   verified signatures; it must raise on a partial/incompatible schema.
5. Start local Supabase, run `supabase db reset`, then run pgTAP tests and a
   schema diff. The final local schema must match the inspected deployed schema
   after all later migrations run.
6. Review the guarded baseline SQL separately before any remote push. Do not
   use `migration repair` merely to hide the new earlier timestamp.

No baseline migration has been created yet because the CLI schema dump could
not run without a Docker-compatible runtime, and synthesizing the security-
critical baseline from partial catalog output would be unsafe.

## Next commands

After starting Docker Desktop (or another Docker-compatible runtime):

```sh
mkdir -p supabase/audit
npx --yes supabase@latest db dump --linked --schema public \
  --file supabase/audit/linked-public-schema-20261025.sql
npx --yes supabase@latest start
npx --yes supabase@latest db reset
npx --yes supabase@latest test db
npx --yes supabase@latest db diff --local --schema public
```

Treat the dump as sensitive operational source and review it before deciding
whether it belongs in version control. Do not run `db push` until the guarded
baseline has been reviewed and fresh-database replay succeeds.
