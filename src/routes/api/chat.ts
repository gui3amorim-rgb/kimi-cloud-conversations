import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { streamResponse, GatewayError } from "@lovable.dev/ai-gateway";
import type { Database, Json } from "@/integrations/supabase/types";

type Attachment = { name: string; type: string; size: number; path: string };

const SYSTEM_PROMPT = `Você é Lua, uma assistente de IA prestativa, clara e amigável. Responda no idioma do usuário (padrão: português do Brasil). Use markdown quando ajudar a leitura.
O usuário pode anexar arquivos; você recebe imagens, PDFs e textos/código. De arquivos binários (ex.: .exe, .zip) você só vê nome e tipo — diga isso com honestidade.
Você também pode ANEXAR arquivos para o usuário baixar. Para isso, use exatamente este formato (um bloco por arquivo):
\`\`\`file:nome-do-arquivo.ext
conteúdo do arquivo
\`\`\`
Use apenas para arquivos de texto (código, csv, json, md, html, etc.).`;

const TEXT_EXT =
  /\.(txt|md|csv|tsv|json|xml|ya?ml|toml|ini|cfg|conf|log|env|html?|css|scss|js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|kt|c|h|cpp|hpp|cs|php|sh|bat|ps1|sql|swift|lua|r|vue|svelte|gitignore|dockerfile)$/i;
function looksText(a: Attachment) {
  return (
    a.type.startsWith("text/") ||
    /json|xml|javascript|typescript|yaml|x-sh/.test(a.type) ||
    TEXT_EXT.test(a.name)
  );
}
function fmtSize(n: number) {
  return n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`;
}
function toBase64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(s);
}

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
          attachments?: Attachment[];
        } | null;
        const threadId = body?.threadId;
        const attachments = (Array.isArray(body?.attachments) ? body.attachments : [])
          .filter(
            (a) =>
              a &&
              typeof a.path === "string" &&
              a.path.startsWith(`${userData.user.id}/${threadId}/`) &&
              typeof a.name === "string",
          )
          .slice(0, 200)
          .map((a) => ({
            name: String(a.name).slice(0, 300),
            type: String(a.type || "application/octet-stream").slice(0, 100),
            size: Number(a.size) || 0,
            path: a.path,
          }));
        const text = body?.message?.trim() || (attachments.length ? "(arquivos anexados)" : "");
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
          .select("role, content, attachments")
          .eq("thread_id", threadId)
          .order("created_at");
        if (histErr) return new Response("Erro ao carregar histórico", { status: 500 });

        const { error: insErr } = await supabase.from("messages").insert({
          thread_id: threadId,
          role: "user",
          content: text,
          attachments: attachments as unknown as Json,
        });
        if (insErr) return new Response("Erro ao salvar mensagem", { status: 500 });

        // Build multimodal content for the new message.
        type Part =
          | { type: "input_text"; text: string }
          | { type: "input_image"; image_url: string; detail: "auto" }
          | { type: "input_file"; filename: string; file_data: string };
        const parts: Part[] = [{ type: "input_text", text }];
        let textBudget = 400_000;
        for (const a of attachments) {
          const isImage = /^image\/(png|jpe?g|gif|webp)$/.test(a.type);
          const isPdf = a.type === "application/pdf";
          const isText = looksText(a);
          const meta = `Arquivo: ${a.name} (${a.type}, ${fmtSize(a.size)})`;
          if ((isImage || isPdf) && a.size <= 15 * 1024 * 1024) {
            const { data: blob } = await supabase.storage.from("attachments").download(a.path);
            if (blob) {
              const b64 = toBase64(new Uint8Array(await blob.arrayBuffer()));
              const url = `data:${a.type};base64,${b64}`;
              parts.push({ type: "input_text", text: meta });
              parts.push(
                isImage
                  ? { type: "input_image", image_url: url, detail: "auto" }
                  : { type: "input_file", filename: a.name, file_data: url },
              );
              continue;
            }
          }
          if (isText && a.size <= textBudget) {
            const { data: blob } = await supabase.storage.from("attachments").download(a.path);
            if (blob) {
              const content = await blob.text();
              textBudget -= content.length;
              parts.push({ type: "input_text", text: `${meta}\n\`\`\`\n${content}\n\`\`\`` });
              continue;
            }
          }
          parts.push({
            type: "input_text",
            text: `${meta} — conteúdo binário não legível pela IA (só o nome e tipo).`,
          });
        }

        const isFirst = (history ?? []).length === 0;
        const input = [
          ...(history ?? []).map((m) => {
            const att = (m.attachments as unknown as Attachment[] | null) ?? [];
            const note = att.length
              ? `\n\n[Anexos anteriores: ${att.map((a) => a.name).join(", ")}]`
              : "";
            return { role: m.role as "user" | "assistant", content: m.content + note };
          }),
          { role: "user" as const, content: parts },
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
