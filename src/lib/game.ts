import { supabase } from "./supabase";

export type GamePlayer = {
  id: string;
  user_id: string;
  nickname: string;
  score: number;
};

export type GameResult = {
  player_id: string;
  nickname: string;
  guess: number | null;
  stake: number | null;
  earned: number;
};

export type GameState = {
  status: "lobby" | "playing" | "finished";
  round?: number;
  phase?: "question" | "reveal" | "leaderboard";
  deadline?: string;
  server_time: string;
  question?: string;
  answer?: number | null;
  explanation?: string | null;
  players: GamePlayer[];
  submitted_count?: number;
  total_players?: number;
  my_submission?: {
    guess: number;
    stake: number;
  } | null;
  results?: GameResult[] | null;
};

export async function getGameState(roomId: string): Promise<GameState> {
  const { data, error } = await supabase.rpc("get_game_state", {
    p_room_id: roomId,
  });

  if (error) throw error;
  return data as GameState;
}

export async function submitOnlineGuess(
  roomId: string,
  guess: number,
  stake: number,
) {
  const { error } = await supabase.rpc("submit_guess", {
    p_room_id: roomId,
    p_guess: guess,
    p_stake: stake,
  });

  if (error) throw error;
}

export async function advanceOnlineGame(roomId: string) {
  const { error } = await supabase.rpc("advance_game", {
    p_room_id: roomId,
  });

  if (error) throw error;
}
