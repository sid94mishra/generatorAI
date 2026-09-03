// @generatorai/core infrastructure exports

// W21 — Event-loop wedge detector (L6: monitor is outside the main loop)
export { WedgeDetector, LoopTurnProber } from './WedgeDetector.js';
export type { WedgeDetectorConfig, WedgeDiagnosticReport, LoopTurnProberConfig } from './WedgeDetector.js';

export { SandboxedScriptRunner } from './SandboxedScriptRunner.js';
export type { SandboxedScriptRunnerOptions } from './SandboxedScriptRunner.js';
export { GitManager } from './GitManager.js';
export type { GitManagerOptions, PullRequestResult } from './GitManager.js';

// Re-export the standalone git + change-set + source-control packages so app
// wiring can consume them via @generatorai/core without extra imports.
export { GitClient } from '@generatorai/git';
export type {
  IGitClient,
  GitClientOptions,
  GitTreeEntry,
  GitRef,
  GitNumstatEntry,
  GitNameStatusEntry,
} from '@generatorai/git';
export {
  CheckpointService,
  GitShadowRefStore,
  CHECKPOINT_REF_PREFIX,
  checkpointRefName,
  EMPTY_TREE_SHA,
} from '@generatorai/checkpoints';
export type {
  CheckpointServiceOptions,
  ICheckpointRepository,
  ISnapshotStore,
  SnapshotHandle,
} from '@generatorai/checkpoints';
export {
  ReviewThreadService,
  serializeReviewThreads,
  hashAnchor,
  resolveAnchor,
  mapLineThroughPatch,
  changedRangesFromPatch,
} from '@generatorai/review';
export type {
  IReviewRepository,
  ReviewContentReader,
  ReviewThread,
  ReviewComment,
  ReviewScope,
  ReviewSide,
  ReviewIntent,
  ReviewAuthor,
  ReviewThreadStatus,
  CreateReviewThreadParams,
  ListReviewThreadsFilters,
  ReviewSubmitTarget,
  SubmitReviewParams,
  SubmitReviewResult,
} from '@generatorai/review';
export { ChangeSetService, isMetadataPath, extractFileDiff } from '@generatorai/changes';
export {
  ChangeSummaryService,
  WorkspaceTreeService,
  discoverRepos,
  stripAliasPrefix,
  languageFor,
  MAX_FILE_BODY_BYTES,
  MAX_PATCH_BYTES,
  MAX_TREE_PATHS_PER_REPO,
} from '@generatorai/changes';
export type {
  ChangeSummary,
  ChangeSummaryRepo,
  ChangeSummaryFile,
  ChangeRevision,
  ChangeRevisionKind,
  ChangeRevisionSelector,
  GetChangeSummaryParams,
  ChangeFileVersions,
  ChangeFilePatch,
  CheckpointLookup,
  DiscoveredRepo,
  WorkspaceTree,
  WorkspaceTreeRepo,
  WorkspaceTreeFile,
} from '@generatorai/changes';
export type {
  ChangeSet,
  ChangeRepo,
  ChangeRepoKind,
  ChangedFile,
  ChangeStatus,
  GetChangeSetParams,
  WorktreeRef,
} from '@generatorai/changes';
export {
  GitHubProvider,
  SourceControlRegistry,
  ProviderNotConfiguredError,
  SourceControlError,
  parseRepoSlug,
} from '@generatorai/source-control';
export type {
  ISourceControlProvider,
  GitHubProviderOptions,
  ActiveProvider,
  PullRequest,
  PullRequestRef,
  PullRequestState,
  CreatePullRequestInput,
  ListPullRequestsInput,
  ChecksSummary,
  SourceControlConfig,
  SourceControlProviderId,
} from '@generatorai/source-control';
export { FetchHttpClient } from './FetchHttpClient.js';
export { DockerSandboxProvider } from './DockerSandboxProvider.js';
export { HostProcessSandboxProvider } from './HostProcessSandboxProvider.js';
export { SandboxScriptRunner } from './SandboxScriptRunner.js';

