'use client';
import { useState } from 'react';
import { hearingMessage, whatsappLink, type HearingFacts } from '@/lib/notify';
import { useApi } from './api';
import { Alert, Button, Field, Modal, Textarea } from './ui';

/** Writes a first draft of a hearing update; the advocate edits it and taps Send in WhatsApp. Nothing leaves this site. */
export function ClientUpdateModal({ facts, phone, onClose }: { facts: HearingFacts; phone: string | null; onClose: () => void }) {
  const me = useApi<{ advocate: { displayName: string } }>('/api/profile');
  const [edited, setEdited] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const message = edited ?? hearingMessage({ ...facts, advocateName: me.data?.advocate.displayName ?? null });
  const link = whatsappLink(phone, message);

  const copy = async () => {
    try { await navigator.clipboard.writeText(message); setCopied(true); } catch { setCopied(false); }
  };
  return (
    <Modal title={`Update ${facts.clientName}`} onClose={onClose}>
      <div className="space-y-3">
        <Field label="Message" hint="Read it and change anything before you send. It opens in your own WhatsApp.">
          <Textarea rows={9} value={message} onChange={(e) => { setEdited(e.target.value); setCopied(false); }} />
        </Field>
        {!link && <Alert tone="warn">{phone ? 'This phone number does not look like an Indian mobile number. Fix it under Clients.' : 'This client has no phone number yet. Add it under Clients to open WhatsApp directly, or copy the message.'}</Alert>}
        <div className="flex flex-wrap gap-2">
          {link ? <a href={link} target="_blank" rel="noopener noreferrer"><Button type="button">Open in WhatsApp</Button></a> : <Button type="button" disabled>Open in WhatsApp</Button>}
          <Button type="button" variant="secondary" onClick={copy}>{copied ? 'Copied' : 'Copy message'}</Button>
        </div>
      </div>
    </Modal>
  );
}
