import { createFileRoute, Link, Outlet, useNavigate, useParams } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LogOut, MessageSquarePlus, Trash2, Menu } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { deleteThread, threadsQuery } from "@/lib/chat-api";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import logo from "@/assets/lua-logo.png";

export const Route = createFileRoute("/_authenticated/chat")({
  head: () => ({
    meta: [
      { title: "Conversas — Lua" },
      { name: "description", content: "Suas conversas com a Lua, sua assistente de IA." },
      { property: "og:title", content: "Conversas — Lua" },
      { property: "og:description", content: "Suas conversas com a Lua, sua assistente de IA." },
    ],
  }),
  component: ChatLayout,
});

function ChatLayout() {
  const { data: threads = [] } = useQuery(threadsQuery);
  const params = useParams({ strict: false }) as { threadId?: string };
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user } = Route.useRouteContext();
  const [open, setOpen] = useState(false);

  async function remove(id: string) {
    try {
      await deleteThread(id);
      await qc.invalidateQueries({ queryKey: ["threads"] });
      if (params.threadId === id) navigate({ to: "/chat" });
    } catch {
      toast.error("Não deu para apagar a conversa.");
    }
  }

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div className="flex h-dvh bg-background text-foreground">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 flex w-72 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-transform md:static md:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center gap-2 px-4 py-4">
          <img src={logo} alt="" width={28} height={28} className="size-7" />
          <span className="font-display text-2xl">Lua</span>
        </div>
        <div className="px-3">
          <Button asChild className="w-full justify-start gap-2" onClick={() => setOpen(false)}>
            <Link to="/chat">
              <MessageSquarePlus className="size-4" /> Nova conversa
            </Link>
          </Button>
        </div>
        <nav className="mt-4 flex-1 overflow-y-auto px-2" aria-label="Conversas">
          {threads.length === 0 && (
            <p className="px-3 text-sm text-muted-foreground">Nenhuma conversa ainda.</p>
          )}
          {threads.map((t) => (
            <div
              key={t.id}
              className={cn(
                "group flex items-center rounded-lg text-sm hover:bg-sidebar-accent",
                params.threadId === t.id && "bg-sidebar-accent",
              )}
            >
              <Link
                to="/chat/$threadId"
                params={{ threadId: t.id }}
                onClick={() => setOpen(false)}
                className="flex-1 truncate px-3 py-2"
              >
                {t.title}
              </Link>
              <button
                type="button"
                aria-label="Apagar conversa"
                onClick={() => remove(t.id)}
                className="mr-1 rounded p-1.5 text-muted-foreground opacity-0 hover:text-destructive group-hover:opacity-100 focus:opacity-100"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </nav>
        <div className="flex items-center gap-2 border-t border-sidebar-border px-4 py-3 text-sm">
          <span className="flex-1 truncate text-muted-foreground">{user.email}</span>
          <Button variant="ghost" size="icon-sm" aria-label="Sair" onClick={signOut}>
            <LogOut className="size-4" />
          </Button>
        </div>
      </aside>
      {open && (
        <div className="fixed inset-0 z-20 bg-background/70 md:hidden" onClick={() => setOpen(false)} />
      )}
      <main className="relative flex min-w-0 flex-1 flex-col">
        <Button
          variant="ghost"
          size="icon"
          className="absolute left-2 top-2 z-10 md:hidden"
          aria-label="Abrir menu"
          onClick={() => setOpen(true)}
        >
          <Menu className="size-5" />
        </Button>
        <Outlet />
      </main>
    </div>
  );
}
