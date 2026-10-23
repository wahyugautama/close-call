import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { startOnlineGame } from "../lib/rooms";
import { getRoomPlayers, type Room, type RoomPlayer } from "../lib/rooms";

type Props = {
  room: Room;
  userId: string;
  onLeave: () => void;
  onGameStart: () => void;
};

export default function MultiplayerLobby({
  room,
  userId,
  onLeave,
  onGameStart,
}: Props) {
  const [starting, setStarting] = useState(false);

  async function handleStartGame() {
    if (starting || players.length < 2) return;

    setStarting(true);
    setError("");

    try {
      await startOnlineGame(room.id);
      alert("Game started successfully!");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start game");
    } finally {
      setStarting(false);
    }
  }
  const [players, setPlayers] = useState<RoomPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const isHost = room.host_id === userId;

  const refreshPlayers = useCallback(async () => {
    try {
      const data = await getRoomPlayers(room.id);
      setPlayers(data);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load players");
    } finally {
      setLoading(false);
    }
  }, [room.id]);

  useEffect(() => {
    let active = true;

    async function checkGame() {
      const { data, error } = await supabase
        .from("rooms")
        .select("status")
        .eq("id", room.id)
        .single();

      if (!active || error) return;

      if (data.status === "playing") {
        onGameStart();
      }
    }

    const interval = window.setInterval(() => {
      void checkGame();
    }, 1000);

    void checkGame();

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [room.id, onGameStart]);

  useEffect(() => {
    const initialFetch = window.setTimeout(() => {
      void refreshPlayers();
    }, 0);

    const channel = supabase
      .channel(`room-players-${room.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "players",
          filter: `room_id=eq.${room.id}`,
        },
        () => {
          void refreshPlayers();
        },
      )
      .subscribe();

    // Polling fallback in case a Realtime event is missed.
    const interval = window.setInterval(() => {
      void refreshPlayers();
    }, 5000);

    const onFocus = () => {
      void refreshPlayers();
    };

    window.addEventListener("focus", onFocus);

    return () => {
      window.clearTimeout(initialFetch);
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      void supabase.removeChannel(channel);
    };
  }, [room.id, refreshPlayers]);

  async function copyInvite() {
    const url = new URL(window.location.href);
    url.searchParams.set("room", room.code);

    try {
      await navigator.clipboard.writeText(url.toString());
      setCopied(true);
    } catch {
      setError("Could not copy link. Share the room code instead.");
    }
  }

  return (
    <>
      <button className="back" onClick={onLeave}>
        ← Back to home
      </button>

      <div className="eyebrow" style={{ marginTop: 30 }}>
        Multiplayer lobby
      </div>

      <h1 className="screen-title">Get your friends in.</h1>

      <p className="description">
        Share the room code with your friends. Everyone plays on their own
        phone.
      </p>

      <div className="room-code">
        <span>ROOM CODE</span>
        <strong>{room.code}</strong>
      </div>

      <button className="btn btn-secondary" onClick={copyInvite}>
        {copied ? "LINK COPIED ✓" : "COPY INVITE LINK ↗"}
      </button>

      <div className="eyebrow" style={{ marginTop: 32 }}>
        PLAYERS · {players.length}/10
      </div>

      {loading && <p className="muted">Loading players...</p>}

      <div className="player-list">
        {players.map((player) => (
          <div className="player" key={player.id}>
            <strong>
              {player.nickname}
              {player.user_id === userId ? " (You)" : ""}
            </strong>

            <span className="muted">
              {player.user_id === room.host_id ? "HOST" : "READY"}
            </span>
          </div>
        ))}
      </div>

      {error && (
        <p role="alert" style={{ color: "#ff9a87" }}>
          {error}
        </p>
      )}

      <div className="spacer" />

      {isHost ? (
        <>
          <button
            className="btn btn-primary"
            onClick={handleStartGame}
            disabled={starting || players.length < 2}
          >
            {starting ? "STARTING..." : "START GAME →"}
          </button>
          <p className="muted" style={{ fontSize: 12 }}>
            Game synchronization will be added in Stage 3.
          </p>
        </>
      ) : (
        <div className="score-card">
          <strong style={{ fontSize: 24 }}>Waiting for host...</strong>
          <p className="muted">
            The host will start the game when everyone joins.
          </p>
        </div>
      )}
    </>
  );
}
