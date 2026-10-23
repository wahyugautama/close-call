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

  const { error } = await supabase.rpc("join_room", {
    p_code: code.trim().toUpperCase(),
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
