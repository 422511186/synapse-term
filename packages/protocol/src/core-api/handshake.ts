import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';

import { z } from 'zod';

import { protocolVersionSchema } from './version.js';
import type { ProtocolVersion } from './version.js';

const idSchema = z.string().min(1);
const proofSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const handshakeBaseShape = { protocolVersion: protocolVersionSchema };

export const clientHelloSchema = z.strictObject({
  ...handshakeBaseShape,
  kind: z.literal('client_hello'),
  clientInstanceId: idSchema,
});

export const serverChallengeSchema = z.strictObject({
  ...handshakeBaseShape,
  kind: z.literal('server_challenge'),
  coreInstanceId: idSchema,
  challenge: proofSchema,
  issuedAt: z.string().datetime({ offset: true }),
});

export const clientAuthenticationSchema = z.strictObject({
  ...handshakeBaseShape,
  kind: z.literal('client_authentication'),
  clientInstanceId: idSchema,
  coreInstanceId: idSchema,
  challenge: proofSchema,
  proof: proofSchema,
});

export const serverWelcomeSchema = z.strictObject({
  ...handshakeBaseShape,
  kind: z.literal('server_welcome'),
  coreInstanceId: idSchema,
  connectionId: idSchema,
});

export const handshakeMessageSchema = z.discriminatedUnion('kind', [
  clientHelloSchema,
  serverChallengeSchema,
  clientAuthenticationSchema,
  serverWelcomeSchema,
]);

export type ClientHello = z.infer<typeof clientHelloSchema>;
export type ServerChallenge = z.infer<typeof serverChallengeSchema>;
export type ClientAuthentication = z.infer<typeof clientAuthenticationSchema>;
export type ServerWelcome = z.infer<typeof serverWelcomeSchema>;
export type HandshakeMessage = z.infer<typeof handshakeMessageSchema>;

export interface AuthenticationProofInput {
  token: string;
  challenge: string;
  clientInstanceId: string;
  coreInstanceId: string;
  protocolVersion: ProtocolVersion;
}

export interface AuthenticationVerificationInput extends AuthenticationProofInput {
  proof: string;
}

function authenticationContext(input: AuthenticationProofInput): string {
  return [
    'terminal-agent-ipc-v1',
    input.challenge,
    input.clientInstanceId,
    input.coreInstanceId,
    `${String(input.protocolVersion.major)}.${String(input.protocolVersion.minor)}`,
  ].join('\0');
}

export function createHandshakeChallenge(): string {
  return randomBytes(32).toString('base64url');
}

export function createAuthenticationProof(input: AuthenticationProofInput): string {
  return createHmac('sha256', input.token)
    .update(authenticationContext(input), 'utf8')
    .digest('base64url');
}

export function verifyAuthenticationProof(input: AuthenticationVerificationInput): boolean {
  if (!/^[A-Za-z0-9_-]{43}$/.test(input.proof)) return false;

  const expected = Buffer.from(createAuthenticationProof(input), 'base64url');
  const received = Buffer.from(input.proof, 'base64url');
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export interface ServerHandshakeOptions {
  coreInstanceId: string;
  token: string;
  protocolVersion: ProtocolVersion;
  challengeTtlMs?: number;
  now?: () => number;
  challengeFactory?: () => string;
  connectionIdFactory?: () => string;
}

interface PendingChallenge {
  challenge: string;
  clientInstanceId: string;
  expiresAt: number;
  protocolVersion: ProtocolVersion;
}

export class ServerHandshake {
  readonly #coreInstanceId: string;
  readonly #token: string;
  readonly #protocolVersion: ProtocolVersion;
  readonly #challengeTtlMs: number;
  readonly #now: () => number;
  readonly #challengeFactory: () => string;
  readonly #connectionIdFactory: () => string;
  #state: 'waiting_hello' | 'waiting_authentication' | 'authenticated' | 'failed' = 'waiting_hello';
  #pendingChallenge: PendingChallenge | undefined;

  constructor(options: ServerHandshakeOptions) {
    this.#coreInstanceId = options.coreInstanceId;
    this.#token = options.token;
    this.#protocolVersion = options.protocolVersion;
    this.#challengeTtlMs = options.challengeTtlMs ?? 30_000;
    this.#now = options.now ?? Date.now;
    this.#challengeFactory = options.challengeFactory ?? createHandshakeChallenge;
    this.#connectionIdFactory = options.connectionIdFactory ?? randomUUID;
  }

  acceptHello(
    hello: ClientHello,
  ):
    | { ok: true; message: ServerChallenge }
    | { ok: false; error: 'invalid_message' | 'incompatible_protocol' } {
    if (this.#state !== 'waiting_hello') {
      return { ok: false, error: 'invalid_message' };
    }

    const negotiation = negotiateProtocolVersion(this.#protocolVersion, hello.protocolVersion);
    if (!negotiation.ok) {
      this.#state = 'failed';
      return negotiation;
    }

    const issuedAt = this.#now();
    const challenge = this.#challengeFactory();
    this.#pendingChallenge = {
      challenge,
      clientInstanceId: hello.clientInstanceId,
      expiresAt: issuedAt + this.#challengeTtlMs,
      protocolVersion: negotiation.version,
    };
    this.#state = 'waiting_authentication';

    return {
      ok: true,
      message: {
        kind: 'server_challenge',
        protocolVersion: negotiation.version,
        coreInstanceId: this.#coreInstanceId,
        challenge,
        issuedAt: new Date(issuedAt).toISOString(),
      },
    };
  }

  acceptAuthentication(
    authentication: ClientAuthentication,
  ): { ok: true; message: ServerWelcome } | { ok: false; error: 'authentication_failed' } {
    const pending = this.#pendingChallenge;
    if (this.#state !== 'waiting_authentication' || pending === undefined) {
      return { ok: false, error: 'authentication_failed' };
    }

    this.#state = 'failed';
    this.#pendingChallenge = undefined;
    const versionMatches =
      authentication.protocolVersion.major === pending.protocolVersion.major &&
      authentication.protocolVersion.minor === pending.protocolVersion.minor;
    const authenticated =
      this.#now() <= pending.expiresAt &&
      authentication.clientInstanceId === pending.clientInstanceId &&
      authentication.coreInstanceId === this.#coreInstanceId &&
      authentication.challenge === pending.challenge &&
      versionMatches &&
      verifyAuthenticationProof({
        token: this.#token,
        challenge: pending.challenge,
        clientInstanceId: pending.clientInstanceId,
        coreInstanceId: this.#coreInstanceId,
        protocolVersion: pending.protocolVersion,
        proof: authentication.proof,
      });

    if (!authenticated) {
      return { ok: false, error: 'authentication_failed' };
    }

    this.#state = 'authenticated';
    return {
      ok: true,
      message: {
        kind: 'server_welcome',
        protocolVersion: pending.protocolVersion,
        coreInstanceId: this.#coreInstanceId,
        connectionId: this.#connectionIdFactory(),
      },
    };
  }
}

export function negotiateProtocolVersion(
  local: ProtocolVersion,
  remote: ProtocolVersion,
): { ok: true; version: ProtocolVersion } | { ok: false; error: 'incompatible_protocol' } {
  if (local.major !== remote.major) {
    return { ok: false, error: 'incompatible_protocol' };
  }

  return {
    ok: true,
    version: { major: local.major, minor: Math.min(local.minor, remote.minor) },
  };
}
