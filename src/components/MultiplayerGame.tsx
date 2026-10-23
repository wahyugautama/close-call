import { useCallback, useEffect, useRef, useState } from "react";
import {
  advanceOnlineGame,
  getGameState,
  submitOnlineGuess,
  type GameState,
} from "../lib/game";
import type { Room } from "../lib/rooms";

type Props = {
  room: Room;
  userId: string;
  onLeave: () => void;
};

const STAKES = [0, 100, 250];

export default function MultiplayerGame({ room, userId, onLeave }: Props) {
  const [game, setGame] = useState<GameState | null>(null);
  const [guess, setGuess] = useState("");
  const [stake, setStake] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [remaining, setRemaining] = useState(25);

  const serverOffset = useRef(0);
  const requestBusy = useRef(false);
  const mounted = useRef(true);
  const lastRound = useRef<number | undefined>(undefined);

  const refresh = useCallback(async () => {
    if (requestBusy.current) return;
    requestBusy.current = true;

    try {
      // Request phase transitions before reading the state.
      await advanceOnlineGame(room.id);
      const state = await getGameState(room.id);

      if (!mounted.current) return;

      serverOffset.current = Date.parse(state.server_time) - Date.now();

      if (lastRound.current !== state.round) {
        lastRound.current = state.round;
        setGuess("");
        setStake(0);
      }

      setGame(state);
      setError("");
    } catch (err) {
      if (mounted.current) {
        setError(err instanceof Error ? err.message : "Could not sync game");
      }
    } finally {
      requestBusy.current = false;
    }
  }, [room.id]);

  useEffect(() => {
    mounted.current = true;

    const initial = window.setTimeout(() => {
      void refresh();
    }, 0);

    const interval = window.setInterval(() => {
      void refresh();
    }, 1000);

    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);

    return () => {
      mounted.current = false;
      window.clearTimeout(initial);
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [refresh]);

  useEffect(() => {
    if (!game?.deadline || game.status === "finished") {
      return;
    }

    const deadline = Date.parse(game.deadline);

    const interval = window.setInterval(() => {
      const serverNow = Date.now() + serverOffset.current;

      setRemaining(Math.max(0, Math.ceil((deadline - serverNow) / 1000)));
    }, 100);

    return () => window.clearInterval(interval);
  }, [game?.deadline, game?.status]);

  async function submit() {
    if (
      !game ||
      game.phase !== "question" ||
      game.my_submission ||
      submitting ||
      remaining <= 0
    )
      return;

    const value = Number(guess);

    if (guess.trim() === "" || !Number.isSafeInteger(value) || value < 0) {
      setError("Enter a valid whole number.");
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      await submitOnlineGuess(room.id, value, stake);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit guess");
    } finally {
      setSubmitting(false);
    }
  }

  if (!game) {
    return (
      <div className="score-card">
        <strong>Connecting to game...</strong>
        {error && <p role="alert">{error}</p>}
      </div>
    );
  }

  const myPlayer = game.players.find((p) => p.user_id === userId);

  const sortedPlayers = [...game.players].sort((a, b) => b.score - a.score);

  return (
    <>
      <div className="eyebrow">
        {game.status === "finished"
          ? "GAME COMPLETE"
          : `ROUND ${game.round ?? 1} / 7`}
      </div>

      {game.status === "finished" ? (
        <>
          <h1 className="screen-title">The champion.</h1>

          <div className="score-card">
            <span className="muted">WINNER</span>
            <strong>{sortedPlayers[0]?.nickname}</strong>
            <p>{sortedPlayers[0]?.score} points</p>
          </div>
        </>
      ) : game.phase === "question" ? (
        <>
          <h1 className="question">{game.question}</h1>

          <div className="timer-track">
            <div
              className="timer-fill"
              style={{
                width: `${(remaining / 25) * 100}%`,
              }}
            />
          </div>

          <div className="eyebrow">{remaining} SECONDS LEFT</div>

          {game.my_submission ? (
            <div className="score-card">
              <strong>GUESS LOCKED ✓</strong>
              <p>Your guess: {game.my_submission.guess}</p>
              <p>
                {game.submitted_count}/{game.total_players} players answered
              </p>
              <p>Waiting for the reveal...</p>
            </div>
          ) : (
            <>
              <div className="spacer" />

              <label className="field-label" htmlFor="online-guess">
                YOUR GUESS
              </label>

              <input
                id="online-guess"
                className="guess-input"
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                placeholder="?"
                value={guess}
                onChange={(e) => setGuess(e.target.value)}
              />

              <p className="field-label">YOUR STAKE</p>

              <div className="stakes">
                {STAKES.map((amount) => (
                  <button
                    key={amount}
                    className={`stake ${stake === amount ? "selected" : ""}`}
                    disabled={amount > (myPlayer?.score ?? 500)}
                    onClick={() => setStake(amount)}
                  >
                    {amount === 0 ? "SAFE" : amount}
                  </button>
                ))}
              </div>

              <button
                className="btn btn-primary"
                onClick={submit}
                disabled={submitting || remaining <= 0}
              >
                {submitting ? "LOCKING..." : "LOCK GUESS →"}
              </button>
            </>
          )}
        </>
      ) : game.phase === "reveal" ? (
        <>
          <h1 className="screen-title">The answer is...</h1>

          <div className="score-card">
            <span className="muted">CORRECT ANSWER</span>
            <strong>{game.answer?.toLocaleString()}</strong>
            <p>{game.explanation}</p>
          </div>

          <div className="eyebrow" style={{ marginTop: 24 }}>
            ALL GUESSES
          </div>

          {game.results?.map((result) => (
            <div className="result-row" key={result.player_id}>
              <div>
                <strong>{result.nickname}</strong>
                <div className="muted">
                  {result.guess?.toLocaleString() ?? "No answer"}
                </div>
              </div>
              <strong>
                {result.earned >= 0 ? "+" : ""}
                {result.earned}
              </strong>
            </div>
          ))}
        </>
      ) : (
        <>
          <h1 className="screen-title">Leaderboard.</h1>
          <p className="description">
            Next round starts in {remaining} seconds.
          </p>
        </>
      )}

      {(game.phase === "leaderboard" || game.status === "finished") && (
        <div className="player-list">
          {sortedPlayers.map((player, index) => (
            <div className="player" key={player.id}>
              <strong>
                #{index + 1} {player.nickname}
              </strong>
              <strong>{player.score.toLocaleString()}</strong>
            </div>
          ))}
        </div>
      )}

      {error && (
        <p role="alert" style={{ color: "#ff9a87" }}>
          {error}
        </p>
      )}

      {game.status === "finished" && (
        <button className="btn btn-secondary" onClick={onLeave}>
          BACK TO HOME
        </button>
      )}
    </>
  );
}
