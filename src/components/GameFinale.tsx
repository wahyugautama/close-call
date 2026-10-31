import { useState } from "react";
import type { GamePlayer } from "../lib/game";
import { prepareRematch } from "../lib/rooms";
import PlayerAvatar from "./PlayerAvatar";

type Props = {
  roomId: string;
  isHost: boolean;
  players: GamePlayer[];
  onLeave: () => void;
  onRematchLobby: () => void;
};

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return "Could not prepare the rematch";
}

export default function GameFinale({
  roomId,
  isHost,
  players,
  onLeave,
  onRematchLobby,
}: Props) {
  const [preparing, setPreparing] = useState(false);
  const [error, setError] = useState("");
  const rankedPlayers = [...players].sort((a, b) => b.score - a.score);
  const winningScore = rankedPlayers[0]?.score;
  const winners = rankedPlayers.filter(
    (player) => player.score === winningScore,
  );
  const [celebrate] = useState(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return false;
    }

    const standingsKey = players
      .map((player) => `${player.id}:${player.score}`)
      .sort()
      .join("|");
    const celebrationKey = `close-call-finale:${roomId}:${standingsKey}`;

    try {
      if (window.sessionStorage.getItem(celebrationKey)) return false;

      window.sessionStorage.setItem(celebrationKey, "shown");
      return true;
    } catch {
      return false;
    }
  });

  const handlePlayAgain = async () => {
    if (!isHost || preparing) return;

    setPreparing(true);
    setError("");

    try {
      await prepareRematch(roomId);
      onRematchLobby();
    } catch (rematchError) {
      setError(getErrorMessage(rematchError));
      setPreparing(false);
    }
  };

  return (
    <section className="finale-screen">
      {celebrate && (
        <div className="finale-confetti" aria-hidden="true">
          {Array.from({ length: 14 }, (_, index) => (
            <i
              key={index}
              style={{
                left: `${3 + index * 7}%`,
                animationDelay: `${index * 24}ms`,
              }}
            />
          ))}
        </div>
      )}
      <div className="eyebrow">GAME COMPLETE</div>
      <h1 className="screen-title">
        {winners.length > 1 ? "The champions." : "The champion."}
      </h1>

      <div className="score-card finale-winners">
        <span className="finale-crown" aria-hidden="true">♛</span>
        <span className="muted">
          {winners.length > 1 ? "TIED WINNERS" : "WINNER"}
        </span>
        <div className="finale-winners__avatars">
          {winners.map((winner) => (
            <div className="finale-winner" key={winner.id}>
              <PlayerAvatar
                playerId={winner.id}
                nickname={winner.nickname}
                size="large"
                isWinner
              />
              <strong>{winner.nickname}</strong>
            </div>
          ))}
        </div>
        <p>{winningScore?.toLocaleString()} points</p>
      </div>

      <div className="player-list">
        {rankedPlayers.map((player) => {
          const rank =
            1 + rankedPlayers.filter((other) => other.score > player.score).length;

          return (
          <div className="player finale-standing" key={player.id}>
            <PlayerAvatar
              playerId={player.id}
              nickname={player.nickname}
              size="small"
              isWinner={player.score === winningScore}
            />
            <strong className="finale-standing__name">
              #{rank} {player.nickname}
            </strong>
            <strong>{player.score.toLocaleString()}</strong>
          </div>
          );
        })}
      </div>

      {error && (
        <p role="alert" style={{ color: "#ff9a87" }}>
          {error}
        </p>
      )}

      <div className="actions">
        {isHost ? (
          <button
            className="btn btn-primary"
            type="button"
            disabled={preparing}
            onClick={handlePlayAgain}
          >
            {preparing ? "PREPARING REMATCH..." : "PLAY AGAIN ↗"}
          </button>
        ) : (
          <div className="score-card" role="status">
            <strong>WAITING FOR HOST</strong>
            <p>The host can bring everyone back to the lobby.</p>
          </div>
        )}

        <button
          className="btn btn-secondary"
          type="button"
          disabled={preparing}
          onClick={onLeave}
        >
          BACK TO HOME
        </button>
      </div>
    </section>
  );
}
