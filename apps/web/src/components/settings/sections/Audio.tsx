// ────────────────────────────────────────────────────────────────
// Settings → Audio.
//
// The best speech model is a ~754MB download that this app deliberately does
// NOT fetch on its own, so the first job of this screen is to be honest about
// that: say what is missing, what it costs, what you lose without it, and let
// the user decide. Dictation still works meanwhile on the fallback engine —
// this screen says so plainly rather than implying voice is broken, and
// equally does not pretend the fallback is equivalent.
//
// Everything on this screen is wired. Controls that look like settings but
// change nothing are worse than no controls at all, so the engine picker
// reports when an operator has pinned the engine in the environment, and
// nothing is exposed here that the server does not actually read.
// ────────────────────────────────────────────────────────────────

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Download, Mic, Trash2, Volume2 } from 'lucide-react';
import { usePlatform } from '@/providers/PlatformProvider.js';
import { Button, Select, Spinner, ToggleSwitch } from '@/components/ui/index.js';
import type { AudioSettings, SpeechModelStatus } from '@/platform/HttpPlatformClient.js';
import { useAudioInputDevices } from '@/hooks/useAudioInputDevices.js';
import { resolveMicDeviceId, useMicPrefsStore } from '@/stores/micPrefsStore.js';
import { SectionHeader, SettingsCard, SettingRow } from '../shared.js';

const ENGINE_LABEL: Record<string, string> = {
  auto: 'Automatic (recommended)',
  nemotron: 'Nemotron 3.5 ASR — streaming, multilingual',
  moonshine: 'Moonshine Base — fastest, English',
  parakeet: 'Parakeet CTC — no punctuation',
  whisper: 'Whisper base.en — slowest, most forgiving',
};

/** Where the system's own default input is represented in the picker. */
const SYSTEM_DEFAULT_MIC = '';

const FORMATTER_LABEL: Record<string, string> = {
  'rule-based': 'On — spoken punctuation and filler cleanup',
  none: 'Off — exactly what the model transcribed',
};

const mb = (bytes: number): string => `${Math.round(bytes / 1024 / 1024)} MB`;

