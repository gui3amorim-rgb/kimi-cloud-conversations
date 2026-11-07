import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import logo from "@/assets/lua-logo.png";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Lua — Converse com uma IA" },
      { name: "description", content: "Lua é uma assistente de IA para conversar, tirar dúvidas, escrever e planejar. Suas conversas ficam salvas." },
      { property: "og:title", content: "Lua — Converse com uma IA" },
      { property: "og:description", content: "Uma assistente de IA para conversar, tirar dúvidas, escrever e planejar." },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-6 text-center" style={{ backgroundImage: "var(--glow)" }}>
      <img src={logo} alt="Lua" width={112} height={112} className="mb-6 size-28" />
      <h1 className="font-display text-6xl md:text-7xl">Lua</h1>
      <p className="mt-4 max-w-md text-lg text-muted-foreground">
        Uma assistente de IA para conversar, tirar dúvidas, escrever e planejar. Suas conversas ficam salvas na sua conta.
      </p>
      <div className="mt-8 flex gap-3">
        <Button asChild size="lg" className="rounded-full">
          <Link to="/chat">Começar a conversar</Link>
        </Button>
        <Button asChild size="lg" variant="outline" className="rounded-full">
          <Link to="/auth">Entrar</Link>
        </Button>
      </div>
    </div>
  );
}
