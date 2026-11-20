"use client";

import { FormEvent, ReactNode, useEffect, useRef, useState } from "react";
import { ParticipantRole, ThreadMessage } from "@/lib/types/database";
import { LoadingMascot } from "@/components/ui/LoadingMascot";

type Cursor = { before?: number; after?: number };
export type RoomPage<M extends ThreadMessage> = { messages: M[]; hasMore: boolean; error: string | null };

type Props<M extends ThreadMessage, R extends RoomPage<M>> = {
  role: ParticipantRole;
  /** Must be stable (useCallback): polling restarts when it changes. */
  load: (cursor?: Cursor) => Promise<R>;
  send: (body: string, clientMessageId: string) => Promise<{ message: M | null; error: string | null }>;
  markRead: (messageIds: string[]) => Promise<void>;
  /** Called with every successful poll, so the wrapper can show thread details. */
  onResult?: (result: R) => void;
  /** Rendered instead of the room when the conversation is unavailable. */
  blocked?: ReactNode;
  header?: ReactNode;
  otherName: string;
  pill: string;
  emptyHint: ReactNode;
  /** 相手のメッセージの下に「通報」を出す。押されたメッセージを渡す。 */
  onReport?: (message: M) => void;
};

function mergeMessages<M extends ThreadMessage>(current: M[], incoming: M[]) {
  return [...new Map([...current, ...incoming].map((m) => [m.id, m])).values()].sort((a, b) => a.sequence - b.sequence);
}

