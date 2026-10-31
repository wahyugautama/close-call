import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { startOnlineGame } from "../lib/rooms";
import {
  getRoomErrorMessage,
  getRoomPlayers,
  type Room,
  type RoomPlayer,
} from "../lib/rooms";
import { createInviteUrl } from "../lib/invites";
import PlayerAvatar from "./PlayerAvatar";
import ConnectionStatus, {
  type RealtimeConnectionState,
} from "./ConnectionStatus";
import FeedbackSettings from "./FeedbackSettings";
import HowToPlay from "./HowToPlay";
import { shouldShowTutorial } from "../lib/onboarding";

type Props = {
  room: Room;
  userId: string;
  isRematch?: boolean;
  onLeave: () => void;
  onGameStart: () => void;
};

export default function MultiplayerLobby({
  room,
  userId,
  isRematch = false,
  onLeave,
  onGameStart,
}: Props) {
  const [starting, setStarting] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(
    () => !isRematch && shouldShowTutorial(),
  );
  const startRequestBusy = useRef(false);

  async function handleStartGame() {
    if (startRequestBusy.current || players.length < 2) return;

    startRequestBusy.current = true;
    setStarting(true);
    setError("");

    try {
      await startOnlineGame(room.id);
    } catch (err) {
      setError(getRoomErrorMessage(err, "Failed to start game"));
    } finally {
      startRequestBusy.current = false;
      setStarting(false);
    }
  }
  const [players, setPlayers] = useState<RoomPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [shareStatus, setShareStatus] = useState("");
  const [realtimeState, setRealtimeState] =
    useState<RealtimeConnectionState>("connecting");
  const [lastSuccessfulPoll, setLastSuccessfulPoll] = useState<number | null>(
    null,
  );
  const [presenceReady, setPresenceReady] = useState(false);
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const playerRefreshBusy = useRef(false);
  const playerRefreshQueued = useRef(false);

  const isHost = room.host_id === userId;
  const hostPlayer = players.find((player) => player.user_id === room.host_id);
  const handleCloseTutorial = useCallback(() => setTutorialOpen(false), []);

  const refreshPlayers = useCallback(async () => {
    if (playerRefreshBusy.current) {
      playerRefreshQueued.current = true;
      return;
    }

    playerRefreshBusy.current = true;

    do {
      playerRefreshQueued.current = false;

      try {
        const data = await getRoomPlayers(room.id);
        setPlayers(data);
        setLastSuccessfulPoll(Date.now());
        setError("");
      } catch (err) {
        setError(getRoomErrorMessage(err, "Failed to load players"));
      } finally {
        setLoading(false);
      }
    } while (playerRefreshQueued.current);

    playerRefreshBusy.current = false;
  }, [room.id]);

  useEffect(() => {
    let active = true;
    let checkBusy = false;
    let checkQueued = false;

    async function checkGame() {
      if (checkBusy) {
        checkQueued = true;
        return;
      }

      checkBusy = true;

      do {
        checkQueued = false;

        const { data, error } = await supabase
          .from("rooms")
          .select("status")
          .eq("id", room.id)
          .single();

        if (!active) break;

        if (!error) {
          setLastSuccessfulPoll(Date.now());

          if (data.status === "playing") {
            setTutorialOpen(false);
            onGameStart();
          }
        }
      } while (active && checkQueued);

      checkBusy = false;
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
      .channel(`room-presence-${room.id}`, {
        config: { presence: { key: userId } },
      })
      .on("presence", { event: "sync" }, () => {
        const presenceState = channel.presenceState();
        const presentUserIds = new Set<string>();

        for (const presences of Object.values(presenceState)) {
          for (const presence of presences) {
            if (
              typeof presence === "object" &&
              presence !== null &&
              "user_id" in presence &&
              typeof presence.user_id === "string"
            ) {
              presentUserIds.add(presence.user_id);
            }
          }
        }

        setOnlineUserIds(presentUserIds);
        setPresenceReady(true);
      })
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
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setRealtimeState("connected");
          void channel.track({
            user_id: userId,
            online_at: new Date().toISOString(),
          });
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
      void channel.untrack();
      void supabase.removeChannel(channel);
    };
  }, [room.id, userId, refreshPlayers]);

  async function copyText(value: string, successMessage: string) {
    if (!navigator.clipboard?.writeText) {
      setError("Copying is unavailable. Share the room code manually.");
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      setShareStatus(successMessage);
      setError("");
    } catch {
      setError("Copy failed. Share the room code manually.");
    }
  }

  async function shareInvite() {
    if (!navigator.share) return;

    try {
      await navigator.share({
        title: "Join my Close Call game",
        text: `Join room ${room.code} in Close Call.`,
        url: createInviteUrl(room.code),
      });
      setShareStatus("INVITE SHARED ✓");
      setError("");
    } catch (shareError) {
      if (shareError instanceof DOMException && shareError.name === "AbortError") {
        return;
      }

      setError("Sharing failed. Copy the invite link instead.");
    }
  }
  return (
    <>
      <div className="lobby-utility-row">
        <button className="back" type="button" onClick={onLeave}>
          ← Leave room
        </button>
        <div className="lobby-utility-actions">
          <ConnectionStatus
            realtimeState={realtimeState}
            lastSuccessfulPoll={lastSuccessfulPoll}
          />
          <FeedbackSettings />
        </div>
      </div>

      <div className="eyebrow" style={{ marginTop: 30 }}>
        {isRematch ? "Rematch lobby" : "Multiplayer lobby"}
      </div>

      <h1 className="screen-title">
        {isRematch ? "Ready for another one?" : "Get your friends in."}
      </h1>

      <p className="description">
        {isRematch
          ? "Same room, same players. The host can start the next match."
          : "Share the room code with your friends. Everyone plays on their own phone."}
      </p>

      <div className="room-code">
        <span>ROOM CODE</span>
        <strong>{room.code}</strong>
      </div>

      <div className="lobby-share-actions">
        <button
          className="btn btn-secondary"
          type="button"
          onClick={() => void copyText(room.code, "CODE COPIED ✓")}
        >
          COPY CODE
        </button>

        <button
          className="btn btn-secondary"
          type="button"
          onClick={() =>
            void copyText(createInviteUrl(room.code), "LINK COPIED ✓")
          }
        >
          COPY INVITE LINK
        </button>

        {typeof navigator.share === "function" && (
          <button
            className="btn btn-secondary"
            type="button"
            onClick={() => void shareInvite()}
          >
            SHARE ↗
          </button>
        )}
      </div>

      <button
        className="lobby-how-to"
        type="button"
        onClick={() => setTutorialOpen(true)}
      >
        <span aria-hidden="true">?</span>
        HOW TO PLAY
      </button>

      {shareStatus && (
        <p className="share-status" role="status">
          {shareStatus}
        </p>
      )}

      <div className="lobby-player-summary" style={{ marginTop: 32 }}>
        <span className="eyebrow">PLAYERS · {players.length}/10</span>
        <span>
          {presenceReady
            ? `${players.filter((player) => onlineUserIds.has(player.user_id)).length} ONLINE`
            : "STATUS UNKNOWN"}
        </span>
      </div>

      <p className="lobby-host-line">
        HOST · {hostPlayer?.nickname ?? "CONNECTING…"}
      </p>

      {loading && <p className="muted">Loading players...</p>}

      <div className="player-list">
        {players.map((player) => (
          <div
            className={`player lobby-player ${
              player.user_id === userId ? "is-current" : ""
            }`}
            key={player.id}
          >
            <PlayerAvatar
              playerId={player.id}
              nickname={player.nickname}
              isCurrentPlayer={player.user_id === userId}
            />

            <div className="lobby-player__identity">
              <strong>{player.nickname}</strong>
              <span>
                {player.user_id === userId ? "YOU · " : ""}
                {!presenceReady
                  ? "STATUS UNKNOWN"
                  : onlineUserIds.has(player.user_id)
                    ? "ONLINE"
                    : "OFFLINE"}
              </span>
            </div>

            <span className="lobby-player__badge">
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
            {starting
              ? "STARTING..."
              : isRematch
                ? "START REMATCH →"
                : "START GAME →"}
          </button>
          {players.length < 2 && (
            <p className="host-control-hint" role="status">
              At least 2 players are required to start.
            </p>
          )}
        </>
      ) : (
        <div className="score-card">
          <strong style={{ fontSize: 24 }}>Waiting for host...</strong>
          <p className="muted">
            The host will start the game when everyone joins.
          </p>
        </div>
      )}

      {tutorialOpen && <HowToPlay onClose={handleCloseTutorial} />}
    </>
  );
}
