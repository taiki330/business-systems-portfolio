import { Fragment, ReactNode } from "react";

// Renders the small Markdown subset used by the legal documents (headings, lists, tables,
// quotes, rules, **bold**, [links](url)). The documents are repository files, not user input.

function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)]+)\)|(【要(?:確認|記入)[^】]*】)/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const key = parts.length;
    if (match[1] !== undefined) parts.push(<strong key={key} className="font-bold text-ink">{inline(match[1])}</strong>);
    else if (match[2] !== undefined) {
      const external = /^https?:/.test(match[3]);
      // Relative links point into the repository (docs/…); they are not pages of the app.
      parts.push(external || match[3].startsWith("/") ? <a key={key} href={match[3]} className="font-semibold text-brand-blue underline underline-offset-2">{match[2]}</a> : <Fragment key={key}>{match[2]}</Fragment>);
    } else parts.push(<mark key={key} className="rounded bg-brand-yellow-light px-1 font-semibold text-brand-yellow-dark">{match[4]}</mark>);
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

type Block =
  | { type: "h1" | "h2" | "h3" | "p" | "quote"; text: string }
  | { type: "hr" }
  | { type: "list"; ordered: boolean; items: { text: string; children: string[] }[] }
  | { type: "table"; head: string[]; rows: string[][] };

function parse(source: string): Block[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  const cells = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) { blocks.push({ type: (["h1", "h2", "h3"] as const)[heading[1].length - 1], text: heading[2] }); continue; }
    if (/^-{3,}\s*$/.test(line)) { blocks.push({ type: "hr" }); continue; }
    if (line.startsWith(">")) {
      const quote = [];
      while (i < lines.length && lines[i].startsWith(">")) quote.push(lines[i++].replace(/^>\s?/, ""));
      i--; blocks.push({ type: "quote", text: quote.join(" ") }); continue;
    }
    if (line.startsWith("|")) {
      const rows = [];
      while (i < lines.length && lines[i].startsWith("|")) rows.push(lines[i++]);
      i--;
      blocks.push({ type: "table", head: cells(rows[0]), rows: rows.slice(2).map(cells) }); continue;
    }
    const item = /^(\*|-|\d+\.)\s+(.*)$/.exec(line);
    if (item) {
      const ordered = /\d/.test(item[1]);
      const items: { text: string; children: string[] }[] = [];
      for (; i < lines.length; i++) {
        const top = /^(\*|-|\d+\.)\s+(.*)$/.exec(lines[i]);
        const child = /^\s+(\*|-|\d+\.)\s+(.*)$/.exec(lines[i]);
        if (top && /\d/.test(top[1]) === ordered) items.push({ text: top[2], children: [] });
        else if (child && items.length) items.at(-1)!.children.push(child[2]);
        else if (!lines[i].trim() && (/^\s+(\*|-|\d+\.)\s/.test(lines[i + 1] ?? "") || (/^(\*|-|\d+\.)\s/.test(lines[i + 1] ?? "") && /\d/.test(/^(\*|-|\d+\.)/.exec(lines[i + 1])![1]) === ordered))) continue;
        else break;
      }
      i--; blocks.push({ type: "list", ordered, items }); continue;
    }
    blocks.push({ type: "p", text: line });
  }
  return blocks;
}

export function LegalMarkdown({ source }: { source: string }) {
  return <div className="space-y-4 text-sm leading-relaxed text-ink-soft">
    {parse(source).map((block, i) => {
      switch (block.type) {
        case "h1": return <h1 key={i} className="text-xl font-black text-ink">{inline(block.text)}</h1>;
        case "h2": return <h2 key={i} className="app-heading-mark pt-2 text-base font-bold text-ink">{inline(block.text)}</h2>;
        case "h3": return <h3 key={i} className="text-sm font-bold text-ink">{inline(block.text)}</h3>;
        case "hr": return <hr key={i} className="border-line" />;
        case "quote": return <blockquote key={i} className="rounded-xl bg-paper p-3 text-xs text-ink-soft">{inline(block.text)}</blockquote>;
        case "table": return <div key={i} className="overflow-x-auto"><table className="w-full min-w-[32rem] border-collapse text-xs"><thead><tr>{block.head.map((h, j) => <th key={j} className="border border-line bg-paper p-2 text-left font-bold text-ink">{inline(h)}</th>)}</tr></thead><tbody>{block.rows.map((row, j) => <tr key={j}>{row.map((c, k) => <td key={k} className="border border-line p-2 align-top">{inline(c)}</td>)}</tr>)}</tbody></table></div>;
        case "list": {
          const List = block.ordered ? "ol" : "ul";
          return <List key={i} className={`space-y-1.5 pl-5 ${block.ordered ? "list-decimal" : "list-disc"}`}>{block.items.map((item, j) => <li key={j}>{inline(item.text)}{item.children.length > 0 && <ul className="mt-1.5 list-[circle] space-y-1 pl-5">{item.children.map((c, k) => <li key={k}>{inline(c)}</li>)}</ul>}</li>)}</List>;
        }
        default: return <p key={i}>{inline(block.text)}</p>;
      }
    })}
  </div>;
}
