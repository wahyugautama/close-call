import { supabase } from "./supabase";
import { ensurePlayerSession } from "./playerSession";

export type Room = {
  id: string;
  code: string;
  host_id: string;
  status: "lobby" | "playing" | "finished";
};

export type RoomPlayer = {
  id: string;
  room_id: string;
  user_id: string;
  nickname: string;
  score: number;
  joined_at: string;
};

export function getRoomErrorMessage(error: unknown, fallback: string) {
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === "object" &&
          error !== null &&
          "message" in error &&
          typeof error.message === "string"
        ? error.message
        : "";
  const normalized = rawMessage.toLowerCase();

  if (normalized.includes("not found")) {
    return "That room code doesn’t exist. Check the code and try again.";
  }

  if (normalized.includes("finished") || normalized.includes("expired")) {
    return "That game has finished. Ask the host for a new invitation.";
  }

  if (normalized.includes("full")) {
    return "That room is full.";
  }

  if (normalized.includes("started") || normalized.includes("playing")) {
    return "That game has already started.";
  }

  if (normalized.includes("nickname") && normalized.includes("taken")) {
    return "That nickname is already in use in this room.";
  }

  if (
    normalized.includes("failed to fetch") ||
    normalized.includes("network") ||
    normalized.includes("offline")
  ) {
    return "You appear to be offline. Check your connection and try again.";
  }

  if (
    normalized.includes("nickname") &&
    (normalized.includes("long") || normalized.includes("length"))
  ) {
    return "Nicknames can be up to 18 characters.";
  }

  if (normalized.includes("permission") || normalized.includes("authorized")) {
    return "We couldn’t verify access to that room. Please try joining again.";
  }

  return fallback;
}

export async function createRoom(nickname: string) {
  const user = await ensurePlayerSession();

  const { data: code, error } = await supabase.rpc("create_room", {
    p_nickname: nickname.trim(),
  });

  if (error) throw error;

  const room = await getRoomByCode(code);

  return { room, user };
}

export async function joinRoom(code: string, nickname: string) {
  const user = await ensurePlayerSession();
  const normalizedCode = code.trim().toUpperCase();
  const existingRoom = await getMyActiveRoom();

  if (existingRoom?.code === normalizedCode) {
    if (existingRoom.status === "finished") {
      throw new Error("Room has finished");
    }

    return { room: existingRoom, user };
  }

  const { error } = await supabase.rpc("join_room", {
    p_code: normalizedCode,
    p_nickname: nickname.trim(),
  });

  if (error) throw error;

  const room = await getRoomByCode(code);

  return { room, user };
}

export async function getRoomByCode(code: string): Promise<Room> {
  const { data, error } = await supabase
    .from("rooms")
    .select("id, code, host_id, status")
    .eq("code", code.trim().toUpperCase())
    .single();

  if (error) throw error;
  if (!data) throw new Error("Room not found");

  return data as Room;
}

export async function getRoomPlayers(roomId: string): Promise<RoomPlayer[]> {
  const { data, error } = await supabase
    .from("players")
    .select("id, room_id, user_id, nickname, score, joined_at")
    .eq("room_id", roomId)
    .order("joined_at", { ascending: true });

  if (error) throw error;

  return (data ?? []) as RoomPlayer[];
}

export async function startOnlineGame(roomId: string) {
  const { error } = await supabase.rpc("start_game", {
    p_room_id: roomId,
  });

  if (error) throw error;
}

export async function prepareRematch(roomId: string) {
  const { error } = await supabase.rpc("prepare_rematch", {
    p_room_id: roomId,
  });

  if (error) throw error;
}

export async function getMyActiveRoom(): Promise<Room | null> {
  const { data, error } = await supabase.rpc("get_my_active_room");

  if (error) throw error;

  if (data) return data as Room;

  const { data: latestRoom, error: latestRoomError } = await supabase.rpc(
    "get_my_latest_room",
  );

  if (latestRoomError) throw latestRoomError;

  return latestRoom as Room | null;
}
