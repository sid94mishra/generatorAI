// ────────────────────────────────────────────────────────────────
// F-settings-12 Audio (04 §3.1; content reference MSetAudio). Speech
// recognition model install state, microphone (device-local), speech-to-text
// behaviour and text-to-speech — everything runs on this machine, no cloud,
// no API key. The best speech model is a ~754MB download this app
// deliberately does NOT fetch on its own, so the model card says plainly
// what is missing, what it costs, and what dictation loses without it.
// ────────────────────────────────────────────────────────────────

import { useMemo, useState } from 'react';
import {
  useAudioSettings,
  useDeleteSpeechModel,
  useDownloadSpeechModel,
  useSetAudioSettings,
  useSpeechModelStatus,
  type AudioSettings,
} from '@/hooks/audioQueries.js';
import { useAudioInputDevices } from '@/hooks/useAudioInputDevices.js';
import { resolveMicDeviceId, useMicPrefsStore } from '@/stores/micPrefsStore.js';

import { Button } from '@/ui/primitives/Button/Button.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { Icon } from '@/ui/icons/Icon.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { NumberField } from '@/ui/primitives/NumberField/NumberField.js';
import { ProgressBar } from '@/ui/primitives/ProgressBar/ProgressBar.js';
import { Select, type SelectItem } from '@/ui/primitives/Select/Select.js';
import { Slider } from '@/ui/primitives/Slider/Slider.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { Switch } from '@/ui/primitives/Switch/Switch.js';
import { SectionHeader } from '@/ui/patterns/SectionHeader/SectionHeader.js';
import { SettingRow, SettingsSection } from '@/ui/patterns/SettingsSection/SettingsSection.js';

const ENGINE_LABEL: Record<string, string> = {
  auto: 'Automatic (recommended)',
  nemotron: 'Nemotron 3.5 ASR — streaming, multilingual',
  moonshine: 'Moonshine Base — fastest, English',
  parakeet: 'Parakeet CTC — no punctuation',
  whisper: 'Whisper base.en — slowest, most forgiving',
};

const FORMATTER_LABEL: Record<string, string> = {
  'rule-based': 'On — spoken punctuation and filler cleanup',
  none: 'Off — exactly what the model transcribed',
};

/** Where the system's own default input is represented in the picker. */
const SYSTEM_DEFAULT_MIC = '';

const mb = (bytes: number): string => `${Math.round(bytes / 1024 / 1024)} MB`;

function SpeechModelGroup() {
  const model = useSpeechModelStatus();
  const download = useDownloadSpeechModel();
  const remove = useDeleteSpeechModel();
  const data = model.data;

  return (
    <section className="flex flex-col gap-2">
      <SectionHeader title="Speech recognition model" level={3} />
      <p className="text-small text-fg-3">
        Nemotron 3.5 ASR from NVIDIA — 40 languages, punctuation and capitalization, and the only engine that streams words as
        you speak them.
      </p>
      {!data ? (
        <div className="flex items-center gap-2 text-small text-fg-3">
          <Spinner size={14} /> Loading…
        </div>
      ) : data.present ? (
        <div className="flex flex-col gap-2">
          <p className="flex items-center gap-2 text-ui text-ok">
            <Icon concept="mic" size={16} /> Installed — {mb(data.bytesOnDisk)}
          </p>
          <p className="break-all text-small text-fg-3">{data.dir}</p>
          <Button size="sm" icon="trash" loading={remove.isPending} onClick={() => remove.mutate()} className="self-start">
            Remove model
          </Button>
          <p className="text-small text-fg-3">
            Removing it frees {mb(data.bytesOnDisk)}. Dictation keeps working on the fallback engine, without streaming or the
            other 39 languages.
          </p>
        </div>
      ) : data.downloading ? (
        <div className="flex flex-col gap-2">
          <ProgressBar value={data.bytesOnDisk} max={data.approxTotalBytes || 100} kind="meter" label="Downloading" />
          <p className="text-small text-fg-3">
            {mb(data.bytesOnDisk)} of about {mb(data.approxTotalBytes)}. You can leave this page; the download continues on the
            server.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Callout tone="warn">
            Not downloaded. Dictation still works, but it falls back to Moonshine — English only, no live word-by-word
            streaming, and less accurate on technical words.
          </Callout>
          <p className="text-small text-fg-3">
            About {mb(data.approxTotalBytes)}, fetched once from <span className="font-mono">{data.repo}</span> and stored on
            this machine. Never downloaded automatically — nothing is fetched unless you press this button.
          </p>
          <Button size="sm" icon="download" loading={download.isPending} onClick={() => download.mutate()} className="self-start">
            Download model
          </Button>
        </div>
      )}
      {data?.error ? <Callout tone="err">{data.error}</Callout> : null}
    </section>
  );
}

