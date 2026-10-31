export type SoundEffect =
  | "tap"
  | "guessLocked"
  | "countdown"
  | "reveal"
  | "positivePoints"
  | "negativePoints"
  | "winner";

let audioContext: AudioContext | null = null;

function getAudioContext() {
  if (audioContext) return audioContext;

  const AudioContextConstructor =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;

  if (!AudioContextConstructor) return null;

  try {
    audioContext = new AudioContextConstructor();
    return audioContext;
  } catch {
    return null;
  }
}

export async function primeAudio() {
  const context = getAudioContext();
  if (!context) return false;

  try {
    if (context.state === "suspended") await context.resume();
    return context.state === "running";
  } catch {
    return false;
  }
}

type Note = {
  frequency: number;
  offset: number;
  duration: number;
  type?: OscillatorType;
};

const EFFECTS: Record<SoundEffect, Note[]> = {
  tap: [{ frequency: 420, offset: 0, duration: 0.045 }],
  guessLocked: [
    { frequency: 520, offset: 0, duration: 0.07 },
    { frequency: 780, offset: 0.065, duration: 0.11 },
  ],
  countdown: [{ frequency: 360, offset: 0, duration: 0.065 }],
  reveal: [
    { frequency: 330, offset: 0, duration: 0.09, type: "triangle" },
    { frequency: 660, offset: 0.08, duration: 0.16, type: "triangle" },
  ],
  positivePoints: [
    { frequency: 480, offset: 0, duration: 0.08 },
    { frequency: 720, offset: 0.07, duration: 0.13 },
  ],
  negativePoints: [
    { frequency: 260, offset: 0, duration: 0.1, type: "triangle" },
    { frequency: 190, offset: 0.08, duration: 0.14, type: "triangle" },
  ],
  winner: [
    { frequency: 440, offset: 0, duration: 0.12 },
    { frequency: 554, offset: 0.1, duration: 0.12 },
    { frequency: 659, offset: 0.2, duration: 0.2 },
  ],
};

export function playSound(effect: SoundEffect, volume: number) {
  if (document.visibilityState !== "visible" || volume <= 0) return;

  const context = audioContext;
  if (!context || context.state !== "running") return;

  const normalizedVolume = Math.min(1, Math.max(0, volume / 100)) * 0.12;
  const startTime = context.currentTime;

  EFFECTS[effect].forEach((note) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const noteStart = startTime + note.offset;
    const noteEnd = noteStart + note.duration;

    oscillator.type = note.type ?? "sine";
    oscillator.frequency.setValueAtTime(note.frequency, noteStart);
    gain.gain.setValueAtTime(0.0001, noteStart);
    gain.gain.exponentialRampToValueAtTime(normalizedVolume, noteStart + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, noteEnd);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(noteStart);
    oscillator.stop(noteEnd + 0.01);
    oscillator.addEventListener("ended", () => {
      oscillator.disconnect();
      gain.disconnect();
    });
  });
}
