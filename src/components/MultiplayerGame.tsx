import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import AnswerReveal from "./AnswerReveal";
import GameLeaderboard from "./GameLeaderboard";
import GameFinale from "./GameFinale";
import PlayerAvatar from "./PlayerAvatar";
import ConnectionStatus, {
  type RealtimeConnectionState,
} from "./ConnectionStatus";
import FeedbackSettings from "./FeedbackSettings";
import { supabase } from "../lib/supabase";
import { playSound, primeAudio, type SoundEffect } from "../lib/audio";
import { emitFeedbackOnce } from "../lib/feedbackEvents";
import { useFeedbackPreferences } from "../lib/feedbackPreferences";
import { triggerHaptic, type HapticEffect } from "../lib/haptics";
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
  onRematchLobby: () => void;
};

const STAKES = [
  { amount: 0, label: "SAFE", rule: "NO POINTS AT RISK" },
  { amount: 100, label: "BALANCED", rule: "+100 / −100 · WITHIN 15%" },
  { amount: 250, label: "BOLD", rule: "+250 / −250 · WITHIN 5%" },
] as const;

const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;

function formatIntegerString(value: string) {
  return value.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function normalizeIntegerInput(value: string) {
  const digits = value.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  return digits === "" ? "" : digits;
}

function validateGuess(value: string) {
  if (value === "") return "Enter a whole-number estimate.";

  try {
    if (BigInt(value) > POSTGRES_BIGINT_MAX) {
      return "That estimate is larger than PostgreSQL bigint allows.";
    }
  } catch {
    return "Enter a valid nonnegative whole number.";
  }

  return "";
}

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return fallback;
}

