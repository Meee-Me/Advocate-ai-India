/** Messages to a client about a hearing. Nothing is sent from here: the advocate opens WhatsApp and taps Send, so no paid messaging service is needed. */

/** A wa.me link for an Indian mobile number ("98765 43210", "+91 98765 43210", "098765 43210"), or null when the number is not usable. */
export function whatsappLink(phone: string | null | undefined, message: string): string | null {
  let d = (phone ?? '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) d = `91${d}`;
  if (!/^\d{11,15}$/.test(d)) return null;
  return `https://wa.me/${d}?text=${encodeURIComponent(message)}`;
}

export interface HearingFacts {
  clientName: string; caseTitle: string; caseNumber?: string | null; hearingAt: Date | string;
  status: string; court?: string | null; courtroom?: string | null; notes?: string | null; advocateName?: string | null;
}

const when = (d: Date | string) => {
  const x = new Date(d);
  const day = x.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
  const time = x.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
  return `${day} at ${time}`;
};

/** A plain first draft the advocate reads and edits before sending. */
export function hearingMessage(h: HearingFacts): string {
  const matter = `"${h.caseTitle}"${h.caseNumber ? ` (${h.caseNumber})` : ''}`;
  const place = [h.court, h.courtroom && `Court ${h.courtroom}`].filter(Boolean).join(', ');
  const sign = h.advocateName ? `\n\nRegards,\n${h.advocateName}` : '';
  if (h.status === 'scheduled') {
    return `Dear ${h.clientName},\n\nYour case ${matter} is listed on ${when(h.hearingAt)}${place ? ` at ${place}` : ''}. I will update you after the hearing.${sign}`;
  }
  const outcome = h.status === 'adjourned' ? 'was adjourned' : h.status === 'completed' ? 'has been heard' : 'did not go ahead';
  return `Dear ${h.clientName},\n\nThe hearing in your case ${matter} on ${when(h.hearingAt)} ${outcome}.${h.notes ? ` ${h.notes}` : ''}${sign}`;
}
