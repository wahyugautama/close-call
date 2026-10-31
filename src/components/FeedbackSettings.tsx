import { playSound, primeAudio } from "../lib/audio";
import {
  hapticsAreSupported,
  updateFeedbackPreferences,
  useFeedbackPreferences,
} from "../lib/feedbackPreferences";
import "./FeedbackSettings.css";

export default function FeedbackSettings() {
  const preferences = useFeedbackPreferences();
  const supportsHaptics = hapticsAreSupported();

  const handleSoundChange = async (enabled: boolean) => {
    updateFeedbackPreferences({ soundEnabled: enabled });

    if (enabled && (await primeAudio())) {
      playSound("tap", preferences.volume);
    }
  };

  return (
    <details className="feedback-settings">
      <summary aria-label="Open sound and haptic settings">
        <span aria-hidden="true">{preferences.soundEnabled ? "🔊" : "🔇"}</span>
        <span className="feedback-settings__label">FEEDBACK</span>
      </summary>

      <div className="feedback-settings__panel">
        <label className="feedback-settings__toggle">
          <span>Sound effects</span>
          <input
            type="checkbox"
            checked={preferences.soundEnabled}
            onChange={(event) => void handleSoundChange(event.target.checked)}
          />
        </label>

        <label className="feedback-settings__volume">
          <span>Volume · {preferences.volume}%</span>
          <input
            type="range"
            min="0"
            max="100"
            value={preferences.volume}
            disabled={!preferences.soundEnabled}
            aria-label="Sound effects volume"
            onChange={(event) =>
              updateFeedbackPreferences({ volume: Number(event.target.value) })
            }
          />
        </label>

        <label className="feedback-settings__toggle">
          <span>📳 Haptics</span>
          <input
            type="checkbox"
            checked={preferences.hapticsEnabled}
            disabled={!supportsHaptics}
            onChange={(event) =>
              updateFeedbackPreferences({
                hapticsEnabled: event.target.checked,
              })
            }
          />
        </label>

        {!supportsHaptics && (
          <span className="feedback-settings__unsupported">
            Vibration isn’t supported on this device.
          </span>
        )}
      </div>
    </details>
  );
}
