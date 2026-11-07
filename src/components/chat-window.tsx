import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Message, MessageContent, MessageResponse } from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import { type ChatMessage, pendingFirstMessage, sendChat } from "@/lib/chat-api";
import logo from "@/assets/lua-logo.png";

type Status = "ready" | "submitted" | "streaming" | "error";

const SUGGESTIONS = [
  "Explique computação quântica de forma simples",
  "Me ajude a planejar uma viagem de 5 dias",
  "Escreva um e-mail educado pedindo um prazo",
];

export function ChatWindow({
  threadId,
  initialMessages,
  onStartNew,
}: {
  threadId?: string;
  initialMessages: ChatMessage[];
  onStartNew?: (text: string) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [status, setStatus] = useState<Status>("ready");
  const [input, setInput] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const qc = useQueryClient();

  const focus = () => setTimeout(() => textareaRef.current?.focus(), 0);

  async function send(text: string) {
    if (!text.trim() || status === "submitted" || status === "streaming") return;
    if (!threadId) {
      onStartNew?.(text);
      return;
    }
    const assistantId = crypto.randomUUID();
    setMessages((m) => [...m, { id: crypto.randomUUID(), role: "user", content: text }]);
    setStatus("submitted");
    focus();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let started = false;
    try {
      await sendChat(
        threadId,
        text,
        (delta) => {
          if (!started) {
            started = true;
            setStatus("streaming");
            setMessages((m) => [...m, { id: assistantId, role: "assistant", content: delta }]);
          } else {
            setMessages((m) =>
              m.map((x) => (x.id === assistantId ? { ...x, content: x.content + delta } : x)),
            );
          }
        },
        ctrl.signal,
      );
      setStatus("ready");
    } catch (e) {
      if (ctrl.signal.aborted) {
        setStatus("ready");
      } else {
        setStatus("error");
        toast.error(e instanceof Error ? e.message : "Erro ao enviar");
        setTimeout(() => setStatus("ready"), 1500);
      }
    } finally {
      abortRef.current = null;
      qc.invalidateQueries({ queryKey: ["threads"] });
      qc.invalidateQueries({ queryKey: ["messages", threadId] });
      focus();
    }
  }

  // Send the first message typed on the "new conversation" screen.
  useEffect(() => {
    if (!threadId) return;
    const pending = pendingFirstMessage.get(threadId);
    if (pending) {
      pendingFirstMessage.delete(threadId);
      void send(pending);
    }
    focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  function handleSubmit(msg: PromptInputMessage) {
    const text = msg.text ?? "";
    setInput("");
    void send(text);
  }

  const empty = messages.length === 0;

  return (
    <div className="flex h-full flex-col" style={{ backgroundImage: "var(--glow)" }}>
      <Conversation className="flex-1">
        <ConversationContent className="mx-auto w-full max-w-3xl px-4 pt-14 md:pt-8">
          {empty ? (
            <ConversationEmptyState>
              <img src={logo} alt="" width={72} height={72} className="size-18" />
              <h1 className="font-display text-4xl md:text-5xl">Como posso ajudar hoje?</h1>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => void send(s)}
                    className="rounded-full border border-border bg-card px-4 py-2 text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </ConversationEmptyState>
          ) : (
            messages.map((m) => (
              <Message from={m.role} key={m.id}>
                <MessageContent
                  className={
                    m.role === "user"
                      ? "group-[.is-user]:bg-primary group-[.is-user]:text-primary-foreground"
                      : "bg-transparent px-0"
                  }
                >
                  {m.role === "assistant" ? (
                    <MessageResponse>{m.content}</MessageResponse>
                  ) : (
                    <p className="whitespace-pre-wrap">{m.content}</p>
                  )}
                </MessageContent>
              </Message>
            ))
          )}
          {status === "submitted" && (
            <Message from="assistant">
              <MessageContent className="bg-transparent px-0">
                <Shimmer>Pensando...</Shimmer>
              </MessageContent>
            </Message>
          )}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      <div className="mx-auto w-full max-w-3xl px-4 pb-4">
        <PromptInput onSubmit={handleSubmit} className="rounded-2xl bg-card shadow-lg">
          <PromptInputTextarea
            ref={textareaRef}
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Pergunte qualquer coisa..."
          />
          <PromptInputFooter className="justify-end">
            <PromptInputSubmit
              status={status}
              disabled={!input.trim() && status === "ready"}
              onStop={() => abortRef.current?.abort()}
            />
          </PromptInputFooter>
        </PromptInput>
        <p className="mt-2 text-center text-xs text-muted-foreground">
          A Lua pode cometer erros. Confira informações importantes.
        </p>
      </div>
    </div>
  );
}
