import ReactMarkdown from "react-markdown";

export function MarkdownViewer({ content }: { content: string }) {
  if (!content) {
    return <p className="text-sm text-zinc-500">No content yet.</p>;
  }

  return (
    <article className="prose prose-invert max-w-none prose-headings:text-white prose-p:text-zinc-300 prose-li:text-zinc-300 prose-code:text-amber-200">
      <ReactMarkdown>{content}</ReactMarkdown>
    </article>
  );
}
