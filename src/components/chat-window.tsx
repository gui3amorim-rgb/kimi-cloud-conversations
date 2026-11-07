import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { FolderIcon, PaperclipIcon } from "lucide-react";
import { Message, MessageContent } from "@/components/ai-elements/message";
import { AssistantContent, PendingFile, SavedAttachment } from "@/components/attachments";
import {
  PromptInput,
  PromptInputButton,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import {
  type ChatMessage,
  MAX_FILE_BYTES,
  fileLabel,
  pendingFirstMessage,
  sendChat,
  uploadFiles,
} from "@/lib/chat-api";
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
  onStartNew?: (text: string, files: File[]) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [status, setStatus] = useState<Status>("ready");
  const [input, setInput] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const qc = useQueryClient();

  const focus = () => setTimeout(() => textareaRef.current?.focus(), 0);

  function addFiles(list: FileList | null) {
    if (!list) return;
    const arr = Array.from(list);
    const big = arr.filter((f) => f.size > MAX_FILE_BYTES);
    if (big.length) toast.error(`${big.length} arquivo(s) passam de 50 MB e foram ignorados`);
    setFiles((prev) => [...prev, ...arr.filter((f) => f.size <= MAX_FILE_BYTES)].slice(0, 200));
  }

  async function send(text: string, picked: File[] = []) {
    if ((!text.trim() && !picked.length) || status === "submitted" || status === "streaming") return;
    if (!threadId) {
      onStartNew?.(text, picked);
      return;
    }
    const assistantId = crypto.randomUUID();
    const userMsgId = crypto.randomUUID();
    setMessages((m) => [...m, { id: userMsgId, role: "user", content: text }]);
    setStatus("submitted");
    focus();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    let started = false;
    try {
      const attachments = picked.length ? await uploadFiles(threadId, picked) : [];
      if (attachments.length)
        setMessages((m) => m.map((x) => (x.id === userMsgId ? { ...x, attachments } : x)));
      await sendChat(
        threadId,
        text,
        attachments,
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
      void send(pending.text, pending.files);
    }
    focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  function handleSubmit(msg: PromptInputMessage) {
    const text = msg.text ?? "";
    const picked = files;
    setInput("");
    setFiles([]);
    void send(text, picked);
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
                    <AssistantContent content={m.content} />
                  ) : (
                    <>
                      {m.attachments && m.attachments.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {m.attachments.map((a) => (
                            <SavedAttachment key={a.path} a={a} />
                          ))}
                        </div>
                      )}
                      {m.content && m.content !== "(arquivos anexados)" && (
                        <p className="whitespace-pre-wrap">{m.content}</p>
                      )}
                    </>
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
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={folderRef}
          type="file"
          multiple
          hidden
          {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <PromptInput onSubmit={handleSubmit} className="rounded-2xl bg-card shadow-lg">
          {files.length > 0 && (
            <div className="flex max-h-28 w-full flex-wrap gap-1.5 overflow-y-auto px-3 pt-3">
              {files.map((f, i) => (
                <PendingFile
                  key={`${fileLabel(f)}-${i}`}
                  file={f}
                  onRemove={() => setFiles((p) => p.filter((_, j) => j !== i))}
                />
              ))}
            </div>
          )}
          <PromptInputTextarea
            ref={textareaRef}
            autoFocus
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={(e) => {
              if (e.clipboardData.files.length) addFiles(e.clipboardData.files);
            }}
            placeholder="Pergunte qualquer coisa..."
          />
          <PromptInputFooter className="justify-between">
            <div className="flex gap-1">
              <PromptInputButton
                type="button"
                onClick={() => fileRef.current?.click()}
                tooltip="Anexar arquivos"
              >
                <PaperclipIcon className="size-4" />
              </PromptInputButton>
              <PromptInputButton
                type="button"
                onClick={() => folderRef.current?.click()}
                tooltip="Anexar pasta"
              >
                <FolderIcon className="size-4" />
              </PromptInputButton>
            </div>
            <PromptInputSubmit
              status={status}
              disabled={!input.trim() && !files.length && status === "ready"}
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
