import { supabase } from "@/integrations/supabase/client";
import { queryOptions } from "@tanstack/react-query";

export type ChatMessage = { id: string; role: "user" | "assistant"; content: string };

export const threadsQuery = queryOptions({
  queryKey: ["threads"],
  queryFn: async () => {
    const { data, error } = await supabase
      .from("threads")
      .select("id, title, updated_at")
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return data;
  },
});

export const messagesQuery = (threadId: string) =>
  queryOptions({
    queryKey: ["messages", threadId],
    queryFn: async (): Promise<ChatMessage[]> => {
      const { data, error } = await supabase
        .from("messages")
        .select("id, role, content")
        .eq("thread_id", threadId)
        .order("created_at");
      if (error) throw error;
      return data as ChatMessage[];
    },
  });

export async function createThread() {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Faça login");
  const { data, error } = await supabase
    .from("threads")
    .insert({ user_id: u.user.id })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function deleteThread(id: string) {
  const { error } = await supabase.from("threads").delete().eq("id", id);
  if (error) throw error;
}

/** Streams the assistant reply; calls onDelta for each text chunk. */
export async function sendChat(
  threadId: string,
  message: string,
  onDelta: (t: string) => void,
  signal?: AbortSignal,
) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token ?? ""}` },
    body: JSON.stringify({ threadId, message }),
    signal: signal ?? null,
  });
  if (!res.ok || !res.body) throw new Error((await res.text()) || "Erro ao enviar");
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    onDelta(dec.decode(value, { stream: true }));
  }
}

/** First message typed on the "new chat" screen, handed to the thread page. */
export const pendingFirstMessage = new Map<string, string>();
