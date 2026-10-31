import { useEffect, useMemo, useState } from "react";
import type { GamePlayer, GameResult } from "../lib/game";
import PlayerAvatar from "./PlayerAvatar";
import "./GameLeaderboard.css";

type GameLeaderboardProps = {
  round: number;
  players: GamePlayer[];
  results?: GameResult[] | null;
  myPlayerId: string;
  remaining: number;
  animateChanges: boolean;
};

const LEADERBOARD_DURATION_SECONDS = 5;

function formatNumber(value: number) {
  return value.toLocaleString("en-US");
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function AnimatedScore({
  score,
  startScore,
  animate,
}: {
  score: number;
  startScore: number;
  animate: boolean;
}) {
  const [displayScore, setDisplayScore] = useState(() =>
    prefersReducedMotion() || !animate ? score : startScore,
  );

  useEffect(() => {
    if (!animate || prefersReducedMotion() || startScore === score) {
      return;
    }

    const duration = 480;
    const startedAt = performance.now();
    let frame = 0;

    const animateFrame = (now: number) => {
      const progress = Math.min((now - startedAt) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);

      setDisplayScore(Math.round(startScore + (score - startScore) * eased));

      if (progress < 1) {
        frame = requestAnimationFrame(animateFrame);
      }
    };

    frame = requestAnimationFrame(animateFrame);

    return () => cancelAnimationFrame(frame);
  }, [animate, score, startScore]);

  return <>{formatNumber(displayScore)}</>;
}

export default function GameLeaderboard({
  round,
  players,
  results,
  myPlayerId,
  remaining,
  animateChanges,
}: GameLeaderboardProps) {
  const rankedPlayers = useMemo(
    () => [...players].sort((a, b) => b.score - a.score),
    [players],
  );

  const scoreChanges = useMemo(
    () => new Map(results?.map((result) => [result.player_id, result.earned])),
    [results],
  );

  const comebackBonuses = useMemo(
    () =>
      new Map(
        results?.map((result) => [
          result.player_id,
          result.comeback_bonus ?? 0,
        ]),
      ),
    [results],
  );

  const previousRanks = useMemo(() => {
    const startingScores = players.map((player) => ({
      id: player.id,
      score: player.score - (scoreChanges.get(player.id) ?? 0),
    }));

    return new Map(
      startingScores.map((player) => [
        player.id,
        1 +
          startingScores.filter((other) => other.score > player.score).length,
      ]),
    );
  }, [players, scoreChanges]);

  const safeRemaining = Math.max(0, remaining);
  const progress = Math.min(
    100,
    (safeRemaining / LEADERBOARD_DURATION_SECONDS) * 100,
  );

  return (
    <section className="cc-leaderboard">
      <div className="cc-leaderboard-meta">
        <span className="cc-leaderboard-kicker">LEADERBOARD</span>
        <span className="cc-leaderboard-round">
          ROUND {String(round).padStart(2, "0")} / 07
        </span>
      </div>

      <div className="cc-leaderboard-heading">
        <div>
          <span className="cc-leaderboard-label">CURRENT STANDINGS</span>
          <h1>Who’s on top?</h1>
        </div>

        <div className="cc-leaderboard-next" aria-live="off">
          <span>NEXT ROUND</span>
          <strong>00:{String(safeRemaining).padStart(2, "0")}</strong>
        </div>
      </div>

      <div
        className="cc-leaderboard-progress"
        role="progressbar"
        aria-label="Time until the next round"
        aria-valuemin={0}
        aria-valuemax={LEADERBOARD_DURATION_SECONDS}
        aria-valuenow={Math.min(LEADERBOARD_DURATION_SECONDS, safeRemaining)}
      >
        <div style={{ width: `${progress}%` }} />
      </div>

      <ol className="cc-leaderboard-list">
        {rankedPlayers.map((player, index) => {
          const scoreChange = scoreChanges.get(player.id);
          const comebackBonus = comebackBonuses.get(player.id) ?? 0;
          const isMe = player.id === myPlayerId;
          const rank =
            1 + rankedPlayers.filter((other) => other.score > player.score).length;
          const previousRank = previousRanks.get(player.id) ?? rank;
          const rankChange = previousRank - rank;
          const isLeader = rank === 1;
          const startScore =
            scoreChange === undefined ? 0 : player.score - scoreChange;

          return (
            <li
              key={player.id}
              className={`cc-leaderboard-row ${isLeader ? "is-leader" : ""} ${
                isMe ? "is-me" : ""
              } ${animateChanges ? "should-animate" : ""}`}
              style={
                animateChanges
                  ? { animationDelay: `${index * 70}ms` }
                  : undefined
              }
            >
              <span className="cc-leaderboard-rank" aria-label={`Rank ${rank}`}>
                {String(rank).padStart(2, "0")}
              </span>

              <PlayerAvatar
                playerId={player.id}
                nickname={player.nickname}
                size={isLeader ? "medium" : "small"}
                isCurrentPlayer={isMe}
                isWinner={isLeader}
              />

              <div className="cc-leaderboard-player">
                <div className="cc-leaderboard-name-line">
                  <strong>{isMe ? "YOU" : player.nickname}</strong>
                  {isLeader && <span className="cc-leaderboard-leader">LEADER</span>}
                  {scoreChange !== undefined && (
                    <span
                      className={`cc-leaderboard-movement ${
                        rankChange > 0
                          ? "is-up"
                          : rankChange < 0
                            ? "is-down"
                            : "is-steady"
                      }`}
                      aria-label={
                        rankChange > 0
                          ? `Moved up ${rankChange} ${rankChange === 1 ? "place" : "places"}`
                          : rankChange < 0
                            ? `Moved down ${Math.abs(rankChange)} ${Math.abs(rankChange) === 1 ? "place" : "places"}`
                            : "Rank unchanged"
                      }
                    >
                      {rankChange > 0
                        ? `↑${rankChange}`
                        : rankChange < 0
                          ? `↓${Math.abs(rankChange)}`
                          : "—"}
                    </span>
                  )}
                  {comebackBonus === 100 && (
                    <span className="cc-leaderboard-comeback">COMEBACK +100</span>
                  )}
                </div>

                {isMe && <span className="cc-leaderboard-you-name">{player.nickname}</span>}
              </div>

              <div className="cc-leaderboard-score">
                <strong>
                  <AnimatedScore
                    score={player.score}
                    startScore={startScore}
                    animate={animateChanges}
                  />
                </strong>
                <span>PTS</span>
              </div>

              {scoreChange !== undefined && (
                <span
                  className={`cc-leaderboard-change ${
                    scoreChange < 0
                      ? "is-negative"
                      : scoreChange === 0
                        ? "is-neutral"
                        : "is-positive"
                  }`}
                  aria-label={`${scoreChange >= 0 ? "Gained" : "Lost"} ${Math.abs(
                    scoreChange,
                  )} points last round`}
                >
                  {scoreChange > 0 ? "+" : ""}
                  {formatNumber(scoreChange)}
                </span>
              )}
            </li>
          );
        })}
      </ol>

      <p className="cc-leaderboard-footer">GET READY — THE NEXT QUESTION IS COMING</p>
    </section>
  );
}
