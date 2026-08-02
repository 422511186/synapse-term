export type ProviderProtocol =
  'openai_responses' | 'openai_chat_completions' | 'anthropic_messages';

export interface CreateProviderProfileInput {
  id: string;
  name: string;
  protocol: ProviderProtocol;
  baseUrl: string;
  credentialRef: string;
  extraHeaders: Readonly<Record<string, string>>;
  timeoutMs: number;
}

export interface ProviderProfile extends CreateProviderProfileInput {
  revision: number;
}

export type ProviderProfileUpdate = Partial<
  Omit<CreateProviderProfileInput, 'id' | 'credentialRef'>
>;

export function createProviderProfile(input: CreateProviderProfileInput): ProviderProfile {
  return {
    id: input.id,
    name: input.name,
    protocol: input.protocol,
    baseUrl: input.baseUrl,
    credentialRef: input.credentialRef,
    extraHeaders: { ...input.extraHeaders },
    timeoutMs: input.timeoutMs,
    revision: 0,
  };
}

export function updateProviderProfile(
  profile: ProviderProfile,
  update: ProviderProfileUpdate,
): ProviderProfile {
  return {
    ...profile,
    ...update,
    extraHeaders:
      update.extraHeaders === undefined ? profile.extraHeaders : { ...update.extraHeaders },
    revision: profile.revision + 1,
  };
}
