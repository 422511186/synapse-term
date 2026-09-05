export interface AdapterCandidate {
  version: string;
  releaseNotes: string;
}

export type DownloadProgress =
  { phase: 'downloading'; percent: number | null } | { phase: 'verifying' };

export interface UpdateAdapter {
  check(signal: AbortSignal): Promise<AdapterCandidate | null>;
  download(signal: AbortSignal, onProgress: (progress: DownloadProgress) => void): Promise<void>;
  prepare(): Promise<void>;
  install(): Promise<void>;
  dispose(): Promise<void>;
}

export class UpdateVerificationError extends Error {}
