import { useEffect, useState } from "react";
import { DownloadIcon, FileIcon, XIcon } from "lucide-react";
import { MessageResponse } from "@/components/ai-elements/message";
import { type Attachment, fileLabel, signedUrl } from "@/lib/chat-api";

function size(n: number) {
  return n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.ceil(n / 1024))} KB`;
}

/** A saved attachment on a sent message: image preview or download chip. */
export function SavedAttachment({ a }: { a: Attachment }) {
  const isImage = a.type.startsWith("image/");
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (isImage) void signedUrl(a.path).then(setUrl);
  }, [a.path, isImage]);

  async function download() {
    const u = await signedUrl(a.path, a.name.split("/").pop());
    if (u) window.open(u, "_blank");
  }

  if (isImage && url) {
    return (
      <button type="button" onClick={download} title={a.name}>
        <img src={url} alt={a.name} className="max-h-48 max-w-60 rounded-lg border border-border object-cover" />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={download}
      className="flex max-w-64 items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-left text-xs text-foreground hover:border-primary/50"
    >
      <FileIcon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{a.name}</span>
      <span className="shrink-0 text-muted-foreground">{size(a.size)}</span>
    </button>
  );
}

/** A file picked but not sent yet. */
export function PendingFile({ file, onRemove }: { file: File; onRemove: () => void }) {
  return (
    <span className="flex max-w-56 items-center gap-1.5 rounded-md border border-border bg-muted px-2 py-1 text-xs">
      <FileIcon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{fileLabel(file)}</span>
      <button type="button" onClick={onRemove} aria-label="Remover" className="text-muted-foreground hover:text-foreground">
        <XIcon className="size-3.5" />
      </button>
    </span>
  );
}

const FILE_BLOCK = /```file:([^\n`]+)\n([\s\S]*?)(?:```|$)/g;

/** Renders assistant markdown, turning ```file:name blocks into downloadable files. */
export function AssistantContent({ content }: { content: string }) {
  const pieces: Array<{ kind: "md"; text: string } | { kind: "file"; name: string; body: string }> = [];
  let last = 0;
  for (const m of content.matchAll(FILE_BLOCK)) {
    if (m.index > last) pieces.push({ kind: "md", text: content.slice(last, m.index) });
    pieces.push({ kind: "file", name: m[1].trim(), body: m[2] });
    last = m.index + m[0].length;
  }
  if (last < content.length) pieces.push({ kind: "md", text: content.slice(last) });

  return (
    <div className="flex flex-col gap-3">
      {pieces.map((p, i) =>
        p.kind === "md" ? (
          <MessageResponse key={i}>{p.text}</MessageResponse>
        ) : (
          <button
            key={i}
            type="button"
            onClick={() => {
              const url = URL.createObjectURL(new Blob([p.body], { type: "text/plain" }));
              const link = document.createElement("a");
              link.href = url;
              link.download = p.name;
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
            className="flex w-fit max-w-full items-center gap-3 rounded-xl border border-border bg-card px-4 py-3 text-left hover:border-primary/50"
          >
            <FileIcon className="size-5 shrink-0 text-primary" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{p.name}</span>
              <span className="text-xs text-muted-foreground">{size(new Blob([p.body]).size)} · clique para baixar</span>
            </span>
            <DownloadIcon className="size-4 shrink-0 text-muted-foreground" />
          </button>
        ),
      )}
    </div>
  );
}
