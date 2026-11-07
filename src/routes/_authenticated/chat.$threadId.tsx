import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ChatWindow } from "@/components/chat-window";
import { messagesQuery } from "@/lib/chat-api";

export const Route = createFileRoute("/_authenticated/chat/$threadId")({
  loader: ({ context, params }) =>
    context.queryClient.ensureQueryData(messagesQuery(params.threadId)),
  component: ThreadPage,
});

function ThreadPage() {
  const { threadId } = Route.useParams();
  const { data } = useSuspenseQuery(messagesQuery(threadId));
  return <ChatWindow key={threadId} threadId={threadId} initialMessages={data} />;
}
