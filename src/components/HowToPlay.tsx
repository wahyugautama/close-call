import { useCallback, useEffect, useRef, useState } from "react";
import { markTutorialComplete } from "../lib/onboarding";
import "./HowToPlay.css";

type Props = {
  onClose: () => void;
};

const STEPS = [
  {
    number: "01",
    title: "Guess the number",
    description:
      "Estimate the answer before time runs out. Closer guesses generally earn more points.",
    visual: "?  →  1,250",
  },
  {
    number: "02",
    title: "Choose your stake",
    description:
      "Play Safe, or risk 100 points within 15% or 250 points within 5%. Stakes can add or subtract points.",
    visual: "SAFE  ·  100  ·  250",
  },
  {
    number: "03",
    title: "Win after seven rounds",
    description:
      "See every confirmed result, climb the leaderboard, and finish with the highest score to win.",
    visual: "7 ROUNDS  →  ♛",
  },
] as const;

export default function HowToPlay({ onClose }: Props) {
  const [step, setStep] = useState(0);
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  const handleClose = useCallback(() => {
    markTutorialComplete();
    onClose();
  }, [onClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeButton.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        handleClose();
        return;
      }

      if (event.key !== "Tab" || !dialog.current) return;

      const focusable = Array.from(
        dialog.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      const first = focusable[0];
      const last = focusable.at(-1);

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [handleClose]);

  const currentStep = STEPS[step];
  const isLastStep = step === STEPS.length - 1;

  return (
    <div
      className="tutorial-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) handleClose();
      }}
    >
      <div
        ref={dialog}
        className="tutorial-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tutorial-title"
        aria-describedby="tutorial-description"
      >
        <div className="tutorial-header">
          <span>HOW TO PLAY · {currentStep.number}/03</span>
          <button
            ref={closeButton}
            type="button"
            aria-label="Skip tutorial"
            onClick={handleClose}
          >
            SKIP
          </button>
        </div>

        <div className="tutorial-progress" aria-hidden="true">
          {STEPS.map((item, index) => (
            <span key={item.number} className={index <= step ? "is-active" : ""} />
          ))}
        </div>

        <div className="tutorial-visual" aria-hidden="true">
          {currentStep.visual}
        </div>

        <h2 id="tutorial-title">{currentStep.title}</h2>
        <p id="tutorial-description">{currentStep.description}</p>

        <div className="tutorial-actions">
          <button
            className="btn btn-secondary"
            type="button"
            disabled={step === 0}
            onClick={() => setStep((current) => current - 1)}
          >
            BACK
          </button>
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => {
              if (isLastStep) {
                handleClose();
              } else {
                setStep((current) => current + 1);
              }
            }}
          >
            {isLastStep ? "GOT IT ✓" : "NEXT →"}
          </button>
        </div>
      </div>
    </div>
  );
}
