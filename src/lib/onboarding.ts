const TUTORIAL_KEY = "close-call-tutorial-complete-v1";
const NICKNAME_KEY = "close-call-last-nickname-v1";

export function readLastNickname() {
  try {
    return window.localStorage.getItem(NICKNAME_KEY)?.slice(0, 18) ?? "";
  } catch {
    return "";
  }
}

export function rememberNickname(nickname: string) {
  try {
    window.localStorage.setItem(NICKNAME_KEY, nickname.trim().slice(0, 18));
  } catch {
    // Remembering a nickname is optional and never affects authentication.
  }
}

export function shouldShowTutorial() {
  try {
    return window.localStorage.getItem(TUTORIAL_KEY) !== "complete";
  } catch {
    return true;
  }
}

export function markTutorialComplete() {
  try {
    window.localStorage.setItem(TUTORIAL_KEY, "complete");
  } catch {
    // Completion remains best-effort when storage is unavailable.
  }
}
