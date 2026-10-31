import { useCallback, useEffect, useRef, useState } from "react";
import MultiplayerLobby from "./components/MultiplayerLobby";
import MultiplayerGame from "./components/MultiplayerGame";
import { supabase } from "./lib/supabase";
import { getMyActiveRoom } from "./lib/rooms";
import {
  getInviteCode,
  isInviteLocation,
  normalizeRoomCode,
  ROOM_CODE_PATTERN,
} from "./lib/invites";
import { readLastNickname, rememberNickname } from "./lib/onboarding";

import {
  createRoom as createOnlineRoom,
  getRoomErrorMessage,
  joinRoom as joinOnlineRoom,
  type Room,
} from "./lib/rooms";
import "./App.css";

type Screen =
  | "home"
  | "join"
  | "lobby"
  | "onlineLobby"
  | "onlineGame"
  | "question"
  | "reveal"
  | "leaderboard"
  | "final";

type Player = {
  id: string;
  name: string;
  score: number;
  guess?: number;
  stake?: number;
  earned?: number;
};

type Question = {
  text: string;
  answer: number;
  explanation: string;
};

const QUESTIONS: Question[] = [
  {
    text: "How many bones are in the adult human body?",
    answer: 206,
    explanation: "The typical adult human skeleton has 206 bones.",
  },
  {
    text: "How many squares are on a standard chessboard?",
    answer: 64,
    explanation: "A standard chessboard has 8 rows and 8 columns.",
  },
  {
    text: "How many minutes are in one week?",
    answer: 10080,
    explanation: "7 days × 24 hours × 60 minutes.",
  },
  {
    text: "How many keys are on a standard piano?",
    answer: 88,
    explanation: "A standard modern piano has 88 keys.",
  },
  {
    text: "How many cards are in a standard deck without jokers?",
    answer: 52,
    explanation: "Four suits with 13 cards each.",
  },
  {
    text: "How many degrees are in the interior angles of a triangle?",
    answer: 180,
    explanation: "In Euclidean geometry, they sum to 180°.",
  },
  {
    text: "How many seconds are in one day?",
    answer: 86400,
    explanation: "24 × 60 × 60 = 86,400 seconds.",
  },
];

const ROUND_TIME = 25;
const REVEAL_TIME = 8;
const LEADERBOARD_TIME = 5;
const STARTING_SCORE = 500;
const STAKES = [0, 100, 250] as const;

function calculatePoints(guess: number, answer: number, stake: number): number {
  const isExact = guess === answer;
  const error = answer === 0 ? null : Math.abs(guess - answer) / Math.abs(answer);
  const basePoints = isExact
    ? 300
    : error !== null && error <= 0.05
      ? 200
      : error !== null && error <= 0.15
        ? 120
        : error !== null && error <= 0.3
          ? 60
          : 0;

  if (stake === 100) {
    return basePoints + (isExact || (error !== null && error <= 0.15) ? 100 : -100);
  }

  if (stake === 250) {
    return basePoints + (isExact || (error !== null && error <= 0.05) ? 250 : -250);
  }

  return basePoints;
}

function randomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint32Array(4);

  crypto.getRandomValues(bytes);

  return Array.from(bytes, (value) => chars[value % chars.length]).join("");
}

function generateBotGuess(answer: number): number {
  const variation = 0.5 + Math.random();

  return Math.max(0, Math.round(answer * variation));
}

function createInitialPlayers(name: string): Player[] {
  return [
    {
      id: "me",
      name,
      score: STARTING_SCORE,
    },
    {
      id: "bot1",
      name: "Pixel",
      score: STARTING_SCORE,
    },
    {
      id: "bot2",
      name: "Nova",
      score: STARTING_SCORE,
    },
    {
      id: "bot3",
      name: "Chaos",
      score: STARTING_SCORE,
    },
  ];
}

