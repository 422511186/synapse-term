export const RELEASES_URL = 'https://github.com/422511186/synapse-term/releases';

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'verifying'
  | 'ready'
  | 'installing'
  | 'error'
  | 'unsupported';

export interface UpdateCandidate {
  id: string;
  version: string;
  releaseNotes: string;
}

export interface UpdateState {
  phase: UpdatePhase;
  currentVersion: string;
  automaticChecks: boolean;
  lastCheckedAt: string | null;
  candidate: UpdateCandidate | null;
  progress: number | null;
  error: { stage: 'check' | 'download' | 'verify' | 'prepare' | 'install'; message: string } | null;
  unsupportedReason: string | null;
}

export interface InstallationImpact {
  candidateId: string;
  version: string;
  sessionCount: number;
  confirmationId: string;
}

export interface UpdateApi {
  getState(): Promise<UpdateState>;
  setAutomaticChecks(enabled: boolean): Promise<UpdateState>;
  check(): Promise<UpdateState>;
  download(candidateId: string): Promise<UpdateState>;
  cancel(): Promise<UpdateState>;
  getInstallImpact(candidateId: string): Promise<InstallationImpact>;
  install(candidateId: string, confirmationId: string): Promise<UpdateState>;
  onChanged(listener: (state: UpdateState) => void): () => void;
}