export default function MultiplayerGame({
  room,
  userId,
  onLeave,
  onRematchLobby,
}: Props) {
  const [game, setGame] = useState<GameState | null>(null);
  const [guess, setGuess] = useState("");
  const [lockedGuessExact, setLockedGuessExact] = useState<string | null>(null);
  const [confirmedSubmissionRound, setConfirmedSubmissionRound] = useState<
    number | null
  >(null);
  const [animatedLeaderboardRound, setAnimatedLeaderboardRound] = useState<
    number | null
  >(null);
  const [stake, setStake] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submissionUncertain, setSubmissionUncertain] = useState(false);
  const [error, setError] = useState("");
  const [remaining, setRemaining] = useState(25);
  const [realtimeState, setRealtimeState] =
    useState<RealtimeConnectionState>("connecting");
  const [lastSuccessfulPoll, setLastSuccessfulPoll] = useState<number | null>(
    null,
  );
  const feedbackPreferences = useFeedbackPreferences();

  const serverSync = useRef({ serverTime: 0, monotonicTime: 0 });
  const requestBusy = useRef(false);
  const refreshQueued = useRef(false);
  const stateRequestSequence = useRef(0);
  const latestAppliedStateRequest = useRef(0);
  const refreshedDeadline = useRef<string | undefined>(undefined);
  const mounted = useRef(true);
  const lastRound = useRef<number | undefined>(undefined);
  const submitBusy = useRef(false);
  const uncertainSubmission = useRef(false);
  const guessInput = useRef<HTMLInputElement>(null);
  const latestPhase = useRef<GameState["phase"]>(undefined);
  const feedbackBaseline = useRef<GameState | null>(null);
  const initiallySuppressedDeadline = useRef<string | undefined>(undefined);

  // =========================================
  // Synchronize multiplayer state
  // =========================================

  const refresh = useCallback(async () => {
    if (requestBusy.current) {
      refreshQueued.current = true;
      return;
    }

    requestBusy.current = true;

    do {
      refreshQueued.current = false;
      let requestId = 0;

      try {
        // Phase advancement is best-effort for this client. A rejected or
        // transiently failed advance must never prevent an authorized player
        // from reading the latest server state.
        try {
          await advanceOnlineGame(room.id);
        } catch {
          // Another client may already have advanced, or this player may only
          // have read permission. The authoritative read below resolves both.
        }

        requestId = ++stateRequestSequence.current;
        const state = await getGameState(room.id);

        if (mounted.current && requestId >= latestAppliedStateRequest.current) {
          latestAppliedStateRequest.current = requestId;
          serverSync.current = {
            serverTime: Date.parse(state.server_time),
            monotonicTime: performance.now(),
          };

          if (lastRound.current !== state.round) {
            lastRound.current = state.round;
            setGuess("");
            setStake(0);
            setError("");
            setLockedGuessExact(null);
            setConfirmedSubmissionRound(null);
          }

          if (
            latestPhase.current === "reveal" &&
            state.phase === "leaderboard"
          ) {
            setAnimatedLeaderboardRound(state.round ?? null);
          }

          latestPhase.current = state.phase;

          setGame(state);
          if (uncertainSubmission.current) {
            setError(
              state.my_submission
                ? "Your guess was saved."
                : "Connection restored. You can try submitting again.",
            );
          }
          uncertainSubmission.current = false;
          setSubmissionUncertain(false);
          setLastSuccessfulPoll(Date.now());
        }
      } catch (err) {
        if (mounted.current && requestId >= latestAppliedStateRequest.current) {
          setError(getErrorMessage(err, "Could not sync game"));
        }
      }
    } while (mounted.current && refreshQueued.current);

    requestBusy.current = false;
  }, [room.id]);

  // =========================================
  // Realtime and polling fallback
  // =========================================

  useEffect(() => {
    mounted.current = true;

    const initial = window.setTimeout(() => {
      void refresh();
    }, 0);

    const channel = supabase
      .channel(`game-room-${room.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "rooms",
          filter: `id=eq.${room.id}`,
        },
        () => {
          void refresh();
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "game_rounds",
          filter: `room_id=eq.${room.id}`,
        },
        () => {
          void refresh();
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setRealtimeState("connected");
          return;
        }

        if (
          status === "CHANNEL_ERROR" ||
          status === "TIMED_OUT" ||
          status === "CLOSED"
        ) {
          setRealtimeState("disconnected");
        }
      });

    const fallback = window.setInterval(() => {
      void refresh();
    }, 3000);

    const onFocus = () => void refresh();

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void refresh();
      }
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      mounted.current = false;

      window.clearTimeout(initial);
      window.clearInterval(fallback);

      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);

      void supabase.removeChannel(channel);
    };
  }, [room.id, refresh]);

  // =========================================
  // Server-synchronized countdown
  // =========================================

  useEffect(() => {
    if (!game?.deadline || game.status === "finished") {
      return;
    }

    const deadline = Date.parse(game.deadline);

    let frame = 0;

    const updateTimer = () => {
      const serverNow =
        serverSync.current.serverTime +
        (performance.now() - serverSync.current.monotonicTime);

      const nextRemaining = Math.max(
        0,
        Math.ceil((deadline - serverNow) / 1000),
      );

      setRemaining((current) =>
        current === nextRemaining ? current : nextRemaining,
      );

      if (nextRemaining === 0 && refreshedDeadline.current !== game.deadline) {
        refreshedDeadline.current = game.deadline;
        void refresh();
      }

      frame = window.requestAnimationFrame(updateTimer);
    };

    updateTimer();

    return () => window.cancelAnimationFrame(frame);
  }, [game?.deadline, game?.status, refresh]);

  useEffect(() => {
    if (game?.status === "lobby") {
      onRematchLobby();
    }
  }, [game?.status, onRematchLobby]);

  const emitGameFeedback = useCallback(
    (eventId: string, sound: SoundEffect, haptic?: HapticEffect) => {
      emitFeedbackOnce(eventId, () => {
        if (feedbackPreferences.soundEnabled) {
          playSound(sound, feedbackPreferences.volume);
        }

        if (haptic) {
          triggerHaptic(haptic, feedbackPreferences.hapticsEnabled);
        }
      });
    },
    [feedbackPreferences],
  );

  // Establish the first server state as a silent baseline. Only transitions
  // observed after hydration can emit feedback.
  useEffect(() => {
    if (!game) return;

    const previous = feedbackBaseline.current;

    if (!previous) {
      feedbackBaseline.current = game;
      const initialRemaining = game.deadline
        ? Math.max(
            0,
            Math.ceil(
              (Date.parse(game.deadline) - Date.parse(game.server_time)) / 1000,
            ),
          )
        : 0;
      initiallySuppressedDeadline.current =
        game.phase === "question" && initialRemaining <= 3
          ? game.deadline
          : undefined;
      return;
    }

    const eventScope = `${room.id}:${game.round ?? 0}:${game.deadline ?? "none"}`;

    if (previous.phase !== "reveal" && game.phase === "reveal") {
      emitGameFeedback(`${eventScope}:reveal`, "reveal", "reveal");
    }

    if (previous.phase !== "leaderboard" && game.phase === "leaderboard") {
      const myResult = game.results?.find(
        (result) =>
          result.player_id ===
          game.players.find((player) => player.user_id === userId)?.id,
      );

      if (myResult && myResult.earned !== 0) {
        emitGameFeedback(
          `${eventScope}:score:${myResult.player_id}`,
          myResult.earned > 0 ? "positivePoints" : "negativePoints",
        );
      }
    }

    if (previous.status !== "finished" && game.status === "finished") {
      emitGameFeedback(`${eventScope}:winner`, "winner", "winner");
    }

    feedbackBaseline.current = game;
  }, [emitGameFeedback, game, room.id, userId]);

  useEffect(() => {
    if (
      !game?.deadline ||
      game.phase !== "question" ||
      remaining < 1 ||
      remaining > 3 ||
      game.deadline === initiallySuppressedDeadline.current
    ) {
      return;
    }

    emitGameFeedback(
      `${room.id}:${game.round ?? 0}:${game.deadline}:countdown:${remaining}`,
      "countdown",
    );
  }, [
    emitGameFeedback,
    game?.deadline,
    game?.phase,
    game?.round,
    remaining,
    room.id,
  ]);

  // =========================================
  // Submit a guess
  // =========================================

  const handleGuessChange = (event: ChangeEvent<HTMLInputElement>) => {
    const element = event.currentTarget;

    if (/[^\d,\s]/.test(element.value)) {
      setError("Use digits only; negative values aren't allowed.");
      return;
    }

    const cursor = element.selectionStart ?? element.value.length;
    const digitsBeforeCursor = element.value
      .slice(0, cursor)
      .replace(/\D/g, "").length;
    const nextGuess = normalizeIntegerInput(element.value);

    setGuess(nextGuess);

    if (!validateGuess(nextGuess)) {
      setError("");
    }

    window.requestAnimationFrame(() => {
      const input = guessInput.current;
      if (!input || document.activeElement !== input) return;

      let nextCursor = 0;
      let seenDigits = 0;

      while (
        nextCursor < input.value.length &&
        seenDigits < digitsBeforeCursor
      ) {
        if (/\d/.test(input.value[nextCursor])) seenDigits += 1;
        nextCursor += 1;
      }

      input.setSelectionRange(nextCursor, nextCursor);
    });
  };

  async function submit() {
    if (
      !game ||
      game.phase !== "question" ||
      game.my_submission ||
      submitBusy.current ||
      submissionUncertain ||
      remaining <= 0
    ) {
      return;
    }

    const validationError = validateGuess(guess);

    if (validationError) {
      setError(validationError);
      return;
    }

    submitBusy.current = true;
    setLockedGuessExact(guess);
    setSubmitting(true);
    setError("");

    if (feedbackPreferences.soundEnabled) {
      void primeAudio();
    }

    try {
      await submitOnlineGuess(room.id, guess, stake);
      setConfirmedSubmissionRound(game.round ?? null);
      emitGameFeedback(
        `${room.id}:${game.round ?? 0}:${game.deadline ?? "none"}:guess:${userId}`,
        "guessLocked",
        "guessLocked",
      );
      await refresh();
    } catch (err) {
      try {
        const requestId = ++stateRequestSequence.current;
        const authoritativeState = await getGameState(room.id);

        if (mounted.current && requestId >= latestAppliedStateRequest.current) {
          latestAppliedStateRequest.current = requestId;
          serverSync.current = {
            serverTime: Date.parse(authoritativeState.server_time),
            monotonicTime: performance.now(),
          };
          setGame(authoritativeState);
          latestPhase.current = authoritativeState.phase;
          setLastSuccessfulPoll(Date.now());
          uncertainSubmission.current = false;
          setSubmissionUncertain(false);
          setError(
            authoritativeState.my_submission
              ? "Your guess was saved."
              : getErrorMessage(
                  err,
                  "Could not submit guess. Please try again.",
                ),
          );
          if (authoritativeState.my_submission) {
            setConfirmedSubmissionRound(authoritativeState.round ?? null);
            emitGameFeedback(
              `${room.id}:${authoritativeState.round ?? 0}:${authoritativeState.deadline ?? "none"}:guess:${userId}`,
              "guessLocked",
              "guessLocked",
            );
          }
        }
      } catch {
        if (mounted.current) {
          uncertainSubmission.current = true;
          setSubmissionUncertain(true);
          setError(
            "We couldn't confirm whether your guess was saved. Reconnecting before another attempt…",
          );
        }
      }
    } finally {
      submitBusy.current = false;
      if (mounted.current) setSubmitting(false);
    }
  }

  const handleGuessKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" && !validateGuess(guess)) {
      event.preventDefault();
      void submit();
    }
  };

  // =========================================
  // Loading
  // =========================================

  if (!game) {
    return (
      <div className="score-card">
        <strong>Connecting to game...</strong>

        {error && <p role="alert">{error}</p>}
      </div>
    );
  }

  const myPlayer = game.players.find((player) => player.user_id === userId);

  // =========================================
  // Game UI
  // =========================================

  return (
    <>
      <div className="game-utility-row">
        <ConnectionStatus
          realtimeState={realtimeState}
          lastSuccessfulPoll={lastSuccessfulPoll}
        />
        <FeedbackSettings />
      </div>

      {game.status === "finished" ? (
        <GameFinale
          roomId={room.id}
          isHost={room.host_id === userId}
          players={game.players}
          onLeave={onLeave}
          onRematchLobby={onRematchLobby}
        />
      ) : /* =====================================
         STAGE 5.1 — QUESTION SCREEN
      ===================================== */

      game.phase === "question" ? (
        <section className="cc-question-screen">
          <div className="cc-round-meta">
            <span className="cc-kicker">MAKE YOUR ESTIMATE</span>

            <span className="cc-round-number">
              ROUND {String(game.round ?? 1).padStart(2, "0")} / 07
            </span>
          </div>

          <div className="cc-timer-header">
            <div>
              <span className="cc-small-label">TIME REMAINING</span>

              <div
                className={`cc-timer-number ${
                  remaining <= 5 ? "is-urgent" : ""
                }`}
                aria-live="off"
              >
                00:{String(remaining).padStart(2, "0")}
              </div>
            </div>

            <span className="cc-answered-count">
              {game.submitted_count ?? 0}
              {" / "}
              {game.total_players ?? 0} LOCKED
            </span>
          </div>

          <div
            className="cc-timer-track"
            role="progressbar"
            aria-label="Time remaining"
            aria-valuemin={0}
            aria-valuemax={25}
            aria-valuenow={Math.min(25, remaining)}
          >
            <div
              className={`cc-timer-progress ${
                remaining <= 5 ? "is-urgent" : ""
              }`}
              style={{
                width: `${Math.min(100, (remaining / 25) * 100)}%`,
              }}
            />
          </div>

          <h1 className="cc-question-title">{game.question}</h1>

          {myPlayer && (
            <div className="cc-current-player">
              <PlayerAvatar
                playerId={myPlayer.id}
                nickname={myPlayer.nickname}
                isCurrentPlayer
              />
              <div>
                <span className="cc-small-label">PLAYING AS</span>
                <strong>{myPlayer.nickname}</strong>
              </div>
              <span className="cc-current-player__score">
                {myPlayer.score.toLocaleString()} PTS
              </span>
            </div>
          )}

          {game.comeback_eligible && (
            <div className="cc-comeback-active" role="status">
              <strong>COMEBACK ACTIVE</strong>
              <span>Within 15% = +100 bonus points.</span>
            </div>
          )}

          {game.my_submission ? (
            <div
              className={`cc-locked-card ${
                confirmedSubmissionRound === game.round ? "is-confirmed" : ""
              }`}
              role="status"
            >
              <div className="cc-locked-symbol">✓</div>

              <span className="cc-small-label">ANSWER SUBMITTED</span>

              <strong className="cc-locked-title">Guess locked in.</strong>

              <div className="cc-locked-value">
                {lockedGuessExact
                  ? formatIntegerString(lockedGuessExact)
                  : game.my_submission.guess.toLocaleString()}
              </div>

              <span className="cc-locked-stake">
                {game.my_submission.stake === 0
                  ? "SAFE · NO POINTS AT RISK"
                  : `${game.my_submission.stake} POINTS STAKED`}
              </span>

              <span className="cc-waiting-text">
                {(game.submitted_count ?? 0) === game.total_players &&
                (game.total_players ?? 0) > 0
                  ? "Everyone's in!"
                  : "Waiting for other players..."}
              </span>
            </div>
          ) : (
            <div className="cc-answer-form">
              <label className="cc-small-label" htmlFor="online-guess">
                YOUR ANSWER
              </label>

              <div className="cc-input-wrap">
                <input
                  ref={guessInput}
                  id="online-guess"
                  className="cc-answer-input"
                  type="text"
                  inputMode="numeric"
                  enterKeyHint="done"
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={25}
                  placeholder="?"
                  value={formatIntegerString(guess)}
                  disabled={submitting || submissionUncertain || remaining <= 0}
                  aria-describedby="online-guess-help online-guess-error"
                  aria-invalid={Boolean(error)}
                  onChange={handleGuessChange}
                  onKeyDown={handleGuessKeyDown}
                />
              </div>

              <p id="online-guess-help" className="cc-input-help">
                Whole numbers only, from 0 to 9,223,372,036,854,775,807.
              </p>

              <div className="cc-stake-heading">
                <span className="cc-small-label">CHOOSE YOUR STAKE</span>

                <span className="cc-balance">
                  {myPlayer?.score.toLocaleString() ?? 500} PTS
                </span>
              </div>

              <div className="cc-stake-grid">
                {STAKES.map(({ amount, label, rule }) => {
                  const isUnaffordable = amount > (myPlayer?.score ?? 0);

                  return (
                    <button
                      key={amount}
                      type="button"
                      className={`cc-stake-option ${
                        stake === amount ? "is-selected" : ""
                      }`}
                      disabled={
                        submitting ||
                        submissionUncertain ||
                        remaining <= 0 ||
                        isUnaffordable
                      }
                      aria-pressed={stake === amount}
                      aria-label={`${label} stake. ${rule}${
                        isUnaffordable
                          ? ". Unavailable: not enough points."
                          : ""
                      }`}
                      onClick={() => {
                        setStake(amount);
                        setError("");
                        if (feedbackPreferences.soundEnabled) {
                          void primeAudio().then((ready) => {
                            if (ready) {
                              playSound("tap", feedbackPreferences.volume);
                            }
                          });
                        }
                        triggerHaptic(
                          "stake",
                          feedbackPreferences.hapticsEnabled,
                        );
                      }}
                    >
                      <strong>{label}</strong>

                      <span>{rule}</span>
                      {isUnaffordable && <em>NOT ENOUGH POINTS</em>}
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                className="cc-lock-button"
                onClick={submit}
                disabled={
                  submitting ||
                  submissionUncertain ||
                  remaining <= 0 ||
                  Boolean(validateGuess(guess))
                }
              >
                <span>
                  {submissionUncertain
                    ? "CONFIRMING..."
                    : submitting
                      ? "LOCKING..."
                      : remaining <= 0
                        ? "TIME'S UP"
                        : "LOCK MY GUESS"}
                </span>

                <span aria-hidden="true">↗</span>
              </button>

              <p className="cc-form-hint">
                Once submitted, your answer can't be changed.
              </p>

              {error && (
                <p
                  id="online-guess-error"
                  className="cc-game-error"
                  role="alert"
                >
                  {error}
                </p>
              )}
            </div>
          )}
        </section>
      ) : /* =====================================
         STAGE 5.2 — ANSWER REVEAL
      ===================================== */

      game.phase === "reveal" ? (
        game.answer != null && game.question ? (
          <AnswerReveal
            key={game.round}
            round={game.round ?? 1}
            question={game.question}
            answer={game.answer}
            explanation={game.explanation}
            results={game.results ?? []}
            myPlayerId={myPlayer?.id ?? ""}
          />
        ) : (
          <div className="score-card" role="status">
            Preparing results...
          </div>
        )
      ) : (
        /* =====================================
         LEADERBOARD SCREEN
      ===================================== */

        <GameLeaderboard
          key={game.round}
          round={game.round ?? 1}
          players={game.players}
          results={game.results}
          myPlayerId={myPlayer?.id ?? ""}
          remaining={remaining}
          animateChanges={animatedLeaderboardRound === game.round}
        />
      )}

      {/* =====================================
          PLAYER RANKINGS
      ===================================== */}

      {/* =====================================
          ERRORS
      ===================================== */}

      {error && (game.phase !== "question" || game.my_submission) && (
        <p className="cc-game-error" role="alert">
          {error}
        </p>
      )}

      {/* =====================================
          EXIT AFTER GAME
      ===================================== */}
    </>
  );
}
