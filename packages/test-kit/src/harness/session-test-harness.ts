/**
 * Session test harness for environment identification and dispatch tests.
 * Wraps FakePty with write capture, environment epoch tracking,
 * and simulated SSH/container/nested shell responses.
 */

import type { ExecutionDialect, EnvironmentPlatform } from '@synapse-term/domain';

import { FakePty, type FakePtyExitEvent } from '../fake/fake-pty.js';
import { EventRecorder } from './event-recorder.js';

export interface CapturedWrite {
  readonly data: string;
  readonly timestamp: number;
}

export interface HarnessAuditEvent {
  readonly type: string;
  readonly payload: Record<string, unknown>;
}

export interface EnvironmentSnapshot {
  readonly dialect: ExecutionDialect;
  readonly platform: EnvironmentPlatform;
  readonly verificationStatus: string;
  readonly capabilityEpoch: number;
}

/**
 * Simulated environment for testing SSH hop / container / nested shell scenarios.
 * Defines what the FakePty "responds" with when probes are sent.
 */
export interface SimulatedEnvironment {
  /** The dialect the simulated environment actually is */
  readonly dialect: ExecutionDialect;
  readonly platform: EnvironmentPlatform;
  /** Optional custom probe response (otherwise auto-generated) */
  readonly probeResponse?: (nonce: string) => string;
}

export class SessionTestHarness {
  readonly pty: FakePty;
  readonly writes: CapturedWrite[] = [];
  readonly auditEvents = new EventRecorder<HarnessAuditEvent>();
  #timestamp = 0;
  #simulatedEnv: SimulatedEnvironment | null = null;

  constructor(pid = 1) {
    this.pty = new FakePty(pid);
    const origWrite = this.pty.write.bind(this.pty);
    this.pty.write = (data: string) => {
      this.writes.push({ data, timestamp: this.#timestamp });
      origWrite(data);
      this.#maybeRespondToProbe(data);
    };
  }

  get allWrittenText(): string {
    return this.writes.map((w) => w.data).join('');
  }

  get writtenLines(): string[] {
    return this.writes.map((w) => w.data);
  }

  /**
   * Configure simulated environment (SSH hop, container, etc.)
   * When set, the harness will auto-respond to probe patterns.
   */
  setSimulatedEnvironment(env: SimulatedEnvironment | null): void {
    this.#simulatedEnv = env;
  }

  /**
   * Advance simulated time.
   */
  advanceTime(ms: number): void {
    this.#timestamp += ms;
  }

  /**
   * Emit data as if from the PTY (simulating shell output).
   */
  emitData(data: string): void {
    this.pty.emitData(data);
  }

  /**
   * Emit a completion event for the given nonce.
   */
  emitCompletion(nonce: string, exitCode: number): void {
    this.pty.emitData(`\u001b]777;TA;${nonce};${exitCode}\u0007`);
    this.pty.emitData(`__TA_DONE_${nonce};${exitCode}__\n`);
  }

  /**
   * Emit a prompt-like output (simulating shell ready).
   */
  emitPrompt(prompt = '$ '): void {
    this.pty.emitData(prompt);
  }

  /**
   * Simulate SSH hop: changes the simulated environment and emits
   * an SSH welcome banner.
   */
  simulateSshHop(target: SimulatedEnvironment, banner?: string): void {
    this.#simulatedEnv = target;
    if (banner) {
      this.pty.emitData(banner);
    }
  }

  /**
   * Simulate entering a container (e.g., docker exec).
   */
  simulateContainerEntry(containerDialect: ExecutionDialect = 'posix'): void {
    this.#simulatedEnv = {
      dialect: containerDialect,
      platform: 'unix',
    };
    this.pty.emitData(`root@container:/#\u001b[?2004h`);
  }

  /**
   * Simulate nested shell entry (e.g., bash inside powershell).
   */
  simulateNestedShell(targetDialect: ExecutionDialect): void {
    this.#simulatedEnv = {
      dialect: targetDialect,
      platform: targetDialect === 'powershell' ? 'windows' : 'unix',
    };
  }

  /**
   * Emit PTY exit event.
   */
  emitExit(event: FakePtyExitEvent): void {
    this.pty.emitExit(event);
  }

  /**
   * Record an audit event for test assertions.
   */
  recordAudit(type: string, payload: Record<string, unknown>): void {
    this.auditEvents.record({ type, payload });
  }

  /**
   * Assert that no base64-encoded execution was sent to PTY.
   */
  assertNoEncodedExecution(): void {
    const all = this.allWrittenText;
    if (all.includes('base64 -d') || all.includes('FromBase64String')) {
      throw new Error('Found encoded execution pattern in PTY writes');
    }
    if (all.includes('__ta_b64') || all.includes('$__ta_b64')) {
      throw new Error('Found base64 variable assignment in PTY writes');
    }
    if (/\beval\s/.test(all) && all.includes('base64')) {
      throw new Error('Found eval with base64 in PTY writes');
    }
  }

  /**
   * Assert that the original command is visible in plaintext in PTY writes.
   */
  assertCommandVisible(command: string): void {
    if (!this.allWrittenText.includes(command)) {
      throw new Error(`Command not found in PTY writes: ${command}`);
    }
  }

  /**
   * Assert that transaction markers are present.
   */
  assertTransactionMarkersPresent(): void {
    const all = this.allWrittenText;
    if (!all.includes('__TA_START__') && !all.includes("'__TA_'")) {
      throw new Error('Missing __TA_START__ marker in PTY writes');
    }
    if (!all.includes('__TA_DONE_')) {
      throw new Error('Missing __TA_DONE_ marker in PTY writes');
    }
  }

  /**
   * Get the current simulated environment (if any).
   */
  get simulatedEnvironment(): SimulatedEnvironment | null {
    return this.#simulatedEnv;
  }

  #maybeRespondToProbe(data: string): void {
    if (!this.#simulatedEnv) return;
    // Auto-respond to probe patterns if a simulated environment is active
    if (data.includes("'__TA_'") && data.includes("'START__'")) {
      // This looks like a POSIX probe start marker
      const nonceMatch = data.match(/__TA_DONE_([^;]+);/);
      if (nonceMatch) {
        // Respond with simulated environment output
        const nonce = nonceMatch[1]!;
        setTimeout(() => {
          this.emitCompletion(nonce, 0);
        }, 0);
      }
    }
  }
}

/**
 * Predefined simulated environments for common test scenarios.
 */
export const SIMULATED_ENVIRONMENTS = {
  /** Native POSIX (e.g., local Linux/macOS bash) */
  nativePosix: {
    dialect: 'posix' as const,
    platform: 'unix' as const,
  },

  /** Native PowerShell (e.g., local Windows pwsh) */
  nativePowerShell: {
    dialect: 'powershell' as const,
    platform: 'windows' as const,
  },

  /** PowerShell SSH'd into a Linux server */
  powershellToPosixSsh: {
    dialect: 'posix' as const,
    platform: 'unix' as const,
  },

  /** POSIX SSH'd into a Windows PowerShell endpoint */
  posixToPowerShellSsh: {
    dialect: 'powershell' as const,
    platform: 'windows' as const,
  },

  /** Inside a Linux container */
  containerPosix: {
    dialect: 'posix' as const,
    platform: 'unix' as const,
  },

  /** Inside a Windows container */
  containerPowerShell: {
    dialect: 'powershell' as const,
    platform: 'windows' as const,
  },

  /** Ambiguous environment (neither clearly POSIX nor PowerShell) */
  ambiguous: {
    dialect: 'observe_only' as const,
    platform: 'unknown' as const,
  },
} as const;