// Integrated Browser (v13)
export { ServerPlaywrightHost } from './browser/ServerPlaywrightHost.js';
export type { ServerPlaywrightHostOptions } from './browser/ServerPlaywrightHost.js';
export { ElectronBridgeAdapter } from './browser/ElectronBridgeAdapter.js';
export type { ElectronBridgeAdapterOptions } from './browser/ElectronBridgeAdapter.js';
export { INSPECTOR_SCRIPT } from './browser/InspectorScript.js';
// W15 — the single clamp for screencast fps/quality, and the codec negotiation
// both the gateway's WS endpoint and the bridge share.
export {
  SCREENCAST_LIMITS,
  clampScreencastOptions,
  negotiateScreencastCodec,
} from './browser/screencastOptions.js';
export type { ScreencastOptions } from './browser/screencastOptions.js';
export { ScreencastEncoder, SCREENCAST_VP8_CODEC } from './browser/ScreencastEncoder.js';
export type { ScreencastEncoderStream, EncodedScreencastChunk } from './browser/ScreencastEncoder.js';
export { readJpegSize } from './browser/jpegSize.js';

// Computer Use
export { NullComputerBridge } from './computer/NullComputerBridge.js';
export type { NullComputerBridgeOptions } from './computer/NullComputerBridge.js';
export { CuaDriverBridge } from './computer/CuaDriverBridge.js';
export type { CuaDriverBridgeOptions, CuaDriverEndpoint } from './computer/CuaDriverBridge.js';
export { transcodeScreenshot } from './computer/screenshotCodec.js';
export type { ScreenshotFormat, TranscodeRequest, TranscodeResult } from './computer/screenshotCodec.js';
export {
  parseListApps,
  parseListWindows,
  parseWindowState,
  UnrecognisedDriverPayloadError,
} from './computer/driverPayloads.js';
export type { ParsedWindowState } from './computer/driverPayloads.js';
export { PendingConsentStore } from './computer/PendingConsentStore.js';
export type {
  PendingConsentStoreOptions,
  IComputerGrantRepository,
} from './computer/PendingConsentStore.js';

// Integrated Terminal hosts
export { NodePtyHost, resolveDefaultShell } from './terminal/NodePtyHost.js';
export type { NodePtyHostOptions } from './terminal/NodePtyHost.js';
export { FallbackChildProcessHost } from './terminal/FallbackChildProcessHost.js';
export { SandboxPtyHost } from './terminal/SandboxPtyHost.js';

// Voice Module (Phase 0-4)
export { WhisperSttEngine } from './voice/WhisperSttEngine.js';
export { ParakeetSttEngine } from './voice/ParakeetSttEngine.js';
export { CascadingSttEngine } from './voice/CascadingSttEngine.js';
export { DisabledSttEngine } from './voice/DisabledSttEngine.js';
export { EnergyVad } from './voice/EnergyVad.js';
export { SileroVad, createSileroVadFactory } from './voice/SileroVad.js';
export type { SileroVadOptions } from './voice/SileroVad.js';
export type { VoiceActivityDetector } from './voice/VoiceActivityDetector.js';
export type { EnergyVadOptions } from './voice/EnergyVad.js';
export { RuleBasedTextFormatter, SPOKEN_SYMBOL_PHRASES } from './voice/RuleBasedTextFormatter.js';
export { LlmTextFormatter } from './voice/LlmTextFormatter.js';
export type { LlmTextFormatterConfig } from './voice/LlmTextFormatter.js';
export { SttSessionRunner } from './voice/SttSessionRunner.js';
export type { SttSessionCallbacks } from './voice/SttSessionRunner.js';
export { KokoroTtsEngine } from './voice/KokoroTtsEngine.js';
export { SentenceBoundaryBuffer } from './voice/SentenceBoundaryBuffer.js';
export { TtsSessionRunner } from './voice/TtsSessionRunner.js';
export { VoiceWorkerPool, sharedVoiceWorkerPool, disposeSharedVoiceWorkerPool } from './voice/VoiceWorkerPool.js';
export { MoonshineSttEngine } from './voice/MoonshineSttEngine.js';
export { NemotronSttEngine } from './voice/NemotronSttEngine.js';
export type { NemotronSttEngineOptions } from './voice/NemotronSttEngine.js';
export {
  createSttEngine,
  createTtsEngine,
  resolveSttEngineId,
  sttEngineDescriptor,
  STT_ENGINES,
  ALL_STT_ENGINE_IDS,
} from './voice/VoiceEngineFactory.js';
export type {
  SttEngineId,
  TtsEngineId,
  SttEngineDescriptor,
  SttEngineFactoryOptions,
  TtsEngineFactoryOptions,
} from './voice/VoiceEngineFactory.js';
export { subscribeAgentTokenStream } from './voice/AgentTokenStream.js';
export type { AgentTokenStreamHandle, AgentTokenStreamOptions } from './voice/AgentTokenStream.js';

// W12 — Agent Host process supervision
export { HostSupervisor } from './HostSupervisor.js';
export type { HostSupervisorOptions, HostEventHandler } from './HostSupervisor.js';
