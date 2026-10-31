export type HapticEffect = "stake" | "guessLocked" | "reveal" | "winner";

const PATTERNS: Record<HapticEffect, number | number[]> = {
  stake: 10,
  guessLocked: 20,
  reveal: 15,
  winner: [30, 40, 30],
};

export function triggerHaptic(effect: HapticEffect, enabled: boolean) {
  if (
    !enabled ||
    document.visibilityState !== "visible" ||
    typeof navigator.vibrate !== "function"
  ) {
    return false;
  }

  try {
    return navigator.vibrate(PATTERNS[effect]);
  } catch {
    return false;
  }
}