function App() {
  // --------------------------------
  // Local game state
  // --------------------------------

  const [screen, setScreen] = useState<Screen>("home");
  const [nickname, setNickname] = useState(readLastNickname);
  const [joinCode, setJoinCode] = useState(() =>
    getInviteCode(window.location),
  );
  const [openedFromInvite, setOpenedFromInvite] = useState(() =>
    isInviteLocation(window.location),
  );
  const [roomCode, setRoomCode] = useState("");
  const [players, setPlayers] = useState<Player[]>([]);
  const [round, setRound] = useState(0);
  const [guess, setGuess] = useState("");
  const [stake, setStake] = useState<number>(0);
  const [time, setTime] = useState(ROUND_TIME);
  const [message, setMessage] = useState("");
  const [restoringSession, setRestoringSession] = useState(true);

  // --------------------------------
  // Online multiplayer state
  // --------------------------------

  const [onlineRoom, setOnlineRoom] = useState<Room | null>(null);

  const [onlineUserId, setOnlineUserId] = useState("");

  const [onlineLoading, setOnlineLoading] = useState(false);
  const [onlineRematch, setOnlineRematch] = useState(false);
  const onlineRequestBusy = useRef(false);

  // --------------------------------
  // Refs for local game
  // --------------------------------

  const submittedRef = useRef(false);
  const deadlineRef = useRef(0);
  const playersRef = useRef<Player[]>([]);
  const roundRef = useRef(0);
  const screenRef = useRef<Screen>("home");
  const handleOnlineGameStart = useCallback(() => {
    setOnlineRoom((current) =>
      current ? { ...current, status: "playing" } : current,
    );
    screenRef.current = "onlineGame";
    setScreen("onlineGame");
  }, []);

  const handleRematchLobby = useCallback(() => {
    setOnlineRematch(true);
    setOnlineRoom((current) =>
      current ? { ...current, status: "lobby" } : current,
    );
    screenRef.current = "onlineLobby";
    setScreen("onlineLobby");
  }, []);

  // --------------------------------
  // Derived data
  // --------------------------------

  const currentQuestion = QUESTIONS[round];

  const me = players.find((player) => player.id === "me");

  const availableScore = me?.score ?? STARTING_SCORE;

  const ranking = [...players].sort((a, b) => b.score - a.score);

  // --------------------------------
  // State helpers
  // --------------------------------

  function updateScreen(next: Screen) {
    screenRef.current = next;
    setScreen(next);
  }

  function updatePlayers(next: Player[]) {
    playersRef.current = next;
    setPlayers(next);
  }

  // --------------------------------
  // Online multiplayer functions
  // --------------------------------

  async function handleCreateOnlineRoom() {
    const name = nickname.trim();

    if (!name) {
      setMessage("Enter your nickname first.");
      return;
    }

    if (onlineRequestBusy.current) return;

    onlineRequestBusy.current = true;
    setOnlineLoading(true);
    setMessage("");
    setNickname(name);

    try {
      const { room, user } = await createOnlineRoom(name);

      setOnlineRoom(room);
      setOnlineUserId(user.id);
      setRoomCode(room.code);
      rememberNickname(name);

      updateScreen("onlineLobby");
    } catch (error) {
      console.error("Create room error:", error);

      setMessage(getRoomErrorMessage(error, "Could not create room"));
    } finally {
      onlineRequestBusy.current = false;
      setOnlineLoading(false);
    }
  }

  async function handleJoinOnlineRoom() {
    const name = nickname.trim();
    const code = normalizeRoomCode(joinCode);

    if (!name) {
      setMessage("Enter your nickname first.");
      return;
    }

    if (!ROOM_CODE_PATTERN.test(code)) {
      setMessage("Enter a valid four-character room code.");
      return;
    }

    if (onlineRequestBusy.current) return;

    onlineRequestBusy.current = true;
    setOnlineLoading(true);
    setMessage("");
    setNickname(name);
    setJoinCode(code);

    try {
      const { room, user } = await joinOnlineRoom(code, name);

      setOnlineRoom(room);
      setOnlineUserId(user.id);
      setRoomCode(room.code);
      rememberNickname(name);

      updateScreen(room.status === "lobby" ? "onlineLobby" : "onlineGame");
    } catch (error) {
      console.error("Join room error:", error);

      setMessage(getRoomErrorMessage(error, "Could not join room"));
    } finally {
      onlineRequestBusy.current = false;
      setOnlineLoading(false);
    }
  }

  function leaveOnlineLobby() {
    setOnlineRoom(null);
    setOnlineUserId("");
    setOnlineRematch(false);
    setRoomCode("");
    setMessage("");

    window.history.replaceState({}, "", "/");

    updateScreen("home");
  }

  // --------------------------------
  // Local demo functions
  // --------------------------------

  function createLocalRoom() {
    const name = nickname.trim();

    if (!name) {
      setMessage("Enter your nickname first.");
      return;
    }

    setMessage("");

    setRoomCode(randomCode());

    updatePlayers(createInitialPlayers(name));

    roundRef.current = 0;
    setRound(0);

    updateScreen("lobby");
  }

  const beginQuestion = useCallback(() => {
    submittedRef.current = false;

    setGuess("");
    setStake(0);
    setMessage("");
    setTime(ROUND_TIME);

    deadlineRef.current = Date.now() + ROUND_TIME * 1000;

    screenRef.current = "question";
    setScreen("question");
  }, []);

  function startLocalGame() {
    const resetPlayers = playersRef.current.map((player) => ({
      id: player.id,
      name: player.name,
      score: STARTING_SCORE,
    }));

    updatePlayers(resetPlayers);

    roundRef.current = 0;
    setRound(0);

    beginQuestion();
  }

  const finishRound = useCallback((myGuess: number | null, myStake: number) => {
    const currentRound = roundRef.current;
    const question = QUESTIONS[currentRound];

    if (!question) return;

    const updated = playersRef.current.map((player) => {
      let playerGuess: number | undefined;

      let playerStake: number;

      if (player.id === "me") {
        playerGuess = myGuess ?? undefined;

        playerStake = myGuess === null ? 0 : myStake;
      } else {
        playerGuess = generateBotGuess(question.answer);

        const affordableStakes = STAKES.filter(
          (amount) => amount <= player.score,
        );

        playerStake =
          affordableStakes[Math.floor(Math.random() * affordableStakes.length)];
      }

      const earned =
        playerGuess === undefined
          ? 0
          : calculatePoints(playerGuess, question.answer, playerStake);

      return {
        ...player,
        guess: playerGuess,
        stake: playerStake,
        earned,
        score: Math.max(0, player.score + earned),
      };
    });

    updatePlayers(updated);

    deadlineRef.current = Date.now() + REVEAL_TIME * 1000;

    screenRef.current = "reveal";
    setScreen("reveal");
  }, []);

  function submitGuess() {
    if (submittedRef.current || screenRef.current !== "question") {
      return;
    }

    if (Date.now() >= deadlineRef.current) {
      submittedRef.current = true;
      finishRound(null, 0);
      return;
    }

    const trimmed = guess.trim();
    const value = Number(trimmed);

    if (trimmed === "" || !Number.isSafeInteger(value) || value < 0) {
      setMessage("Enter a valid nonnegative whole number.");
      return;
    }

    if (!STAKES.some((amount) => amount === stake)) {
      setMessage("Invalid stake.");
      return;
    }

    if (stake > availableScore) {
      setMessage("You don't have enough points for that stake.");
      return;
    }

    submittedRef.current = true;
    setMessage("");

    finishRound(value, stake);
  }

  const advanceScreen = useCallback(() => {
    const currentScreen = screenRef.current;

    if (currentScreen === "reveal") {
      deadlineRef.current = Date.now() + LEADERBOARD_TIME * 1000;

      screenRef.current = "leaderboard";

      setScreen("leaderboard");
      return;
    }

    if (currentScreen === "leaderboard") {
      if (roundRef.current >= QUESTIONS.length - 1) {
        screenRef.current = "final";
        setScreen("final");
        return;
      }

      roundRef.current += 1;
      setRound(roundRef.current);

      beginQuestion();
    }
  }, [beginQuestion]);

  useEffect(() => {
    let active = true;

    async function restoreSession() {
      const inviteCode = getInviteCode(window.location);
      const hasInvite = isInviteLocation(window.location);

      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user || !active) return;

        const room = await getMyActiveRoom();

        if (
          !active ||
          !room ||
          (hasInvite && room.code !== inviteCode)
        ) {
          return;
        }

        setOnlineRoom(room);
        setOnlineUserId(user.id);
        setRoomCode(room.code);

        const nextScreen =
          room.status === "lobby" ? "onlineLobby" : "onlineGame";

        screenRef.current = nextScreen;
        setScreen(nextScreen);
      } catch (error) {
        console.error("Session restore failed:", error);
      } finally {
        if (active) {
          if (
            hasInvite &&
            !screenRef.current.startsWith("online")
          ) {
            setJoinCode(inviteCode);
            screenRef.current = "join";
            setScreen("join");
          }

          setRestoringSession(false);
        }
      }
    }

    void restoreSession();

    return () => {
      active = false;
    };
  }, []);
  // --------------------------------
  // Local game countdown
  // --------------------------------

  useEffect(() => {
    if (
      screen !== "question" &&
      screen !== "reveal" &&
      screen !== "leaderboard"
    ) {
      return;
    }

    const interval = window.setInterval(() => {
      const remaining = Math.max(
        0,
        Math.ceil((deadlineRef.current - Date.now()) / 1000),
      );

      if (screenRef.current === "question") {
        setTime(remaining);

        if (remaining === 0 && !submittedRef.current) {
          submittedRef.current = true;
          finishRound(null, 0);
        }
      } else if (
        remaining === 0 &&
        (screenRef.current === "reveal" || screenRef.current === "leaderboard")
      ) {
        advanceScreen();
      }
    }, 100);

    return () => window.clearInterval(interval);
  }, [screen, finishRound, advanceScreen]);

  // --------------------------------
  // Render
  // --------------------------------
  if (restoringSession) {
    return (
      <main className="app">
        <header className="topbar">
          <div className="logo">
            CLOSE<span>CALL.</span>
          </div>
        </header>

        <div className="score-card">
          <strong>RECONNECTING...</strong>
          <p>Checking your last game session.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="app">
      <header className="topbar">
        <div className="logo">
          CLOSE<span>CALL.</span>
        </div>

        <div className="pill">
          {screen === "home" ? "PARTY GAME" : roomCode || "LOCAL"}
        </div>
      </header>

      {/* HOME */}

      {screen === "home" && (
        <>
          <div className="eyebrow">The guessing game</div>

          <h1 className="hero-title">
            THINK.
            <br />
            RISK.
            <br />
            <span>WIN.</span>
          </h1>

          <p className="description">
            Seven rounds. Wild questions. Big bets. One winner. How close can
            you get?
          </p>

          <div className="spacer" />

          <label className="field-label" htmlFor="nickname">
            YOUR NICKNAME
          </label>

          <input
            id="nickname"
            className="field"
            maxLength={18}
            placeholder="Enter nickname"
            value={nickname}
            onChange={(event) => {
              setNickname(event.target.value);
              setMessage("");
            }}
            autoFocus
            autoComplete="nickname"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void handleCreateOnlineRoom();
              }
            }}
          />

          <div className="actions" style={{ marginTop: 16 }}>
            <button
              className="btn btn-primary"
              onClick={handleCreateOnlineRoom}
              disabled={onlineLoading}
            >
              {onlineLoading ? "CREATING ROOM..." : "CREATE ROOM ↗"}
            </button>

            <button
              className="btn btn-secondary"
              onClick={() => {
                setMessage("");
                setOpenedFromInvite(false);
                updateScreen("join");
              }}
            >
              JOIN ROOM
            </button>

            <button className="btn btn-secondary" onClick={createLocalRoom}>
              PLAY LOCAL DEMO
            </button>
          </div>

          {message && (
            <p className="form-error" role="alert">
              {message}
            </p>
          )}

          <p className="muted" style={{ fontSize: 12 }}>
            Online multiplayer is live. Create a room or join your friends.
          </p>
        </>
      )}

      {/* JOIN ROOM */}

      {screen === "join" && (
        <form
          className={openedFromInvite ? "invite-join" : ""}
          onSubmit={(event) => {
            event.preventDefault();
            void handleJoinOnlineRoom();
          }}
        >
          <button
            type="button"
            className="back"
            onClick={() => {
              setMessage("");
              setOpenedFromInvite(false);
              window.history.replaceState({}, "", "/");
              updateScreen("home");
            }}
          >
            ← Back
          </button>

          <div className="eyebrow">
            {openedFromInvite ? "YOU’RE INVITED" : "JOIN A ROOM"}
          </div>

          {openedFromInvite && ROOM_CODE_PATTERN.test(joinCode) && (
            <div className="invite-code-card" aria-label={`Room code ${joinCode}`}>
              <span>YOU’VE BEEN INVITED TO ROOM</span>
              <strong>{joinCode}</strong>
            </div>
          )}

          <h1 className="screen-title">
            {openedFromInvite ? "Join the game." : "Join a room."}
          </h1>

          <p className="description">
            {openedFromInvite && ROOM_CODE_PATTERN.test(joinCode)
              ? `Room ${joinCode} is waiting. Choose a nickname to continue.`
              : "Enter your nickname and the four-character room code shared by your friend."}
          </p>

          <div className="form-group">
            <label className="field-label" htmlFor="join-nickname">
              YOUR NICKNAME
            </label>

            <input
              id="join-nickname"
              className="field"
              maxLength={18}
              placeholder="Enter nickname"
              value={nickname}
              onChange={(event) => {
                setNickname(event.target.value);
                setMessage("");
              }}
              autoFocus
              autoComplete="nickname"
            />
          </div>

          <div className="form-group">
            <label className="field-label" htmlFor="room">
              ROOM CODE
            </label>

            <input
              id="room"
              className="field"
              placeholder="ABCD"
              maxLength={4}
              autoCapitalize="characters"
              autoComplete="off"
              value={joinCode}
              readOnly={openedFromInvite && ROOM_CODE_PATTERN.test(joinCode)}
              aria-invalid={Boolean(
                openedFromInvite && !ROOM_CODE_PATTERN.test(joinCode),
              )}
              onChange={(event) => {
                setJoinCode(normalizeRoomCode(event.target.value));
                setMessage("");
              }}
            />
          </div>

          {openedFromInvite && !ROOM_CODE_PATTERN.test(joinCode) && (
            <div className="invite-error" role="alert">
              <strong>This invitation link isn’t valid.</strong>
              <span>Ask the host for a new link or enter a room code manually.</span>
            </div>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            disabled={
              onlineLoading ||
              !nickname.trim() ||
              !ROOM_CODE_PATTERN.test(joinCode)
            }
          >
            {onlineLoading ? "JOINING..." : "JOIN GAME →"}
          </button>

          {message && (
            <p className="form-error" role="alert">
              {message}
            </p>
          )}
        </form>
      )}

      {/* ONLINE LOBBY */}

      {screen === "onlineLobby" && onlineRoom && (
        <MultiplayerLobby
          room={onlineRoom}
          userId={onlineUserId}
          isRematch={onlineRematch}
          onLeave={leaveOnlineLobby}
          onGameStart={handleOnlineGameStart}
        />
      )}

      {screen === "onlineGame" && onlineRoom && (
        <MultiplayerGame
          room={onlineRoom}
          userId={onlineUserId}
          onLeave={leaveOnlineLobby}
          onRematchLobby={handleRematchLobby}
        />
      )}

      {/* LOCAL LOBBY */}

      {screen === "lobby" && (
        <>
          <div className="eyebrow">Local demo lobby</div>

          <h1 className="screen-title">Ready to play?</h1>

          <div className="room-code">
            <span>DEMO ROOM</span>
            <strong>{roomCode}</strong>
          </div>

          <div className="eyebrow">Players · {players.length}/10</div>

          <div className="player-list">
            {players.map((player) => (
              <div className="player" key={player.id}>
                <strong>{player.name}</strong>

                <span className="muted">
                  {player.id === "me" ? "YOU" : "BOT"}
                </span>
              </div>
            ))}
          </div>

          <div className="spacer" />

          <button className="btn btn-primary" onClick={startLocalGame}>
            START GAME →
          </button>
        </>
      )}

      {/* QUESTION */}

      {screen === "question" && currentQuestion && (
        <>
          <div className="eyebrow">
            Round {round + 1} / {QUESTIONS.length}
          </div>

          <h1 className="question">{currentQuestion.text}</h1>

          <div className="timer-track">
            <div
              className="timer-fill"
              style={{
                width: `${(time / ROUND_TIME) * 100}%`,
              }}
            />
          </div>

          <div className="eyebrow">{time} SECONDS LEFT</div>

          <div className="spacer" />

          <label className="field-label" htmlFor="guess">
            YOUR GUESS
          </label>

          <input
            id="guess"
            className="guess-input"
            type="number"
            min="0"
            step="1"
            inputMode="numeric"
            placeholder="?"
            value={guess}
            onChange={(event) => setGuess(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                submitGuess();
              }
            }}
          />

          <p
            className="field-label"
            style={{
              marginTop: 26,
            }}
          >
            YOUR STAKE · BALANCE {availableScore}
          </p>

          <div className="stakes">
            {STAKES.map((amount) => (
              <button
                key={amount}
                className={`stake ${stake === amount ? "selected" : ""}`}
                disabled={amount > availableScore}
                onClick={() => setStake(amount)}
              >
                {amount === 0 ? "SAFE" : amount}
              </button>
            ))}
          </div>

          <button className="btn btn-primary" onClick={submitGuess}>
            LOCK GUESS →
          </button>
        </>
      )}

      {/* REVEAL */}

      {screen === "reveal" && currentQuestion && (
        <>
          <div className="eyebrow">Round {round + 1} result</div>

          <h1 className="screen-title">The answer is...</h1>

          <div className="score-card">
            <span className="muted">CORRECT ANSWER</span>

            <strong>{currentQuestion.answer.toLocaleString()}</strong>

            <p>{currentQuestion.explanation}</p>
          </div>

          <div
            className="eyebrow"
            style={{
              marginTop: 20,
            }}
          >
            All guesses
          </div>

          {[...players]
            .sort((a, b) => {
              const errorA =
                a.guess === undefined
                  ? Infinity
                  : Math.abs(a.guess - currentQuestion.answer);

              const errorB =
                b.guess === undefined
                  ? Infinity
                  : Math.abs(b.guess - currentQuestion.answer);

              return errorA - errorB;
            })
            .map((player) => (
              <div className="result-row" key={player.id}>
                <div>
                  <strong>{player.name}</strong>

                  <div className="muted">
                    {player.guess?.toLocaleString() ?? "No answer"}
                  </div>
                </div>

                <strong>
                  {(player.earned ?? 0) >= 0 ? "+" : ""}
                  {player.earned ?? 0}
                </strong>
              </div>
            ))}

          <div className="spacer" />

          <button className="btn btn-primary" onClick={advanceScreen}>
            SEE STANDINGS →
          </button>
        </>
      )}

      {/* LEADERBOARD / FINAL */}

      {(screen === "leaderboard" || screen === "final") && (
        <>
          <div className="eyebrow">
            {screen === "final" ? "Game complete" : `After round ${round + 1}`}
          </div>

          <h1 className="screen-title">
            {screen === "final" ? "The champion." : "Leaderboard."}
          </h1>

          {screen === "final" && (
            <div className="score-card">
              <span className="muted">WINNER</span>

              <strong>{ranking[0]?.name}</strong>

              <p>{ranking[0]?.score.toLocaleString()} points</p>
            </div>
          )}

          <div className="player-list">
            {ranking.map((player, index) => (
              <div className="player" key={player.id}>
                <strong>
                  #{index + 1} {player.name}
                </strong>

                <strong>{player.score.toLocaleString()}</strong>
              </div>
            ))}
          </div>

          <div className="spacer" />

          {screen === "final" ? (
            <button className="btn btn-primary" onClick={startLocalGame}>
              PLAY AGAIN ↗
            </button>
          ) : (
            <button className="btn btn-primary" onClick={advanceScreen}>
              {round === QUESTIONS.length - 1
                ? "FINAL RESULTS →"
                : "NEXT ROUND →"}
            </button>
          )}
        </>
      )}

      {/* ERROR MESSAGE */}

      {message && screen !== "join" && (
        <p
          role="alert"
          style={{
            color: "#ff9a87",
            marginTop: 16,
          }}
        >
          {message}
        </p>
      )}
    </main>
  );
}

export default App;
