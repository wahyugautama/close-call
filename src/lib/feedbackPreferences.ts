import { useSyncExternalStore } from "react";

export type FeedbackPreferences = {
  soundEnabled: boolean;
  volume: number;
  hapticsEnabled: boolean;
};

const STORAGE_KEY = "close-call-feedback-v1";
const listeners = new Set<() => void>();

function supportsHaptics() {
  return typeof navigator !== "undefined" && "vibrate" in navigator;
}

function defaults(): FeedbackPreferences {
  return {
    soundEnabled: false,
    volume: 35,
    hapticsEnabled: supportsHaptics(),
  };
}

function readPreferences(): FeedbackPreferences {
  const fallback = defaults();

  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return fallback;

    const parsed = JSON.parse(stored) as Partial<FeedbackPreferences>;

    return {
      soundEnabled:
        typeof parsed.soundEnabled === "boolean"
          ? parsed.soundEnabled
          : fallback.soundEnabled,
      volume:
        typeof parsed.volume === "number"
          ? Math.min(100, Math.max(0, Math.round(parsed.volume)))
          : fallback.volume,
      hapticsEnabled:
        supportsHaptics() &&
        (typeof parsed.hapticsEnabled === "boolean"
          ? parsed.hapticsEnabled
          : fallback.hapticsEnabled),
    };
  } catch {
    return fallback;
  }
}

let currentPreferences = readPreferences();

export function updateFeedbackPreferences(
  update: Partial<FeedbackPreferences>,
) {
  currentPreferences = { ...currentPreferences, ...update };

  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(currentPreferences),
    );
  } catch {
    // Preferences still apply for the current page when storage is unavailable.
  }

  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY) return;
    currentPreferences = readPreferences();
    listeners.forEach((currentListener) => currentListener());
  };

  window.addEventListener("storage", handleStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", handleStorage);
  };
}

function getSnapshot() {
  return currentPreferences;
}

export function useFeedbackPreferences() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function hapticsAreSupported() {
  return supportsHaptics();
}
