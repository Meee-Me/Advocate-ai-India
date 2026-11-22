'use client';
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Button, Modal } from './ui';

/** What the browser sends along with an AI request. The server refuses AI requests that lack `consent: true`. */
export interface AiConsentResult { consent: true; sendCaseDetails: boolean }
export interface AiConsentAsk {
  /** Plain-language list of what this particular request will send. */
  items: string[];
  /** True when case details (parties, court, notes...) could be attached, which shows the "don't send" option. */
  hasCase?: boolean;
}

const VENDOR: Record<string, string> = { ollama: 'Ollama Cloud', openrouter: 'OpenRouter', groq: 'Groq', sambanova: 'SambaNova Cloud', anthropic: 'Anthropic' };

function Dialog({ ask, done }: { ask: AiConsentAsk; done: (r: AiConsentResult | null) => void }) {
  const [withhold, setWithhold] = useState(false);
  // Name the vendor(s) that can really receive this request, as the server is configured right now.
  const [vendors, setVendors] = useState<{ main?: string; backup?: string }>({});
  useEffect(() => {
    fetch('/api/health').then((r) => r.json()).then((h) => setVendors({ main: VENDOR[h?.ai?.provider], backup: VENDOR[h?.ai?.backup] })).catch(() => undefined);
  }, []);
  return (
    <Modal title="Send this to the AI service?" onClose={() => done(null)}>
      <div className="space-y-3 text-sm">
        <p>To answer, this will be sent over the internet to <strong>{vendors.main ?? 'an outside AI service'}</strong>{vendors.backup && <> (or to <strong>{vendors.backup}</strong>, another outside AI service, if the first one cannot answer)</>}:</p>
        <ul className="list-disc space-y-1 pl-5">
          {ask.items.map((i) => <li key={i}>{i}</li>)}
          {ask.hasCase && !withhold && <li>Details of the linked case: title, case number, court, party names, judge, description and recent notes</li>}
        </ul>
        {ask.hasCase && (
          <label className="flex min-h-11 items-center gap-2 rounded-lg border border-line px-3">
            <input type="checkbox" className="size-4" checked={withhold} onChange={(e) => setWithhold(e.target.checked)} />
            Don&apos;t send case details
          </label>
        )}
        <p className="rounded-lg bg-brass-soft/60 px-3 py-2 text-xs text-muted">
          AI answers can be wrong and are not legal advice; check them before relying on them. This app does not yet protect client information
          with extra encryption, so please do not send real client information yet.
        </p>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" autoFocus onClick={() => done(null)}>Cancel</Button>
          <Button onClick={() => done({ consent: true, sendCaseDetails: !withhold })}>Send to AI</Button>
        </div>
      </div>
    </Modal>
  );
}

/** Shows the confirmation and resolves with the person's choice (null = cancelled). Call it from a click/submit handler. */
let open = false; // one dialog at a time: pressing Enter again behind the dialog must not stack a second one

export function askAiConsent(ask: AiConsentAsk): Promise<AiConsentResult | null> {
  if (open) return Promise.resolve(null);
  open = true;
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    root.render(<Dialog ask={ask} done={(r) => { root.unmount(); host.remove(); open = false; resolve(r); }} />);
  });
}
