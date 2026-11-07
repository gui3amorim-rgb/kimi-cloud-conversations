import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { streamResponse, GatewayError } from "@lovable.dev/ai-gateway";
import type { Database } from "@/integrations/supabase/types";

const SYSTEM_PROMPT =
  "Você é Lua, uma assistente de IA prestativa, clara e amigável. Responda no idioma do usuário (padrão: português do Brasil). Use markdown quando ajudar a leitura.";

function userClient(token: string) {
  const url = process.env["SUPABASE_URL"]!;
  const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
  return createClient<Database>(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        headers.set("apikey", key);
        headers.set("Authorization", `Bearer ${token}`);
        return fetch(input, { ...init, headers });
      },
    },
  });
}

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
        if (!token) return new Response("Não autorizado", { status: 401 });
        const supabase = userClient(token);
        const { data: userData, error: userErr } = await supabase.auth.getUser(token);
        if (userErr || !userData.user) return new Response("Não autorizado", { status: 401 });

        const body = (await request.json().catch(() => null)) as {
          threadId?: string;
          message?: string;
        } | null;
        const threadId = body?.threadId;
        const text = body?.message?.trim();
        if (!threadId || !text || text.length > 20000) {
          return new Response("Pedido inválido", { status: 400 });
        }

        const { data: thread } = await supabase
          .from("threads")
          .select("id, title")
          .eq("id", threadId)
          .maybeSingle();
        if (!thread) return new Response("Conversa não encontrada", { status: 404 });

        const { data: history, error: histErr } = await supabase
          .from("messages")
          .select("role, content")
          .eq("thread_id", threadId)
          .order("created_at");
        if (histErr) return new Response("Erro ao carregar histórico", { status: 500 });

        const { error: insErr } = await supabase
          .from("messages")
          .insert({ thread_id: threadId, role: "user", content: text });
        if (insErr) return new Response("Erro ao salvar mensagem", { status: 500 });

        const isFirst = (history ?? []).length === 0;
        const input = [
          ...(history ?? []).map((m) => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          })),
          { role: "user" as const, content: text },
        ];

        let stream;
        try {
          stream = await streamResponse(
            { model: "openai/gpt-6-astra", instructions: SYSTEM_PROMPT, input },
            { signal: request.signal },
          );
        } catch (e) {
          console.error(e);
          const status = e instanceof GatewayError && e.httpStatus === 429 ? 429 : 502;
          const msg =
            status === 429
              ? "Muitas mensagens agora. Espere um pouco e tente de novo."
              : e instanceof GatewayError && e.httpStatus === 402
                ? "Os créditos de IA acabaram."
                : "A IA não respondeu. Tente de novo.";
          return new Response(msg, { status });
        }

        const encoder = new TextEncoder();
        const out = new ReadableStream<Uint8Array>({
          async start(controller) {
            let full = "";
            try {
              for await (const event of stream) {
                if (event.type === "response.output_text.delta") {
                  full += event.delta;
                  controller.enqueue(encoder.encode(event.delta));
                }
              }
              if (full) {
                const { error } = await supabase
                  .from("messages")
                  .insert({ thread_id: threadId, role: "assistant", content: full });
                if (error) console.error("save assistant failed", error);
              }
              await supabase
                .from("threads")
                .update({
                  updated_at: new Date().toISOString(),
                  ...(isFirst ? { title: text.slice(0, 60) } : {}),
                })
                .eq("id", threadId);
              controller.close();
            } catch (e) {
              console.error(e);
              if (full) {
                await supabase
                  .from("messages")
                  .insert({ thread_id: threadId, role: "assistant", content: full });
              }
              controller.error(e);
            }
          },
        });

        return new Response(out, {
          headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-cache" },
        });
      },
    },
  },
});
