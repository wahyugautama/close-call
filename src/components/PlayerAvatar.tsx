import type { CSSProperties } from "react";
import "./PlayerAvatar.css";

type Props = {
  playerId: string;
  nickname: string;
  size?: "small" | "medium" | "large";
  isCurrentPlayer?: boolean;
  isWinner?: boolean;
};

const VARIANTS = [
  ["#c9ff57", "#253312", "#ff856c"],
  ["#ff856c", "#421b18", "#c9ff57"],
  ["#78d6ff", "#123344", "#ffd166"],
  ["#b49cff", "#2d2250", "#ff856c"],
  ["#ffd166", "#49380c", "#78d6ff"],
  ["#66e0b5", "#123d32", "#ff8fab"],
  ["#ff8fab", "#4a1f31", "#c9ff57"],
  ["#ffad66", "#4a2910", "#9ae6ff"],
  ["#9ae6ff", "#183b47", "#d5a6ff"],
  ["#d5a6ff", "#3b2450", "#ffd166"],
] as const;

function hashPlayerId(playerId: string) {
  let hash = 2166136261;

  for (let index = 0; index < playerId.length; index += 1) {
    hash ^= playerId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

export default function PlayerAvatar({
  playerId,
  nickname,
  size = "medium",
  isCurrentPlayer = false,
  isWinner = false,
}: Props) {
  const variant = hashPlayerId(playerId) % VARIANTS.length;
  const [background, face, accent] = VARIANTS[variant];
  const isRound = variant % 3 === 0;
  const hasWink = variant % 4 === 1;
  const hasTeeth = variant % 2 === 0;
  const style = {
    "--avatar-bg": background,
    "--avatar-face": face,
    "--avatar-accent": accent,
  } as CSSProperties;

  return (
    <span
      className={`player-avatar player-avatar--${size} ${
        isCurrentPlayer ? "is-current" : ""
      } ${isWinner ? "is-winner" : ""}`}
      style={style}
      data-variant={variant}
      data-player-name={nickname}
      aria-hidden="true"
    >
      <svg viewBox="0 0 100 100" focusable="false">
        <path
          className="player-avatar__decoration"
          d={
            variant % 2 === 0
              ? "M8 28 22 8l9 24ZM72 7l19 14-17 11Z"
              : "M5 68 25 57l3 24ZM74 4l13 22-22-2Z"
          }
        />
        {isRound ? (
          <circle className="player-avatar__head" cx="50" cy="54" r="32" />
        ) : (
          <rect
            className="player-avatar__head"
            x="20"
            y="22"
            width="60"
            height="64"
            rx={variant % 2 === 0 ? 18 : 8}
            transform={variant % 5 === 2 ? "rotate(7 50 54)" : undefined}
          />
        )}
        <circle className="player-avatar__eye" cx="39" cy="50" r="4" />
        {hasWink ? (
          <path className="player-avatar__line" d="M58 51h9" />
        ) : (
          <circle className="player-avatar__eye" cx="63" cy="50" r="4" />
        )}
        <path
          className="player-avatar__mouth"
          d={hasTeeth ? "M37 64h27c-2 13-23 14-27 0Z" : "M38 67q12 9 25-1"}
        />
        {hasTeeth && <path className="player-avatar__teeth" d="M39 66h23" />}
        <circle className="player-avatar__cheek" cx="31" cy="60" r="4" />
        <circle className="player-avatar__cheek" cx="71" cy="60" r="4" />
      </svg>
    </span>
  );
}