function MicrophoneGroup() {
  const mics = useAudioInputDevices();
  const micDeviceId = useMicPrefsStore((s) => s.deviceId);
  const micDeviceLabel = useMicPrefsStore((s) => s.deviceLabel);
  const setMicDevice = useMicPrefsStore((s) => s.setDevice);
  const resolvedMic = useMemo(
    () => resolveMicDeviceId(mics.devices, { deviceId: micDeviceId, deviceLabel: micDeviceLabel }),
    [mics.devices, micDeviceId, micDeviceLabel],
  );
  const micMissing = micDeviceId !== '' && resolvedMic === null;

  const items: SelectItem[] = [
    { value: SYSTEM_DEFAULT_MIC, label: 'System default' },
    ...mics.devices.map((d, i) => ({ value: d.deviceId, label: d.label || `Microphone ${i + 1}` })),
    ...(micMissing ? [{ value: micDeviceId, label: `${micDeviceLabel || 'Saved microphone'} (not connected)` }] : []),
  ];

  return (
    <section className="flex flex-col gap-2">
      <SectionHeader title="Microphone" level={3} />
      <p className="text-small text-fg-3">
        Which input dictation records from on this device. Stored here, not on the server — a headset plugged into this
        machine is not the one plugged into your phone.
      </p>
      <SettingRow
        label="Input device"
        hint={
          mics.labelsVisible
            ? 'Following the system default means dictation moves with whatever you pick in the operating system.'
            : 'Device names are hidden until the microphone has been used once.'
        }
        control={
          <Select
            aria-label="Microphone input device"
            value={micDeviceId}
            disabled={!mics.labelsVisible && mics.devices.length === 0}
            onValueChange={(v) => setMicDevice(v ?? '', items.find((i) => i.value === v)?.label as string)}
            items={items}
            className="w-56"
          />
        }
      />
      {!mics.labelsVisible ? (
        <Button size="sm" icon="mic" onClick={() => void mics.requestLabels()} className="self-start">
          Show device names
        </Button>
      ) : null}
      {micMissing ? (
        <Callout tone="warn">
          {micDeviceLabel || 'The selected microphone'} is not connected right now. Dictation will use the system default
          until it is back.
        </Callout>
      ) : null}
      {mics.error ? <Callout tone="err">{mics.error}</Callout> : null}
    </section>
  );
}

function SpeechToTextGroup({
  settings,
  modelPresent,
  busy,
  onSave,
}: {
  settings: AudioSettings;
  modelPresent: boolean;
  busy: boolean;
  onSave: (patch: Partial<AudioSettings>) => void;
}) {
  const engineLocked = Boolean(settings.engineLockedByEnv);
  const [pauseDraft, setPauseDraft] = useState<number | null>(settings.endpointSilenceMs);

  const engineItems: SelectItem[] = (settings.engines ?? ['auto']).map((id) => ({
    value: id,
    label: ENGINE_LABEL[id] ?? id,
    disabled: id === 'nemotron' && !modelPresent,
  }));
  const formatterItems: SelectItem[] = (settings.formatters ?? ['rule-based', 'none']).map((id) => ({
    value: id,
    label: FORMATTER_LABEL[id] ?? id,
  }));

  return (
    <section className="flex flex-col gap-2">
      <SectionHeader title="Speech to text" level={3} hint="How dictation behaves." />
      <div className="flex flex-col">
        <SettingRow
          label="Engine"
          hint={
            engineLocked
              ? `Pinned to "${settings.engineLockedByEnv}" by GENERATORAI_STT_ENGINE in this server's environment.`
              : settings.sttEngine === 'nemotron' && !modelPresent
                ? 'Nemotron is selected, but its model is not downloaded — dictation is running on Moonshine until you download it above.'
                : 'Automatic prefers Nemotron when its model is installed, and falls back to Moonshine, then Whisper.'
          }
          control={
            <Select
              aria-label="Speech recognition engine"
              value={settings.sttEngine}
              disabled={busy || engineLocked}
              onValueChange={(v) => v && onSave({ sttEngine: v })}
              items={engineItems}
              className="w-56"
            />
          }
        />
        <SettingRow
          label="Spoken punctuation"
          hint='"Comma", "new line" become symbols, numbers are written as digits, and filler words are removed. Off inserts the raw transcript.'
          control={
            <Select
              aria-label="Spoken punctuation handling"
              value={settings.textFormatter}
              disabled={busy}
              onValueChange={(v) => v && onSave({ textFormatter: v })}
              items={formatterItems}
              className="w-56"
            />
          }
        />
        <SettingRow
          label="Pause before committing"
          hint="How long a silence ends a sentence and commits it to the composer."
          control={
            <div
              onBlur={() => {
                if (pauseDraft != null && Number.isFinite(pauseDraft) && pauseDraft !== settings.endpointSilenceMs) {
                  onSave({ endpointSilenceMs: pauseDraft });
                }
              }}
            >
              <NumberField
                aria-label="Pause before committing, in milliseconds"
                value={pauseDraft}
                onValueChange={setPauseDraft}
                min={settings.minEndpointMs ?? 200}
                max={settings.maxEndpointMs ?? 3000}
                step={50}
                unit="ms"
                disabled={busy}
                className="w-32"
              />
            </div>
          }
        />
      </div>
    </section>
  );
}