export function ChatRoom<M extends ThreadMessage, R extends RoomPage<M>>({ role, load, send, markRead, onResult, blocked, header, otherName, pill, emptyHint, onReport }: Props<M, R>) {
  const [messages, setMessages] = useState<M[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const latest = useRef<number | null>(null);
  const sendAttempt = useRef<{ body: string; id: string } | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const followBottom = useRef(true);
  const sendLock = useRef(false);
  const onResultRef = useRef(onResult);
  useEffect(() => { onResultRef.current = onResult; }, [onResult]);

  useEffect(() => {
    let active = true;
    let fetching = false;
    async function poll() {
      if (fetching) return;
      fetching = true;
      try {
        const initial = latest.current === null;
        const result = await load(initial ? undefined : { after: latest.current! });
        if (!active) return;
        setLoaded(true);
        setError(result.error);
        onResultRef.current?.(result);
        if (result.error) return;
        if (initial) setHasOlder(result.hasMore);
        if (result.messages.length) latest.current = Math.max(latest.current ?? 0, ...result.messages.map((m) => m.sequence));
        else if (initial) latest.current = 0;
        setMessages((current) => mergeMessages(current, result.messages));
        if (document.visibilityState === "visible") void markRead(result.messages.filter((m) => m.sender_role !== role).map((m) => m.id));
      } catch { if (active) { setLoaded(true); setError("メッセージを読み込めませんでした。自動で再読み込みします。"); } }
      finally { fetching = false; }
    }
    void poll();
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void poll(); }, 8000);
    window.addEventListener("focus", poll);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener("focus", poll); };
  }, [role, load, markRead]);

  const lastMessageId = messages.at(-1)?.id;
  useEffect(() => {
    if (followBottom.current && list.current) list.current.scrollTop = list.current.scrollHeight;
  }, [lastMessageId, blocked]);

  async function loadOlder() {
    if (!messages.length) return;
    setLoadingOlder(true);
    const oldHeight = list.current?.scrollHeight ?? 0;
    const oldTop = list.current?.scrollTop ?? 0;
    try {
      const result = await load({ before: messages[0].sequence });
      if (result.error) { setError(result.error); return; }
      setMessages((current) => mergeMessages(current, result.messages));
      setHasOlder(result.hasMore);
      requestAnimationFrame(() => { if (list.current) list.current.scrollTop = list.current.scrollHeight - oldHeight + oldTop; });
      void markRead(result.messages.filter((m) => m.sender_role !== role).map((m) => m.id));
    } catch { setError("以前のメッセージを読み込めませんでした。"); }
    finally { setLoadingOlder(false); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = body.trim();
    if (!text || sendLock.current) return;
    sendLock.current = true;
    setSending(true);
    setSendError(null);
    if (sendAttempt.current?.body !== text) sendAttempt.current = { body: text, id: crypto.randomUUID() };
    try {
      const result = await send(text, sendAttempt.current.id);
      if (result.error || !result.message) { setSendError(result.error ?? "送信できませんでした。"); return; }
      followBottom.current = true;
      setMessages((current) => mergeMessages(current, [result.message!]));
      // Poll cursor only moves on reads: a concurrent incoming message must not be skipped.
      setBody("");
      sendAttempt.current = null;
    } catch { setSendError("送信結果を確認できませんでした。同じ内容で再送できます。"); }
    finally { sendLock.current = false; setSending(false); }
  }

  if (!loaded) return <LoadingMascot label="チャットを読み込み中…" />;
  if (blocked) return <>{blocked}</>;
  return <div className="space-y-4">
    {header}
    {error && <p role="alert" className="app-error">{error}</p>}
    <section className="overflow-hidden rounded-xl border border-line bg-white">
      <div className="border-b border-line px-4 py-3"><span className="app-pill">{pill}</span></div>
      <div ref={list} role="log" aria-label="メッセージ履歴" aria-live="polite" onScroll={() => { if (list.current) followBottom.current = list.current.scrollHeight - list.current.scrollTop - list.current.clientHeight < 80; }} className="flex h-[48dvh] min-h-64 flex-col gap-4 overflow-y-auto bg-paper p-4">
        {hasOlder && <button type="button" className="app-secondary mx-auto text-xs" disabled={loadingOlder} onClick={() => void loadOlder()}>{loadingOlder ? "読み込み中…" : "以前のメッセージを読む"}</button>}
        {!messages.length && <p className="m-auto max-w-64 text-center text-sm leading-relaxed text-ink-soft">{emptyHint}</p>}
        {messages.map((message) => {
          const own = message.sender_role === role;
          return <div key={message.id} className={`flex max-w-[88%] flex-col ${own ? "self-end items-end" : "self-start items-start"}`}><p className="mb-1 text-[11px] font-semibold text-ink-soft">{own ? "あなた" : otherName}</p><p className={`whitespace-pre-wrap break-words rounded-xl px-4 py-3 text-sm leading-relaxed [overflow-wrap:anywhere] ${own ? `rounded-br-md text-white ${role === "store" ? "bg-brand-blue-dark" : "bg-brand-blue"}` : "rounded-bl-md border border-line bg-white text-ink"}`}>{message.body}</p><div className="mt-1 flex items-center gap-3"><time className="text-[10px] text-ink-soft">{new Date(message.created_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time>{!own && onReport && <button type="button" onClick={() => onReport(message)} className="-my-3 py-3 text-[11px] font-medium text-ink-soft underline underline-offset-2 hover:text-ink">通報</button>}</div></div>;
        })}
      </div>
      <form onSubmit={submit} className="border-t border-line bg-white p-3">
        {sendError && <p role="alert" className="app-error mb-3">{sendError}</p>}
        <label className="sr-only" htmlFor="chat_body">メッセージ</label><textarea id="chat_body" value={body} onChange={(e) => setBody(e.target.value)} disabled={sending} maxLength={2000} rows={2} className="app-input resize-none" placeholder="メッセージを入力…" />
        <div className="mt-2 flex items-center justify-between gap-2"><span className="text-xs text-ink-soft">{body.length}/2000</span><button className="app-primary" disabled={sending || !body.trim() || Boolean(error)}>{sending ? "送信中…" : "送信する"}</button></div>
      </form>
    </section>
  </div>;
}
