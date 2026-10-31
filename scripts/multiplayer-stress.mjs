import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_TEST_URL;
const anonKey = process.env.SUPABASE_TEST_ANON_KEY;
const destructiveOptIn = process.env.SUPABASE_TEST_ALLOW_DESTRUCTIVE === "1";

if (!url || !anonKey || !destructiveOptIn) {
  throw new Error(
    "Set SUPABASE_TEST_URL, SUPABASE_TEST_ANON_KEY, and SUPABASE_TEST_ALLOW_DESTRUCTIVE=1 for a disposable project.",
  );
}

const targetRef = new URL(url).hostname.split(".")[0];

try {
  const linkedRef = (
    await readFile(new URL("../supabase/.temp/project-ref", import.meta.url), "utf8")
  ).trim();

  assert.notEqual(
    targetRef,
    linkedRef,
    "Refusing to run stress tests against the repository's linked Supabase project.",
  );
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

const makeClient = () =>
  createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

async function createPlayer(label) {
  const client = makeClient();
  const { data, error } = await client.auth.signInAnonymously();
  assert.ifError(error);
  assert.ok(data.user, `${label} receives a separate anonymous identity`);
  return { client, user: data.user };
}

async function rpc(client, name, args) {
  const response = await client.rpc(name, args);
  if (response.error) throw response.error;
  return response.data;
}

const runId = Date.now().toString(36).slice(-6);
const host = await createPlayer("host");
const guestA = await createPlayer("guest A");
const guestB = await createPlayer("guest B");

assert.notEqual(host.user.id, guestA.user.id);
assert.notEqual(guestA.user.id, guestB.user.id);

const roomCode = await rpc(host.client, "create_room", {
  p_nickname: `Host-${runId}`,
});
assert.match(roomCode, /^[A-HJ-NP-Z2-9]{4}$/);

await Promise.all([
  rpc(guestA.client, "join_room", {
    p_code: roomCode,
    p_nickname: `GuestA-${runId}`,
  }),
  rpc(guestB.client, "join_room", {
    p_code: roomCode,
    p_nickname: `GuestB-${runId}`,
  }),
]);

// A repeated join may be idempotent or explicitly rejected, but it must never
// create a second membership row for the same authenticated user.
await guestA.client.rpc("join_room", {
  p_code: roomCode,
  p_nickname: `GuestA-${runId}`,
});

const { data: room, error: roomError } = await host.client
  .from("rooms")
  .select("id")
  .eq("code", roomCode)
  .single();
assert.ifError(roomError);

const { data: members, error: membersError } = await host.client
  .from("players")
  .select("id,user_id")
  .eq("room_id", room.id);
assert.ifError(membersError);
assert.equal(members.filter((member) => member.user_id === guestA.user.id).length, 1);

const unauthorizedStart = await guestA.client.rpc("start_game", {
  p_room_id: room.id,
});
assert.ok(unauthorizedStart.error, "a non-host cannot start the match");

const startAttempts = await Promise.all([
  host.client.rpc("start_game", { p_room_id: room.id }),
  host.client.rpc("start_game", { p_room_id: room.id }),
]);
assert.ok(startAttempts.some((attempt) => !attempt.error));

const initialState = await rpc(host.client, "get_game_state", {
  p_room_id: room.id,
});
assert.equal(initialState.status, "playing");
assert.equal(initialState.round, 1);
assert.equal(initialState.phase, "question");

const invalidStake = await guestA.client.rpc("submit_guess", {
  p_room_id: room.id,
  p_guess: "100",
  p_stake: 50,
});
assert.ok(invalidStake.error, "invalid stakes are rejected");

const duplicateSubmissions = await Promise.all([
  guestA.client.rpc("submit_guess", {
    p_room_id: room.id,
    p_guess: "9223372036854775807",
    p_stake: 0,
  }),
  guestA.client.rpc("submit_guess", {
    p_room_id: room.id,
    p_guess: "9223372036854775807",
    p_stake: 0,
  }),
]);
assert.equal(
  duplicateSubmissions.filter((attempt) => !attempt.error).length,
  1,
  "exactly one simultaneous submission succeeds for a player and round",
);

await Promise.all([
  rpc(host.client, "submit_guess", {
    p_room_id: room.id,
    p_guess: "0",
    p_stake: 0,
  }),
  rpc(guestB.client, "submit_guess", {
    p_room_id: room.id,
    p_guess: "1",
    p_stake: 100,
  }),
]);

await Promise.allSettled(
  [host, guestA, guestB].map(({ client }) =>
    client.rpc("advance_game", { p_room_id: room.id }),
  ),
);

const settledState = await rpc(host.client, "get_game_state", {
  p_room_id: room.id,
});
assert.equal(settledState.round, 1, "concurrent advancement does not skip a round");
assert.notEqual(settledState.phase, "question", "all submissions expire the question");
assert.equal(
  new Set(settledState.results.map((result) => result.player_id)).size,
  3,
  "one result exists per player",
);
assert.ok(
  settledState.players.every((player) => player.score >= 0),
  "confirmed scores retain the zero floor",
);

console.log(`Stress harness passed for disposable room ${roomCode}.`);