function TextToSpeechGroup({ settings, busy, onSave }: { settings: AudioSettings; busy: boolean; onSave: (patch: Partial<AudioSettings>) => void }) {
  const [voiceDraft, setVoiceDraft] = useState(settings.ttsVoice);
  const [speed, setSpeed] = useState(settings.ttsSpeed);
  const enabled = settings.ttsEnabled !== false;

  return (
    <section className="flex flex-col gap-2">
      <SectionHeader title="Text to speech" level={3} hint="Reading assistant replies aloud." />
      <div className="flex flex-col">
        <SettingRow
          label="Enable voice output"
          hint="Adds the Read aloud action to assistant messages. Uses Kokoro, downloaded on first use (about 90MB)."
          control={<Switch aria-label="Enable voice output" checked={enabled} disabled={busy} onCheckedChange={(next) => onSave({ ttsEnabled: next })} />}
        />
        <SettingRow
          label="Voice"
          hint="Kokoro voice name."
          control={
            <Input
              aria-label="Text to speech voice"
              value={voiceDraft}
              disabled={busy || !enabled}
              onChange={(e) => setVoiceDraft(e.target.value)}
              onBlur={() => {
                const v = voiceDraft.trim();
                if (v && v !== settings.ttsVoice) onSave({ ttsVoice: v });
              }}
              className="w-32"
            />
          }
        />
        <SettingRow
          label="Speed"
          hint="0.5 to 2.0."
          control={
            <div className="flex w-40 items-center gap-2">
              <Slider
                aria-label="Text to speech speed"
                min={0.5}
                max={2}
                step={0.1}
                value={speed}
                disabled={busy || !enabled}
                onValueChange={setSpeed}
                onValueCommitted={(v) => onSave({ ttsSpeed: v })}
              />
              <span className="w-8 shrink-0 text-right font-mono text-micro text-fg-3">{speed.toFixed(1)}</span>
            </div>
          }
        />
      </div>
    </section>
  );
}

export function AudioSection() {
  const settingsQuery = useAudioSettings();
  const modelQuery = useSpeechModelStatus();
  const setSettings = useSetAudioSettings();
  const [error, setError] = useState<string | null>(null);

  const onSave = (patch: Partial<AudioSettings>) => {
    setError(null);
    setSettings.mutate(patch, {
      onError: (err) => setError(err instanceof Error ? err.message : String(err)),
    });
  };

  const settings = settingsQuery.data;

  return (
    <SettingsSection
      title="Audio"
      description="Speech-to-text for dictating into the composer, and text-to-speech for reading replies aloud. Everything runs on this machine — no cloud, no API key."
    >
      <div className="flex flex-col gap-6">
        <SpeechModelGroup />
        <MicrophoneGroup />
        {!settings ? (
          <div className="flex items-center gap-2 text-small text-fg-3">
            <Spinner size={14} /> Loading…
          </div>
        ) : (
          <>
            <SpeechToTextGroup settings={settings} modelPresent={modelQuery.data?.present === true} busy={setSettings.isPending} onSave={onSave} />
            <TextToSpeechGroup settings={settings} busy={setSettings.isPending} onSave={onSave} />
          </>
        )}
        {error ? <Callout tone="err">{error}</Callout> : null}
      </div>
    </SettingsSection>
  );
}
