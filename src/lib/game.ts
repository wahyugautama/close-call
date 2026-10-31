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
  comeback_bonus?: number;
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
  comeback_eligible?: boolean;
};

type ComebackState = {
  round: number | null;
  eligible: boolean;
  bonuses: Array<{ player_id: string; comeback_bonus: number }>;
};

export async function getGameState(roomId: string): Promise<GameState> {
  const [gameResponse, comebackResponse] = await Promise.all([
    supabase.rpc("get_game_state", { p_room_id: roomId }),
    supabase.rpc("get_comeback_state", { p_room_id: roomId }),
  ]);

  if (gameResponse.error) throw gameResponse.error;
  if (comebackResponse.error) throw comebackResponse.error;

  const game = gameResponse.data as GameState;
  const comeback = comebackResponse.data as ComebackState;
  const comebackMatchesRound = comeback.round === game.round;
  const bonusByPlayer = new Map(
    (comebackMatchesRound ? comeback.bonuses : []).map((bonus) => [
      bonus.player_id,
      bonus.comeback_bonus,
    ]),
  );

  return {
    ...game,
    comeback_eligible: comebackMatchesRound && comeback.eligible,
    results: game.results?.map((result) => ({
      ...result,
      comeback_bonus: bonusByPlayer.get(result.player_id) ?? 0,
    })),
  };
}

export async function submitOnlineGuess(
  roomId: string,
  guess: string,
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
