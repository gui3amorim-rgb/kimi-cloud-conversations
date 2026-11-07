import { supabase } from "@/integrations/supabase/client";
import { queryOptions } from "@tanstack/react-query";

export type Attachment = { name: string; type: string; size: number; path: string };
export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  attachments?: Attachment[];
};

export const MAX_FILE_BYTES = 50 * 1024 * 1024;

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
        .select("id, role, content, attachments")
        .eq("thread_id", threadId)
        .order("created_at");
      if (error) throw error;
      return (data ?? []).map((m) => ({
        id: m.id,
        role: m.role as ChatMessage["role"],
        content: m.content,
        attachments: (m.attachments as unknown as Attachment[]) ?? [],
      }));
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

/** Display name: keeps folder path when the file came from a folder pick. */
export function fileLabel(f: File) {
  return (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
}

export async function uploadFiles(threadId: string, files: File[]): Promise<Attachment[]> {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) throw new Error("Faça login");
  const out: Attachment[] = [];
  for (const f of files) {
    if (f.size > MAX_FILE_BYTES) throw new Error(`"${f.name}" passa de 50 MB`);
    const safe = f.name.replace(/[^\w.\-]+/g, "_");
    const path = `${u.user.id}/${threadId}/${crypto.randomUUID()}-${safe}`;
    const { error } = await supabase.storage
      .from("attachments")
      .upload(path, f, { contentType: f.type || "application/octet-stream" });
    if (error) throw new Error(`Falha ao enviar "${f.name}"`);
    out.push({ name: fileLabel(f), type: f.type || "application/octet-stream", size: f.size, path });
  }
  return out;
}

export async function signedUrl(path: string, download?: string) {
  const { data } = await supabase.storage
    .from("attachments")
    .createSignedUrl(path, 3600, download ? { download } : undefined);
  return data?.signedUrl ?? null;
}

/** Streams the assistant reply; calls onDelta for each text chunk. */
export async function sendChat(
  threadId: string,
  message: string,
  attachments: Attachment[],
  onDelta: (t: string) => void,
  signal?: AbortSignal,
) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token ?? ""}` },
    body: JSON.stringify({ threadId, message, attachments }),
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
export const pendingFirstMessage = new Map<string, { text: string; files: File[] }>();
