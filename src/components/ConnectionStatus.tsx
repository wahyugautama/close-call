import { useEffect, useState } from "react";
import "./ConnectionStatus.css";

export type RealtimeConnectionState =
  | "connecting"
  | "connected"
  | "disconnected";

type Props = {
  realtimeState: RealtimeConnectionState;
  lastSuccessfulPoll: number | null;
  className?: string;
};

const POLL_FRESHNESS_MS = 10_000;
const RECONNECT_DELAY_MS = 1_200;

export default function ConnectionStatus({
  realtimeState,
  lastSuccessfulPoll,
  className = "",
}: Props) {
  const [browserOnline, setBrowserOnline] = useState(navigator.onLine);
  const [now, setNow] = useState(() => Date.now());
  const pollIsFresh =
    lastSuccessfulPoll !== null && now - lastSuccessfulPoll < POLL_FRESHNESS_MS;
  const immediateState = !browserOnline
    ? "offline"
    : realtimeState === "connected" || pollIsFresh
      ? "connected"
      : "reconnecting";
  const [visibleState, setVisibleState] = useState(immediateState);

  useEffect(() => {
    const handleOnline = () => setBrowserOnline(true);
    const handleOffline = () => setBrowserOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 2_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(
      () => setVisibleState(immediateState),
      immediateState === "reconnecting" ? RECONNECT_DELAY_MS : 0,
    );

    return () => window.clearTimeout(timeout);
  }, [immediateState]);

  const usingPolling =
    visibleState === "connected" && realtimeState !== "connected";
  const label =
    visibleState === "offline"
      ? "Offline"
      : visibleState === "reconnecting"
        ? "Reconnecting"
        : usingPolling
          ? "Connected · polling"
          : "Connected";

  return (
    <div
      className={`connection-status is-${visibleState} ${className}`.trim()}
      role="status"
      aria-live="polite"
    >
      <span className="connection-status__dot" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}
