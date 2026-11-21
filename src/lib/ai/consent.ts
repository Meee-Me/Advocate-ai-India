import { z } from 'zod';
import { HttpError } from '@/lib/http-errors';

/**
 * Cloud AI consent. Every route that sends text to the AI provider takes these two fields. The browser asks the person
 * first (components/AiConsent), but the SERVER is what enforces it: a request without `consent: true` is refused.
 * Case details (parties, court, notes...) are attached only when `sendCaseDetails: true`; omitted means not sent.
 */
export const consentFields = {
  consent: z.boolean().optional(),
  // Privacy by default: case details leave only when the request explicitly says so (the dialog always does).
  sendCaseDetails: z.boolean().default(false),
};

export function assertConsent(b: { consent?: boolean }): void {
  if (b.consent !== true) {
    throw new HttpError(400, 'Please confirm what will be sent to the AI service before continuing.', 'consent_required');
  }
}
