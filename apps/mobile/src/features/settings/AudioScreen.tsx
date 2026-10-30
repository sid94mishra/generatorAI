// Settings › Audio (MSetAudio, MDF-118; `/settings/audio`): the speech model card (not downloaded → warn + Download ·
// size; downloading → progress, polled; installed → size + Remove…; failed → the error), Speech to text (engine —
// Nemotron offered once its model is installed, pinned by the environment shows read-only; spoken punctuation; pause
// before committing; interim results; the dictation language from MG-17 — "Auto-detect" read-only while the
// installed model only auto-detects) and Text to speech (voice output, voice, speed). Server settings: every change
// needs `admin:settings` and a step-up.
import React from 'react';
import { View } from 'react-native';
import type { AudioSettingsUpdate } from '@generatorai/shared';

import { ListRow } from '../../ui/layout/ListRow';
import { ListSection } from '../../ui/layout/ListSection';
import { confirm } from '../../ui/native/AlertDialog';
import { Button } from '../../ui/primitives/Button';
import { Callout } from '../../ui/primitives/Callout';
import { Card } from '../../ui/primitives/Card';
import { Icon } from '../../ui/primitives/Icon';
import { ProgressBar } from '../../ui/primitives/ProgressBar';
import { Skeleton } from '../../ui/primitives/Skeleton';
import { Text } from '../../ui/primitives/Text';
import { ENGINE_DETAIL, FORMATTER_DETAIL, SPEED_STOPS, engineLabel, formatterLabel, languageLabel, megabytes, pauseLabel, pauseStops, speedLabel } from './audioModel';
import { SettingsPage } from './components/SettingsPage';
import { useAudioModel, useAudioSettings, useAudioWrites } from './queries';
import { adminWrite, useScopeAccess } from './useSettingsAccess';

function ModelCard({ canWrite }: { canWrite: boolean }): React.ReactElement {
  const model = useAudioModel();
  const writes = useAudioWrites();
  const data = model.data;
  return (
    <View className="gap-1.5 px-4">
      <Card radius="group" padding="sm" testID="audio-model-card">
        <View className="gap-3">
          <View className="flex-row items-start gap-3">
            <Icon concept="mic" tone="fg-2" />
            <View className="flex-1 gap-0.5">
              <Text role="body" weight={500}>
                Nemotron 3.5 ASR
              </Text>
              <Text role="footnote" tone="fg-3">
                40 languages · streams words as you speak
              </Text>
            </View>
          </View>
          {!data ? (
            <Skeleton preset="row" />
          ) : data.present ? (
            <View className="gap-2">
              <View className="flex-row items-center gap-1.5">
                <Icon concept="check" size={14} tone="ok" />
                <Text role="footnote" tone="fg-2">
                  Installed · {megabytes(data.bytesOnDisk)}
                </Text>
              </View>
              {canWrite ? (
                <View className="self-start">
                  <Button
                    label="Remove model"
                    icon="trash"
                    variant="secondary"
                    size="sm"
                    onPress={() =>
                      void confirm({ title: 'Remove the speech model?', message: `Frees ${megabytes(data.bytesOnDisk)}. Dictation keeps working on the fallback engine, English only and without live words.`, confirmLabel: 'Remove', destructive: true }).then(
                        (ok) => ok && void adminWrite('Remove the speech model', writes.remove),
                      )
                    }
                    testID="audio-model-remove"
                  />
                </View>
              ) : null}
            </View>
          ) : data.downloading ? (
            <ProgressBar value={data.approxTotalBytes ? (data.bytesOnDisk ?? 0) / data.approxTotalBytes : undefined} tone="run" label="Downloading" valueText={`${megabytes(data.bytesOnDisk)} of about ${megabytes(data.approxTotalBytes)}`} testID="audio-model-progress" />
          ) : (
            <View className="gap-2.5">
              <View className="flex-row items-start gap-1.5">
                <Icon concept="warning" size={14} tone="warn" />
                <Text role="footnote" tone="fg-2" className="flex-1">
                  <Text role="footnote" weight={600} tone="warn">
                    Not downloaded.
                  </Text>{' '}
                  Dictation falls back to Moonshine: English only, no live streaming.
                </Text>
              </View>
              {canWrite ? (
                <View className="flex-row items-center gap-3">
                  <Button label="Download" icon="download" size="sm" onPress={() => void adminWrite('Download the speech model to the server', writes.download)} testID="audio-model-download" />
                  {data.approxTotalBytes ? (
                    <Text role="monoSm" tone="fg-3">
                      about {megabytes(data.approxTotalBytes)}
                    </Text>
                  ) : null}
                </View>
              ) : null}
            </View>
          )}
          {data?.error ? <Callout tone="err" title="The download failed" body={data.error} /> : null}
        </View>
      </Card>
      <Text role="footnote" tone="fg-3" className="px-1">
        Fetched once to the server, never automatically.
      </Text>
    </View>
  );
}