export function AudioSection() {
  const platform = usePlatform();
  const [settings, setSettings] = useState<AudioSettings | null>(null);
  const [model, setModel] = useState<SpeechModelStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Microphone ──
  // Device-local, so it is NOT part of the server-side audio preferences: a
  // deviceId means nothing on another machine, and the desktop app and a
  // phone signed into the same server must each keep their own.
  const mics = useAudioInputDevices();
  const micDeviceId = useMicPrefsStore((st) => st.deviceId);
  const micDeviceLabel = useMicPrefsStore((st) => st.deviceLabel);
  const setMicDevice = useMicPrefsStore((st) => st.setDevice);
  const resolvedMic = useMemo(
    () => resolveMicDeviceId(mics.devices, { deviceId: micDeviceId, deviceLabel: micDeviceLabel }),
    [mics.devices, micDeviceId, micDeviceLabel],
  );
  /** The chosen device is stored but not currently attached. */
  const micMissing = micDeviceId !== '' && resolvedMic === null;

  const refreshModel = useCallback(async () => {
    try {
      setModel(await platform.getSpeechModelStatus());
    } catch {
      /* transient; the next poll retries */
    }
  }, [platform]);

  useEffect(() => {
    let alive = true;
    void Promise.all([platform.getAudioSettings(), platform.getSpeechModelStatus()])
      .then(([s, m]) => {
        if (!alive) return;
        setSettings(s);
        setModel(m);
      })
      .catch((e: unknown) => alive && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [platform]);

  // Poll only while a download is actually running — the server does the work
  // in the background because three quarters of a gigabyte outlives any
  // sensible request timeout.
  useEffect(() => {
    if (!model?.downloading) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    if (pollRef.current) return;
    pollRef.current = setInterval(() => void refreshModel(), 1500);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [model?.downloading, refreshModel]);

  const save = useCallback(
    async (patch: Partial<AudioSettings>) => {
      setBusy(true);
      setError(null);
      try {
        setSettings(await platform.setAudioSettings(patch));
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [platform],
  );

  const startDownload = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await platform.downloadSpeechModel();
      await refreshModel();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [platform, refreshModel]);

  const removeModel = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setModel(await platform.deleteSpeechModel());
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [platform]);

  if (loading) {
    return (
      <div>
        <SectionHeader title="Audio" description="Voice input and voice output." />
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner size="sm" /> Loading…
        </div>
      </div>
    );
  }

  const engineLocked = Boolean(settings?.engineLockedByEnv);
  const downloading = model?.downloading === true;
  const pct = Math.round((model?.progress ?? 0) * 100);

  return (
    <div>
      <SectionHeader
        title="Audio"
        description="Speech-to-text for dictating into the composer, and text-to-speech for reading replies aloud. Everything runs on this machine — no cloud, no API key."
      />

      <div className="space-y-4">
        {/* ── Speech model ── */}
        <SettingsCard
          title="Speech recognition model"
          description="Nemotron 3.5 ASR from NVIDIA — 40 languages, punctuation and capitalization, and the only engine that streams words as you speak them."
        >
          {model?.present ? (
            <div className="space-y-3">
              <p className="flex items-center gap-2 text-sm text-success">
                <Mic className="h-4 w-4" /> Installed — {mb(model.bytesOnDisk)}
              </p>
              <p className="break-all text-xs text-muted-foreground">{model.dir}</p>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => void removeModel()}
                disabled={busy}
                leftIcon={<Trash2 className="h-3.5 w-3.5" />}
              >
                Remove model
              </Button>
              <p className="text-xs text-muted-foreground">
                Removing it frees {mb(model.bytesOnDisk)}. Dictation keeps working on the fallback
                engine, without streaming or the other 39 languages.
              </p>
            </div>
          ) : downloading ? (
            <div className="space-y-2">
              <p className="flex items-center gap-2 text-sm">
                <Spinner size="sm" /> Downloading… {pct}%
              </p>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                {mb(model?.bytesOnDisk ?? 0)} of about {mb(model?.approxTotalBytes ?? 0)}. You can
                leave this page; the download continues on the server.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="flex items-start gap-2 text-sm text-warning">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Not downloaded. Dictation still works, but it falls back to{' '}
                  <strong>Moonshine</strong> — English only, no live word-by-word streaming, and
                  less accurate on technical words.
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                About {mb(model?.approxTotalBytes ?? 0)}, fetched once from{' '}
                <span className="font-mono">{model?.repo}</span> and stored on this machine. It is
                never downloaded automatically, so nothing is fetched unless you press this button.
                If you would rather not, simply leave it — nothing else in the app is affected.
              </p>
              <Button
                type="button"
                size="sm"
                onClick={() => void startDownload()}
                disabled={busy}
                loading={busy}
                leftIcon={<Download className="h-3.5 w-3.5" />}
              >
                Download model
              </Button>
            </div>
          )}
          {model?.error && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {model.error}
            </p>
          )}
        </SettingsCard>

        {/* ── Microphone ── */}
        <SettingsCard
          title="Microphone"
          description="Which input dictation records from on this device. Stored here, not on the server — a headset plugged into this machine is not the one plugged into your phone."
        >
          <SettingRow
            label="Input device"
            description={
              mics.labelsVisible
                ? 'Following the system default means dictation moves with whatever you pick in the operating system.'
                : 'Device names are hidden until the microphone has been used once. Reveal them to choose a specific input.'
            }
            control={
              <Select
                value={micDeviceId}
                disabled={!mics.labelsVisible && mics.devices.length === 0}
                onChange={(v) =>
                  setMicDevice(v, mics.devices.find((d) => d.deviceId === v)?.label ?? '')
                }
                aria-label="Microphone input device"
                className="w-64"
                options={[
                  { value: SYSTEM_DEFAULT_MIC, label: 'System default' },
                  ...mics.devices.map((d, i) => ({
                    value: d.deviceId,
                    // An unnamed device is still selectable — it is a real
                    // input, we are simply not allowed to say which one yet.
                    label: d.label || `Microphone ${i + 1}`,
                  })),
                  // Keep a stored-but-absent device in the list so the picker
                  // shows what is actually configured instead of silently
                  // snapping back to "System default" and losing the choice.
                  ...(micMissing
                    ? [
                        {
                          value: micDeviceId,
                          label: `${micDeviceLabel || 'Saved microphone'} (not connected)`,
                          description: 'Recording falls back to the system default until it is plugged back in.',
                        },
                      ]
                    : []),
                ]}
              />
            }
          />
          {!mics.labelsVisible && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => void mics.requestLabels()}
              leftIcon={<Mic className="h-3.5 w-3.5" />}
            >
              Show device names
            </Button>
          )}
          {micMissing && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-warning">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {micDeviceLabel || 'The selected microphone'} is not connected right now. Dictation
              will use the system default until it is back.
            </p>
          )}
          {mics.error && (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {mics.error}
            </p>
          )}
        </SettingsCard>

        {/* ── Speech to text ── */}
        <SettingsCard title="Speech to text" description="How dictation behaves.">
          <SettingRow
            label="Engine"
            description={
              engineLocked
                ? `Pinned to "${settings?.engineLockedByEnv}" by GENERATORAI_STT_ENGINE in this server's environment.`
                : settings?.sttEngine === 'nemotron' && !model?.present
                  ? // Selected but unrunnable. The server degrades to Moonshine
                    // rather than failing, which is right — but a screen that
                    // shows "Nemotron" while Moonshine is doing the work is
                    // telling the user something untrue.
                    'Nemotron is selected, but its model is not downloaded — dictation is running on Moonshine until you download it above.'
                  : 'Automatic prefers Nemotron when its model is installed, and falls back to Moonshine, then Whisper.'
            }
            control={
              <Select
                value={settings?.sttEngine ?? 'auto'}
                disabled={busy || engineLocked}
                onChange={(v) => void save({ sttEngine: v })}
                aria-label="Speech recognition engine"
                className="w-64"
                options={(settings?.engines ?? ['auto']).map((id) => ({
                  value: id,
                  label: ENGINE_LABEL[id] ?? id,
                  // Nemotron cannot run until its weights are on disk. It used
                  // to be selectable anyway, and picking it simply made the
                  // mic button fail — with the control that fixes it sitting
                  // unread at the top of the same screen.
                  ...(id === 'nemotron' && !model?.present
                    ? {
                        disabled: true,
                        description: 'Download the model above to use this engine.',
                      }
                    : {}),
                }))}
              />
            }
          />

          <SettingRow
            label="Spoken punctuation"
            description={'The speech model only infers sentence punctuation and capitals from your voice. This pass handles what it cannot: spoken commands ("comma", "new line", "hash", "open bracket", "scratch that") become symbols, numbers are written as digits (47, 12,000, 10:30 AM, 2.3.1), and filler words are removed. Off means the raw transcript is inserted — "comma" stays the word "comma".'}
            control={
              <Select
                value={settings?.textFormatter ?? 'rule-based'}
                disabled={busy}
                onChange={(v) => void save({ textFormatter: v })}
                aria-label="Spoken punctuation handling"
                className="w-64"
                options={(settings?.formatters ?? ['rule-based', 'none']).map((id) => ({
                  value: id,
                  label: FORMATTER_LABEL[id] ?? id,
                }))}
              />
            }
          />

          <SettingRow
            label="Pause before committing"
            description="How long a silence ends a sentence and commits it to the composer. Shorter feels snappier; too short splits sentences mid-thought."
            control={
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step={50}
                  min={settings?.minEndpointMs ?? 200}
                  max={settings?.maxEndpointMs ?? 3000}
                  defaultValue={settings?.endpointSilenceMs ?? 800}
                  disabled={busy}
                  onBlur={(e) => {
                    const v = Number.parseInt(e.target.value, 10);
                    if (Number.isFinite(v) && v !== settings?.endpointSilenceMs) {
                      void save({ endpointSilenceMs: v });
                    }
                  }}
                  aria-label="Pause before committing, in milliseconds"
                  className="w-20 rounded-md border border-border bg-background px-2 py-1 text-sm"
                />
                <span className="text-xs text-muted-foreground">ms</span>
              </div>
            }
          />
        </SettingsCard>

        {/* ── Text to speech ── */}
        <SettingsCard title="Text to speech" description="Reading assistant replies aloud.">
          <ToggleSwitch
            checked={settings?.ttsEnabled !== false}
            onChange={(next) => void save({ ttsEnabled: next })}
            disabled={busy}
            label="Enable voice output"
            description="Adds the Read aloud action to assistant messages. Uses Kokoro, downloaded on first use (about 90MB)."
          />
          <SettingRow
            label="Voice"
            description="Kokoro voice name."
            control={
              <input
                type="text"
                defaultValue={settings?.ttsVoice ?? 'af_heart'}
                disabled={busy || settings?.ttsEnabled === false}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v && v !== settings?.ttsVoice) void save({ ttsVoice: v });
                }}
                aria-label="Text to speech voice"
                className="w-40 rounded-md border border-border bg-background px-2 py-1 text-sm"
              />
            }
          />
          <SettingRow
            label="Speed"
            description="0.5 to 2.0."
            control={
              <input
                type="number"
                step={0.1}
                min={0.5}
                max={2}
                defaultValue={settings?.ttsSpeed ?? 1}
                disabled={busy || settings?.ttsEnabled === false}
                onBlur={(e) => {
                  const v = Number.parseFloat(e.target.value);
                  if (Number.isFinite(v) && v !== settings?.ttsSpeed) void save({ ttsSpeed: v });
                }}
                aria-label="Text to speech speed"
                className="w-20 rounded-md border border-border bg-background px-2 py-1 text-sm"
              />
            }
          />
        </SettingsCard>

        {error && (
          <p className="flex items-start gap-1.5 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {error}
          </p>
        )}

        <p className="flex items-start gap-2 text-xs text-muted-foreground">
          <Volume2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Changes apply to the next dictation or playback session; no restart is needed.
        </p>
      </div>
    </div>
  );
}

export default AudioSection;
