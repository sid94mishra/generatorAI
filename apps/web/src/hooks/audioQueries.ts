// ────────────────────────────────────────────────────────────────
// Audio settings hooks (F-settings-12) — speech-to-text / text-to-speech
// server preferences and the Nemotron speech model's install state.
//
// The microphone INPUT DEVICE is device-local (stores/micPrefsStore.ts,
// hooks/useAudioInputDevices.ts) and deliberately not here — a deviceId
// means nothing on another machine, so it never round-trips to the server.
// ────────────────────────────────────────────────────────────────

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePlatform } from '../providers/PlatformProvider.js';
import type { AudioSettings, SpeechModelStatus } from '../platform/HttpPlatformClient.js';

export type { AudioSettings, SpeechModelStatus } from '../platform/HttpPlatformClient.js';

export const audioKeys = {
  settings: ['audio-settings'] as const,
  model: ['speech-model-status'] as const,
};

export function useAudioSettings() {
  const platform = usePlatform();
  return useQuery({
    queryKey: audioKeys.settings,
    queryFn: () => platform.getAudioSettings(),
    staleTime: 60_000,
  });
}

export function useSetAudioSettings() {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<AudioSettings>) => platform.setAudioSettings(patch),
    onSuccess: (next) => queryClient.setQueryData(audioKeys.settings, next),
  });
}

/**
 * Polls every 1.5s only while a download is in flight — the server fetches
 * the ~754MB model in the background, so nothing but this progress readout
 * needs to be live.
 */
export function useSpeechModelStatus() {
  const platform = usePlatform();
  return useQuery<SpeechModelStatus>({
    queryKey: audioKeys.model,
    queryFn: () => platform.getSpeechModelStatus(),
    refetchInterval: (query) => (query.state.data?.downloading ? 1500 : false),
  });
}

export function useDownloadSpeechModel() {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => platform.downloadSpeechModel(),
    onSuccess: (next) => queryClient.setQueryData(audioKeys.model, next),
  });
}

export function useDeleteSpeechModel() {
  const platform = usePlatform();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => platform.deleteSpeechModel(),
    onSuccess: (next) => queryClient.setQueryData(audioKeys.model, next),
  });
}
