import { describe, expect, it } from 'vitest';

import {
  clientAuthenticationSchema,
  clientHelloSchema,
  createAuthenticationProof,
  createHandshakeChallenge,
  handshakeMessageSchema,
  negotiateProtocolVersion,
  ServerHandshake,
  serverChallengeSchema,
  serverWelcomeSchema,
  verifyAuthenticationProof,
} from './handshake.js';

describe('IPC handshake', () => {
  it('negotiates the lower minor version within the same major version', () => {
    expect(negotiateProtocolVersion({ major: 1, minor: 3 }, { major: 1, minor: 1 })).toEqual({
      ok: true,
      version: { major: 1, minor: 1 },
    });
  });

  it('rejects a different major version', () => {
    expect(negotiateProtocolVersion({ major: 1, minor: 3 }, { major: 2, minor: 0 })).toEqual({
      ok: false,
      error: 'incompatible_protocol',
    });
  });

  it('parses the strict challenge-response handshake messages', () => {
    const protocolVersion = { major: 1, minor: 0 };
    const clientHello = {
      kind: 'client_hello',
      protocolVersion,
      clientInstanceId: 'desktop-1',
    };
    const serverChallenge = {
      kind: 'server_challenge',
      protocolVersion,
      coreInstanceId: 'core-1',
      challenge: 'A'.repeat(43),
      issuedAt: '2026-07-27T15:00:00.000Z',
    };
    const clientAuthentication = {
      kind: 'client_authentication',
      protocolVersion,
      clientInstanceId: 'desktop-1',
      coreInstanceId: 'core-1',
      challenge: 'A'.repeat(43),
      proof: 'B'.repeat(43),
    };
    const serverWelcome = {
      kind: 'server_welcome',
      protocolVersion,
      coreInstanceId: 'core-1',
      connectionId: 'connection-1',
    };

    expect(clientHelloSchema.parse(clientHello)).toEqual(clientHello);
    expect(serverChallengeSchema.parse(serverChallenge)).toEqual(serverChallenge);
    expect(clientAuthenticationSchema.parse(clientAuthentication)).toEqual(clientAuthentication);
    expect(serverWelcomeSchema.parse(serverWelcome)).toEqual(serverWelcome);
    expect(handshakeMessageSchema.parse(serverWelcome)).toEqual(serverWelcome);
    expect(
      clientAuthenticationSchema.safeParse({ ...clientAuthentication, token: 'raw-secret' })
        .success,
    ).toBe(false);
  });

  it('proves token possession without sending the token', () => {
    const input = {
      token: 'local-auth-token-with-at-least-32-bytes',
      challenge: 'A'.repeat(43),
      clientInstanceId: 'desktop-1',
      coreInstanceId: 'core-1',
      protocolVersion: { major: 1, minor: 0 },
    };
    const proof = createAuthenticationProof(input);

    expect(proof).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(createAuthenticationProof(input)).toBe(proof);
    expect(verifyAuthenticationProof({ ...input, proof })).toBe(true);
    expect(verifyAuthenticationProof({ ...input, clientInstanceId: 'desktop-2', proof })).toBe(
      false,
    );
  });

  it('creates a 256-bit URL-safe challenge', () => {
    const challenge = createHandshakeChallenge();

    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(challenge, 'base64url')).toHaveLength(32);
  });

  it('authenticates once and rejects replay of the challenge', () => {
    const token = 'local-auth-token-with-at-least-32-bytes';
    const challenge = 'A'.repeat(43);
    const server = new ServerHandshake({
      coreInstanceId: 'core-1',
      token,
      protocolVersion: { major: 1, minor: 0 },
      now: () => Date.parse('2026-07-27T15:00:00.000Z'),
      challengeFactory: () => challenge,
      connectionIdFactory: () => 'connection-1',
    });
    const hello = {
      kind: 'client_hello' as const,
      protocolVersion: { major: 1, minor: 0 },
      clientInstanceId: 'desktop-1',
    };
    const challengeResult = server.acceptHello(hello);
    expect(challengeResult).toEqual({
      ok: true,
      message: {
        kind: 'server_challenge',
        protocolVersion: { major: 1, minor: 0 },
        coreInstanceId: 'core-1',
        challenge,
        issuedAt: '2026-07-27T15:00:00.000Z',
      },
    });
    if (!challengeResult.ok) throw new Error('expected a challenge');
    const proof = createAuthenticationProof({
      token,
      challenge,
      clientInstanceId: 'desktop-1',
      coreInstanceId: 'core-1',
      protocolVersion: { major: 1, minor: 0 },
    });
    const authentication = {
      kind: 'client_authentication' as const,
      protocolVersion: { major: 1, minor: 0 },
      clientInstanceId: 'desktop-1',
      coreInstanceId: 'core-1',
      challenge,
      proof,
    };

    expect(server.acceptAuthentication(authentication)).toEqual({
      ok: true,
      message: {
        kind: 'server_welcome',
        protocolVersion: { major: 1, minor: 0 },
        coreInstanceId: 'core-1',
        connectionId: 'connection-1',
      },
    });
    expect(server.acceptAuthentication(authentication)).toEqual({
      ok: false,
      error: 'authentication_failed',
    });
  });
});
