import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChatWindow } from "@/components/chat-window";
import { createThread, pendingFirstMessage } from "@/lib/chat-api";

export const Route = createFileRoute("/_authenticated/chat/")({
  component: NewChat,
});

function NewChat() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  return (
    <ChatWindow
      key="new"
      initialMessages={[]}
      onStartNew={async (text, files) => {
        try {
          const id = await createThread();
          pendingFirstMessage.set(id, { text, files });
          qc.setQueryData(["messages", id], []);
          await qc.invalidateQueries({ queryKey: ["threads"] });
          navigate({ to: "/chat/$threadId", params: { threadId: id } });
        } catch {
          toast.error("Não foi possível iniciar a conversa.");
        }
      }}
    />
  );
}
