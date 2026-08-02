import { z } from 'zod';

export const protocolVersionSchema = z.strictObject({
  major: z.number().int().nonnegative(),
  minor: z.number().int().nonnegative(),
});

export type ProtocolVersion = z.infer<typeof protocolVersionSchema>;

export const CURRENT_PROTOCOL_VERSION = {
  major: 2,
  minor: 0,
} as const satisfies ProtocolVersion;
