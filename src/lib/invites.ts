export const ROOM_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{4}$/;

export function normalizeRoomCode(value: string) {
  return value.trim().toUpperCase();
}

export function getInviteCode(location: Location) {
  const pathMatch = location.pathname.match(/^\/join\/([^/]+)\/?$/i);

  if (pathMatch) {
    try {
      return normalizeRoomCode(decodeURIComponent(pathMatch[1]));
    } catch {
      return normalizeRoomCode(pathMatch[1]);
    }
  }

  return normalizeRoomCode(
    new URLSearchParams(location.search).get("room") ?? "",
  );
}

export function isInviteLocation(location: Location) {
  return (
    /^\/join(?:\/|$)/i.test(location.pathname) ||
    new URLSearchParams(location.search).has("room")
  );
}

export function createInviteUrl(roomCode: string) {
  const code = normalizeRoomCode(roomCode);
  return `${window.location.origin}/join/${encodeURIComponent(code)}`;
}
