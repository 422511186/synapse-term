import { z } from 'zod';

import { protocolErrorSchema } from './errors.js';
import { protocolVersionSchema } from './version.js';

const idSchema = z.string().min(1);
const sentAtSchema = z.string().datetime({ offset: true });
const envelopeBaseShape = {
  id: idSchema,
  protocolVersion: protocolVersionSchema,
  sentAt: sentAtSchema,
};

export const requestEnvelopeSchema = z.strictObject({
  ...envelopeBaseShape,
  kind: z.literal('request'),
  method: z.string().min(1),
  payload: z.json(),
});

const successResponseEnvelopeSchema = z.strictObject({
  ...envelopeBaseShape,
  kind: z.literal('response'),
  requestId: idSchema,
  ok: z.literal(true),
  result: z.json(),
});

const errorResponseEnvelopeSchema = z.strictObject({
  ...envelopeBaseShape,
  kind: z.literal('response'),
  requestId: idSchema,
  ok: z.literal(false),
  error: protocolErrorSchema,
});

export const responseEnvelopeSchema = z.discriminatedUnion('ok', [
  successResponseEnvelopeSchema,
  errorResponseEnvelopeSchema,
]);

export const eventEnvelopeSchema = z.strictObject({
  ...envelopeBaseShape,
  kind: z.literal('event'),
  streamId: idSchema,
  sequence: z.number().int().nonnegative(),
  event: z.string().min(1),
  payload: z.json(),
});

export const controlEnvelopeSchema = z.union([
  requestEnvelopeSchema,
  responseEnvelopeSchema,
  eventEnvelopeSchema,
]);

export type RequestEnvelope = z.infer<typeof requestEnvelopeSchema>;
export type ResponseEnvelope = z.infer<typeof responseEnvelopeSchema>;
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;
export type ControlEnvelope = z.infer<typeof controlEnvelopeSchema>;