export default function AudioScreen(): React.ReactElement {
  const audio = useAudioSettings();
  const model = useAudioModel();
  const writes = useAudioWrites();
  const access = useScopeAccess('admin:settings', 'Change audio settings from this device');
  const s = audio.data;
  const canWrite = access.granted;
  const save = (patch: AudioSettingsUpdate, reason: string): void => void adminWrite(reason, () => writes.update(patch));
  const languages = model.data?.languages ?? [];
  const modelPresent = model.data?.present === true;

  return (
    <SettingsPage
      title="Audio"
      intro="Dictation and read-aloud run on the server: no cloud, no API key."
      onRefresh={async () => void (await Promise.all([audio.refetch(), model.refetch()]))}
      state={audio.isLoading ? { kind: 'loading', skeleton: <Skeleton preset="list" count={5} /> } : audio.isError && !s ? { kind: 'error', error: audio.error, onRetry: () => void audio.refetch(), title: "Couldn't load audio settings" } : { kind: 'ready' }}
      testID="settings-audio-screen"
    >
      <ModelCard canWrite={canWrite} />
      {!canWrite ? (
        <ListSection>
          <ListRow kind="requires-admin" icon="mic" title="Change audio settings" onPress={access.request} testID="audio-requires-admin" />
        </ListSection>
      ) : null}
      {s ? (
        <>
          <ListSection title="Speech to text" footer={s.engineLockedByEnv ? `Pinned to ${engineLabel(s.engineLockedByEnv)} by GENERATORAI_STT_ENGINE on the server.` : 'Automatic prefers Nemotron, then Moonshine, then Whisper. Only Nemotron detects the language.'}>
            {canWrite && !s.engineLockedByEnv ? (
              <ListRow
                kind="picker"
                title="Engine"
                picker={{ value: s.sttEngine, options: s.engines.map((id) => ({ value: id, label: engineLabel(id), ...(ENGINE_DETAIL[id] ? { description: ENGINE_DETAIL[id] } : {}), ...(id === 'nemotron' && !modelPresent ? { disabled: true } : {}) })), onValueChange: (v) => save({ sttEngine: v }, 'Change the dictation engine') }}
                testID="audio-engine"
              />
            ) : (
              <ListRow kind="value" icon="model" title="Engine" value={engineLabel(s.sttEngine)} />
            )}
            {canWrite ? (
              <ListRow
                kind="picker"
                title="Spoken punctuation"
                picker={{ value: s.textFormatter, options: s.formatters.map((id) => ({ value: id, label: formatterLabel(id), ...(FORMATTER_DETAIL[id] ? { description: FORMATTER_DETAIL[id] } : {}) })), onValueChange: (v) => save({ textFormatter: v }, 'Change spoken punctuation') }}
                testID="audio-punctuation"
              />
            ) : (
              <ListRow kind="value" icon="edit" title="Spoken punctuation" value={formatterLabel(s.textFormatter)} />
            )}
            {canWrite ? (
              <ListRow
                kind="picker"
                title="Pause before committing"
                picker={{ value: String(s.endpointSilenceMs), options: pauseStops(s.minEndpointMs, s.maxEndpointMs, s.endpointSilenceMs).map((ms) => ({ value: String(ms), label: pauseLabel(ms) })), onValueChange: (v) => save({ endpointSilenceMs: Number(v) }, 'Change the dictation pause') }}
                testID="audio-pause"
              />
            ) : (
              <ListRow kind="value" icon="clock" title="Pause before committing" value={pauseLabel(s.endpointSilenceMs)} mono />
            )}
            {s.interimResults !== undefined ? (
              <ListRow kind="toggle" icon="message" title="Show words as you speak" switchValue={s.interimResults} onValueChange={(v) => save({ interimResults: v }, 'Change live dictation words')} disabled={!canWrite} testID="audio-interim" />
            ) : null}
            {canWrite && languages.length ? (
              <ListRow
                kind="picker"
                title="Dictation language"
                picker={{ value: s.sttLanguage, options: [{ value: 'auto', label: 'Auto-detect' }, ...languages.map((tag) => ({ value: tag, label: languageLabel(tag) }))], onValueChange: (v) => save({ sttLanguage: v }, 'Change the dictation language') }}
                testID="audio-language"
              />
            ) : (
              <ListRow kind="value" icon="message" title="Dictation language" value={languageLabel(languages.length ? s.sttLanguage : 'auto')} testID="audio-language" />
            )}
          </ListSection>

          <ListSection title="Text to speech">
            <ListRow kind="toggle" icon="mic" title="Voice output" subtitle="Read replies aloud" switchValue={s.ttsEnabled} onValueChange={(v) => save({ ttsEnabled: v }, v ? 'Turn voice output on' : 'Turn voice output off')} disabled={!canWrite} testID="audio-tts" />
            {s.ttsVoice ? <ListRow kind="value" icon="user" title="Voice" value={s.ttsVoice} mono /> : null}
            {canWrite ? (
              <ListRow kind="picker" title="Speed" picker={{ value: String(s.ttsSpeed), options: [...new Set([...SPEED_STOPS, s.ttsSpeed])].sort((a, b) => a - b).map((x) => ({ value: String(x), label: speedLabel(x) })), onValueChange: (v) => save({ ttsSpeed: Number(v) }, 'Change the reading speed') }} testID="audio-speed" />
            ) : (
              <ListRow kind="value" icon="zap" title="Speed" value={speedLabel(s.ttsSpeed)} mono />
            )}
          </ListSection>
        </>
      ) : null}
    </SettingsPage>
  );
}
