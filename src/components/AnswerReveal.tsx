import { useEffect, useMemo, useState } from "react";
import type { GameResult } from "../lib/game";
import PlayerAvatar from "./PlayerAvatar";
import "./AnswerReveal.css";

type AnswerRevealProps = {
  round: number;
  question: string;
  answer: number;
  explanation?: string | null;
  results: GameResult[];
  myPlayerId: string;
};

function formatNumber(value: number) {
  return value.toLocaleString("en-US");
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function getAccuracy(guess: number | null, answer: number) {
  if (guess === null) {
    return null;
  }

  if (answer === 0) {
    return guess === 0 ? 0 : null;
  }

  return (Math.abs(guess - answer) / Math.abs(answer)) * 100;
}

export default function AnswerReveal({
  round,
  question,
  answer,
  explanation,
  results,
  myPlayerId,
}: AnswerRevealProps) {
  const answerCanAnimate =
    Number.isSafeInteger(answer) && Math.abs(answer) <= 1_000_000_000;
  const [displayNumber, setDisplayNumber] = useState(() =>
    prefersReducedMotion() || !answerCanAnimate ? answer : 0,
  );
  const [showResults, setShowResults] = useState(prefersReducedMotion);
  const myResult = useMemo(
    () => results.find((result) => result.player_id === myPlayerId),
    [myPlayerId, results],
  );
  const myAccuracy = myResult
    ? getAccuracy(myResult.guess, answer)
    : null;
  const myDifference =
    myResult?.guess == null ? null : Math.abs(myResult.guess - answer);

  useEffect(() => {
    if (prefersReducedMotion()) return;

    let frame = 0;

    if (answerCanAnimate) {
      const duration = 480;
      const startedAt = performance.now();

      function animate(now: number) {
        const progress = Math.min((now - startedAt) / duration, 1);

        const eased = 1 - Math.pow(1 - progress, 3);

        setDisplayNumber(Math.round(answer * eased));

        if (progress < 1) {
          frame = requestAnimationFrame(animate);
        } else {
          setDisplayNumber(answer);
        }
      }

      frame = requestAnimationFrame(animate);
    }

    const revealTimeout = window.setTimeout(() => {
      setShowResults(true);
    }, 520);

    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(revealTimeout);
    };
  }, [answer, answerCanAnimate, round]);

  const { sortedResults, closestDistance } = useMemo(() => {
    const sorted = [...results].sort((a, b) => {
      if (a.guess === null) return b.guess === null ? 0 : 1;
      if (b.guess === null) return -1;

      return Math.abs(a.guess - answer) - Math.abs(b.guess - answer);
    });
    const closestGuess = sorted.find((result) => result.guess !== null)?.guess;

    return {
      sortedResults: sorted,
      closestDistance:
        closestGuess === null || closestGuess === undefined
          ? null
          : Math.abs(closestGuess - answer),
    };
  }, [answer, results]);

  return (
    <section className="cc-reveal">
      <div className="cc-reveal-meta">
        <span className="cc-reveal-kicker">THE ANSWER IS...</span>
        <span className="cc-reveal-round">
          ROUND {String(round).padStart(2, "0")} / 07
        </span>
      </div>

      <h1 className="cc-reveal-question">{question}</h1>

      <div className="cc-reveal-answer-card">
        <span className="cc-reveal-label">CORRECT ANSWER</span>

        <div
          className="cc-reveal-number"
          aria-label={`Correct answer: ${formatNumber(answer)}`}
        >
          <span aria-hidden="true">{formatNumber(displayNumber)}</span>
        </div>

        {explanation && <p className="cc-reveal-explanation">{explanation}</p>}
      </div>

      {myResult && (
        <div className="cc-reveal-personal" aria-label="Your round result">
          <div>
            <span className="cc-reveal-label">YOUR GUESS</span>
            <strong>
              {myResult.guess === null
                ? "No answer"
                : formatNumber(myResult.guess)}
            </strong>
          </div>

          <div>
            <span className="cc-reveal-label">DIFFERENCE</span>
            <strong>
              {myDifference === null
                ? "—"
                : `${formatNumber(myDifference)}${
                    myAccuracy === null ? "" : ` · ${myAccuracy.toFixed(1)}%`
                  }`}
            </strong>
          </div>

          <div>
            <span className="cc-reveal-label">POINTS</span>
            <strong
              className={
                myResult.earned < 0
                  ? "is-negative"
                  : myResult.earned === 0
                    ? "is-neutral"
                    : "is-positive"
              }
            >
              {myResult.earned > 0 ? "+" : ""}
              {formatNumber(myResult.earned)}
            </strong>
            {(myResult.comeback_bonus ?? 0) > 0 && (
              <span className="cc-reveal-personal-bonus">
                Includes +{formatNumber(myResult.comeback_bonus ?? 0)} comeback
              </span>
            )}
          </div>
        </div>
      )}

      <div className="cc-reveal-results-header">
        <span className="cc-reveal-label">HOW EVERYONE DID</span>
        <span className="cc-reveal-count">{results.length} ANSWERS</span>
      </div>

      <div className={`cc-reveal-results ${showResults ? "is-visible" : ""}`}>
        {sortedResults.map((result, index) => {
          const accuracy = getAccuracy(result.guess, answer);

          const isClosest =
            result.guess !== null &&
            closestDistance !== null &&
            Math.abs(result.guess - answer) === closestDistance;

          const isMe = result.player_id === myPlayerId;

          const earned = result.earned;

          return (
            <div
              key={result.player_id}
              className={`cc-reveal-result ${isMe ? "is-me" : ""}`}
              style={{
                animationDelay: `${index * 90}ms`,
              }}
            >
              <PlayerAvatar
                playerId={result.player_id}
                nickname={result.nickname}
                isCurrentPlayer={isMe}
              />

              <div className="cc-reveal-result-main">
                <div className="cc-reveal-player-line">
                  <strong>{isMe ? "YOU" : result.nickname}</strong>

                  {isClosest && (
                    <span className="cc-reveal-closest">CLOSEST</span>
                  )}

                  {result.comeback_bonus === 100 && (
                    <span className="cc-reveal-comeback">
                      +100 COMEBACK BONUS
                    </span>
                  )}
                </div>

                <span className="cc-reveal-guess">
                  {result.guess === null ? (
                    "No answer"
                  ) : (
                    <>
                      {formatNumber(result.guess)}
                      <span className="cc-reveal-dot"> · </span>
                      {accuracy === null
                        ? "Off target"
                        : `${accuracy.toFixed(1)}% off`}
                    </>
                  )}
                </span>
              </div>

              <strong
                className={`cc-reveal-points ${
                  earned < 0 ? "is-negative" : ""
                }`}
              >
                {earned > 0 ? "+" : ""}
                {formatNumber(earned)}
              </strong>
            </div>
          );
        })}

        {sortedResults.length === 0 && (
          <p className="cc-reveal-empty">
            No guesses were submitted this round.
          </p>
        )}
      </div>

      <p className="cc-reveal-footer">
        LEADERBOARD COMING UP NEXT
        <span className="cc-reveal-loading-dots">
          <span />
          <span />
          <span />
        </span>
      </p>
    </section>
  );
}
