import { useRef, useEffect, useState } from 'react';
import { Check, Copy, Download, Loader2 } from 'lucide-react';
import type { Message } from '@/hooks/useLegalChat';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { invokeFunction } from '@/lib/api';
import Seal from './Seal';

// Turn any chat answer into a downloadable file. The answer text is sent to the
// backend, which wraps it into a Word/PDF — so "generate a document about X" in
// the chat ends with a real file, not just text on screen.
function DownloadAnswer({ text }: { text: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState(false);

  const download = async (format: 'pdf' | 'docx') => {
    setBusy(format); setErr(false);
    try {
      const { data } = await invokeFunction('render-document', { body: { text, format } });
      const b64 = data[format];
      if (!b64) throw new Error('no file');
      const bytes = atob(b64);
      const arr = new Uint8Array(bytes.length);
      for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
      const mime = format === 'pdf'
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      const url = URL.createObjectURL(new Blob([arr], { type: mime }));
      const a = document.createElement('a');
      a.href = url; a.download = `${(data.filenameBase as string) || 'document'}.${format}`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setErr(true);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => download('pdf')}
        disabled={!!busy}
        className="inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-[0.8125rem] font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-60"
      >
        {busy === 'pdf' ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Save as PDF
      </button>
      <button
        onClick={() => download('docx')}
        disabled={!!busy}
        className="inline-flex items-center gap-1.5 rounded-sm px-2 py-1 text-[0.8125rem] font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors disabled:opacity-60"
      >
        {busy === 'docx' ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Save as Word
      </button>
      {err && <span className="text-xs text-destructive">Couldn’t create the file — try again.</span>}
    </div>
  );
}

// Copy an answer to the clipboard as the plain text the user sees (no markdown
// symbols). Shows a tick for a moment so the user knows it worked.
function CopyAnswer({ getText }: { getText: () => string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    const text = getText();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Older browsers / non-secure contexts: fall back to a hidden textarea.
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch { /* nothing more to try */ }
      ta.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? 'Copied' : 'Copy answer'}
      title={copied ? 'Copied' : 'Copy answer'}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
    >
      {copied ? <Check size={15} /> : <Copy size={15} />}
    </button>
  );
}

// Source titles come from scraped legal text and sometimes carry HTML entities,
// e.g. "Real Estate (Regulation &amp, 2016". Show them as plain characters.
const cleanLabel = (label: string) =>
  label
    .replace(/&amp;?/g, '&')
    .replace(/&quot;?/g, '"')
    .replace(/&#39;?|&apos;?/g, "'")
    .replace(/&lt;?/g, '<')
    .replace(/&gt;?/g, '>');

interface ChatMessagesProps {
  messages: Message[];
  isLoading: boolean;
}

// Markdown → the "record" typography used on the answer sheet.
const answerComponents = {
  h1: ({ children }: { children?: React.ReactNode }) => <h3 className="font-display text-2xl text-foreground mt-1 mb-4">{children}</h3>,
  h2: ({ children }: { children?: React.ReactNode }) => <h4 className="text-lg font-semibold text-foreground mt-7 mb-3">{children}</h4>,
  h3: ({ children }: { children?: React.ReactNode }) => <h5 className="text-base font-semibold text-foreground mt-6 mb-2">{children}</h5>,
  p: ({ children }: { children?: React.ReactNode }) => <p className="mb-4 last:mb-0">{children}</p>,
  hr: () => <hr className="border-t border-dashed border-border my-6" />,
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="overflow-x-auto my-5 -mx-1">
      <table className="w-full border-collapse text-left text-[0.9375rem]">{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: React.ReactNode }) => <thead className="border-b-2 border-primary/70">{children}</thead>,
  th: ({ children }: { children?: React.ReactNode }) => <th className="px-3 py-2 font-semibold text-foreground">{children}</th>,
  td: ({ children }: { children?: React.ReactNode }) => <td className="border-b border-border px-3 py-2 align-top">{children}</td>,
  ul: ({ children }: { children?: React.ReactNode }) => <ul className="record-list mb-4 space-y-1.5">{children}</ul>,
  ol: ({ children }: { children?: React.ReactNode }) => <ol className="list-decimal pl-6 mb-4 space-y-1.5 marker:text-seal marker:font-semibold">{children}</ol>,
  li: ({ children }: { children?: React.ReactNode }) => <li className="pl-1">{children}</li>,
  strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-semibold text-foreground">{children}</strong>,
  code: ({ children }: { children?: React.ReactNode }) => <code className="bg-muted px-1 py-0.5 rounded-sm text-[0.875em]">{children}</code>,
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="my-4 border-l-2 border-seal pl-4 text-foreground/85">{children}</blockquote>
  ),
};

const ChatMessages = ({ messages, isLoading }: ChatMessagesProps) => {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  if (messages.length === 0 && !isLoading) {
    return null;
  }

  // Number each question so the conversation reads as a record: Q1, Q2 …
  let q = 0;
  const numbered = messages.map((m) => ({ m, n: m.role === 'user' ? ++q : q }));

  return (
    <ol className="record w-full py-6" aria-label="Conversation">
      {numbered.map(({ m: message, n }) =>
        message.role === 'user' ? (
          <li key={message.id} className="record__query">
            <span className="record__num" aria-hidden="true">Q{n}</span>
            <p className="font-display text-[1.375rem] sm:text-[1.625rem] leading-snug text-foreground break-words">
              {message.content}
            </p>
          </li>
        ) : (
          <li key={message.id} className="record__answer">
            <article id={`answer-${message.id}`} className="record__sheet">
              <div data-answer-text className="record__body">
                <ReactMarkdown remarkPlugins={[remarkGfm]} components={answerComponents}>
                  {message.content.replace(/^.*===\s*(BEGIN|END) DOCUMENT\s*===.*$/gim, '').replace(/\n{3,}/g, '\n\n')}
                </ReactMarkdown>
              </div>

              {message.content && message.content.trim() && (
                <footer className="record__actions">
                  <CopyAnswer
                    getText={() =>
                      (document.getElementById(`answer-${message.id}`)?.querySelector('[data-answer-text]') as HTMLElement | null)
                        ?.innerText.trim() || message.content
                    }
                  />
                  {message.content.trim().length > 150 && <DownloadAnswer text={message.content} />}
                </footer>
              )}
            </article>

            {message.sources && message.sources.length > 0 && (
              <aside className="record__authorities" aria-label="Authorities cited">
                <p className="text-sm font-semibold text-foreground mb-2">Authorities</p>
                <ul className="space-y-2">
                  {message.sources.map((s, i) => (
                    <li key={i} className="text-[0.8125rem] leading-snug text-foreground/85" title={cleanLabel(s.label)}>
                      <span className="text-seal font-semibold mr-1">§</span>
                      {cleanLabel(s.label)}
                      <span className="block text-xs text-muted-foreground">{s.type}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground mt-3 leading-snug">
                  Check against the official Gazette or India Code before acting.
                </p>
              </aside>
            )}
          </li>
        )
      )}

      {isLoading && (
        <li className="record__answer" aria-live="polite">
          <div className="record__sheet flex items-center gap-3 text-muted-foreground">
            <Seal state="thinking" className="h-8 w-8" />
            <span className="text-[0.9375rem]">Looking into the law for Q{q}…</span>
          </div>
        </li>
      )}

      <div ref={messagesEndRef} />
    </ol>
  );
};

export default ChatMessages;
