// AUTO-GENERATED — do not edit. Run `pnpm generate:schemas` to update.
// Protocol:        opencode
// Source artifact: schemas/opencode/openapi.json@2.2.7
// Captured by:     packages/protocol/openapi.json at the anomalyco/opencode v2.2.7 tag (git show v2.2.7:packages/protocol/openapi.json; sha1 df8d38d2). Equivalently from a running server: OPENCODE_PASSWORD=<pw> opencode serve --stdio --port 0 (reads {"url"} from stdout), then curl -u opencode:<pw> <url>/openapi.json
// Artifact sha256: a2c9b373ac1e5bb0c8658cb4a9dc5db465e750c3c9e92a7234db65621a71bcd8
// Definitions:     497
//
// The sha256 above is of the upstream file itself. If the pinned dependency
// changes, this hash and the types below change with it, and CI's
// `git diff --exit-code` turns that into a failing build instead of a
// runtime decode error.

export type AbsolutePath = string;

export type Agent_Color = string;

export type Agent_ID = string;

export type Agent_Info = {
  id: Agent_ID;
  name: string;
  model?: Model_Ref;
  request: Provider_Request;
  system?: string;
  description?: string;
  mode: "subagent" | "primary" | "all";
  hidden: boolean;
  color?: Agent_Color;
  steps?: number;
  permissions: Permission_Ruleset;
};

export type AgentNotFoundErrorEncoded = {
  _tag: "AgentNotFoundError";
  agentID: string;
  message: string;
};

export type Artifact_Capability = "static" | "server-code" | "sqlite" | "durable-objects";

export type Artifact_Content = {
  info: Artifact_Info;
  files: Record<string, string>;
};

export type Artifact_CreateInput = {
  title: string;
  files: Record<string, string>;
  entry?: string;
  provider?: string;
  sessionID?: Session_ID;
};

export type Artifact_ID = string;

export type Artifact_Info = {
  id: Artifact_ID;
  provider: Artifact_ProviderIDEncoded;
  sessionID?: Session_ID;
  title: string;
  entry: string;
  url: string;
  time: Artifact_Time;
};

export type Artifact_Provider = {
  id: Artifact_ProviderIDEncoded;
  name: string;
  capabilities: Array<Artifact_Capability>;
  default: boolean;
};

export type Artifact_ProviderIDEncoded = string;

export type Artifact_Time = {
  created: number;
  updated: number;
};

export type Artifact_UpdateInput = {
  title?: string;
  files: Record<string, string>;
  entry?: string;
  sessionID?: Session_ID;
};

export type ArtifactNotFoundErrorEncoded = {
  _tag: "ArtifactNotFoundError";
  artifactID: string;
  message: string;
};

export type Command_Info = {
  name: string;
  description?: string;
};

export type CommandExecutionErrorEncoded = {
  _tag: "CommandExecutionError";
  command: string;
  message: string;
};

export type CommandNotFoundErrorEncoded = {
  _tag: "CommandNotFoundError";
  command: string;
  message: string;
};

export type Config_AgentEncoded = {
  model?: string | {
    providerID: string;
    model: string;
    variant?: string;
  };
  request?: {
    headers?: Record<string, string>;
    body?: Record<string, unknown>;
  };
  system?: string;
  description?: string;
  mode?: "subagent" | "primary" | "all";
  hidden?: boolean;
  color?: string;
  steps?: number;
  disabled?: boolean;
  permissions?: Permission_Ruleset;
};

export type Config_CommandEncoded = {
  template: string;
  description?: string;
  agent?: string;
  model?: string | {
    providerID: string;
    model: string;
    variant?: string;
  };
  subagent?: boolean;
  /** Deprecated alias for subagent. */
  subtask?: boolean;
};

export type Config_Compaction_Percent = string;

export type Config_DirectoryEncoded = {
  type: "directory";
  path: AbsolutePath;
};

export type Config_DocumentEncoded = {
  type: "document";
  path?: AbsolutePath;
  info: Config_InfoEncoded;
};

export type Config_Entry = Config_DocumentEncoded | Config_DirectoryEncoded;

export type Config_Formatter_EntryEncoded = {
  disabled?: boolean;
  command?: Array<string>;
  environment?: Record<string, string>;
  extensions?: Array<string>;
};

export type Config_InfoEncoded = {
  $schema?: string;
  shell?: string;
  model?: string | {
    providerID: string;
    model: string;
    variant?: string;
  };
  default_agent?: string;
  update?: "disable" | "notify" | "auto";
  share?: "manual" | "auto" | "disabled";
  enterprise?: {
    url?: string;
  };
  username?: string;
  timezone?: string;
  permissions?: Permission_Ruleset;
  policies?: Array<{
    action: "provider.use" | "tool.use" | "integration.connect" | "integration.use" | "mcp.use" | "skill.use" | "plugin.use" | "websearch.use";
    resource: string;
    effect: "allow" | "deny";
  }>;
  agents?: Record<string, Config_AgentEncoded>;
  snapshots?: boolean;
  watcher?: {
    ignore?: Array<string>;
  };
  formatter?: boolean | Record<string, Config_Formatter_EntryEncoded>;
  lsp?: boolean | (Record<string, {
    disabled: true;
  } | Config_LSP_ServerEncoded>);
  media?: {
    image?: {
      auto_resize?: boolean;
      max_width?: number;
      max_height?: number;
      max_base64_bytes?: number;
    };
  };
  tool_output?: {
    max_lines?: number;
    max_bytes?: number;
  };
  mcp?: {
    timeout?: {
      startup?: number;
      catalog?: number;
      execution?: number;
    };
    servers?: Record<string, Mcp_LocalConfigEncoded | Mcp_RemoteConfigEncoded>;
  };
  compaction?: {
    auto?: boolean;
    keep?: {
      tokens?: number;
    };
    buffer?: Config_Compaction_Percent | number;
  };
  skills?: Array<string>;
  commands?: Record<string, Config_CommandEncoded>;
  instructions?: Array<string>;
  references?: Record<string, string | Config_Reference_GitEncoded | Config_Reference_LocalEncoded>;
  websearch?: false | ConfigWebSearch_InfoEncoded;
  plugins?: Array<string | Config_Plugin_EntryEncoded>;
  worktree?: Config_Worktree;
  warming?: boolean | Config_WarmingEncoded;
  providers?: Record<string, Config_ProviderEncoded>;
  experimental?: {
    portable_shell_scanner?: boolean;
    all_flags?: boolean;
    todo?: boolean;
    background_compaction?: boolean;
    media_blob?: boolean;
    schedules?: boolean;
    artifacts?: boolean;
    codemode_vm?: boolean;
    console_watches?: boolean;
    part_rows?: boolean;
    image_generate?: boolean | ({
      model?: string | {
        providerID: string;
        model: string;
        variant?: string;
      };
    });
    subagent_depth?: number;
    location_idle_timeout?: string | false;
    policies?: Array<{
      action: "provider.use" | "tool.use" | "integration.connect" | "integration.use" | "mcp.use" | "skill.use" | "plugin.use" | "websearch.use";
      resource: string;
      effect: "allow" | "deny";
    }>;
  };
};

export type Config_LSP_ServerEncoded = {
  command: Array<string>;
  extensions?: Array<string>;
  disabled?: boolean;
  env?: Record<string, string>;
  initialization?: Record<string, unknown>;
};

export type Config_Model_Capabilities = {
  tools?: boolean;
  input?: Array<string>;
  output?: Array<string>;
  temperature?: boolean;
  reasoning?: Config_Model_Reasoning;
};

export type Config_Model_CostEncoded = {
  tier?: {
    type: "context";
    size: number;
  };
  input: Money_USDPerMillionTokens;
  output: Money_USDPerMillionTokens;
  cache?: {
    read?: Money_USDPerMillionTokens;
    write?: Money_USDPerMillionTokens;
  };
};

export type Config_Model_Reasoning = {
  supported: false;
} | {
  supported: true;
  toggle?: boolean;
  effort?: Array<string>;
  budget?: {
    min?: number;
    max?: number;
  };
};

export type Config_Model_Settings = {
  compaction?: Provider_Compaction;
  cache?: Provider_Cache;
  encoding?: Provider_Encoding;
} & (Record<string, unknown | null>);

export type Config_Model_VariantSettings = {
  compaction?: Provider_Compaction;
  encoding?: Provider_Encoding;
} & (Record<string, unknown | null>);

export type Config_ModelEncoded = {
  modelID?: string;
  type?: Model_Type;
  family?: string;
  name?: string;
  /** Release date as YYYY-MM-DD or YYYY-MM */
  releaseDate?: string;
  compatibility?: Model_Compatibility;
  package?: string;
  settings?: Config_Model_Settings;
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
  capabilities?: Config_Model_Capabilities;
  variants?: Array<{
    id: string;
    settings?: Config_Model_VariantSettings;
    headers?: Record<string, string>;
    body?: Record<string, unknown>;
  }>;
  cost?: Config_Model_CostEncoded | Array<Config_Model_CostEncoded>;
  disabled?: boolean;
  limit?: {
    context?: number;
    input?: number;
    output?: number;
  };
};

export type Config_Patch = {
  shell: string | null;
};

export type Config_Plugin_EntryEncoded = {
  package: string;
  options?: Record<string, unknown>;
};

export type Config_Provider_Settings = {
  timeout?: number | false;
  headerTimeout?: number | false;
  chunkTimeout?: number | false;
  compaction?: Provider_Compaction;
  cache?: Provider_Cache;
  transport?: Provider_Transport;
  encoding?: Provider_Encoding;
} & (Record<string, unknown | null>);

export type Config_ProviderEncoded = {
  canonical?: Provider_ID;
  name?: string;
  env?: Array<string>;
  package?: string;
  compatibility?: Provider_Compatibility;
  settings?: Config_Provider_Settings;
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
  models?: Record<string, Config_ModelEncoded>;
};

export type Config_Reference_GitEncoded = {
  repository: string;
  branch?: string;
  description?: string;
  hidden?: boolean;
};

export type Config_Reference_LocalEncoded = {
  path: string;
  description?: string;
  hidden?: boolean;
};

export type Config_WarmingEncoded = {
  prompt?: string;
  interval?: "auto" | string;
  duration?: string;
};

export type Config_Worktree = {
  directory: string;
};

export type ConfigShell_Option = {
  path: string;
  name: string;
  acceptable: boolean;
};

export type ConfigWebSearch_InfoEncoded = {
  provider: "random" | WebSearch_ID;
};

export type ConflictErrorEncoded = {
  _tag: "ConflictError";
  message: string;
  resource?: string | null;
};

export type Connection_CredentialInfo = {
  type: "credential";
  id: Credential_ID;
  label: string;
  method: "key" | "oauth" | "external";
  status?: Connection_Status;
};

export type Connection_EnvInfo = {
  type: "env";
  name: string;
  status?: Connection_Status;
};

export type Connection_Info = Connection_CredentialInfo | Connection_EnvInfo;

export type Connection_Status = {
  status: "needs_auth";
  message: string;
  url?: string;
};

export type Credential_CreateInput = {
  id?: Credential_ID;
  integrationID: Integration_ID;
  label?: string;
  value: Credential_Value;
  activate?: boolean;
};

export type Credential_Entry = {
  id: Credential_ID;
  integrationID: Integration_ID;
  label: string;
  active: boolean;
  value: Credential_Value;
};

export type Credential_External = {
  type: "external";
  methodID: Integration_MethodID;
  metadata?: Record<string, unknown>;
};

export type Credential_ID = string;

export type Credential_Key = {
  type: "key";
  key: string;
  metadata?: Record<string, unknown>;
};

export type Credential_OAuth = {
  type: "oauth";
  methodID: Integration_MethodID;
  refresh: string;
  access: string;
  expires: number;
  metadata?: Record<string, unknown>;
};

export type Credential_Value = Credential_OAuth | Credential_Key | Credential_External;

export type Event_ID = string;

export type Event_Seq = number;

export type Event_VersionEncoded_c3ea984aceae = 2;

export type Event_VersionEncoded_c77c5abcb68d = 1;

/** Marker emitted once when a log read reaches its captured watermark. The reader holds every event committed at or below seq. */
export type EventLog_Synced = {
  type: "log.synced";
  aggregateID: string;
  seq?: Event_Seq;
};

export type FileDiff_Info = {
  file: string;
  patch: string;
  additions: number;
  deletions: number;
  status: "added" | "deleted" | "modified";
  more?: true;
};

export type FileNotFoundErrorEncoded = {
  _tag: "FileNotFoundError";
  path: string;
  message: string;
};

export type FileSystem_Entry = {
  path: RelativePath;
  type: "file" | "directory";
};

export type FileSystem_Write = {
  path: AbsolutePath;
};

export type ForbiddenErrorEncoded = {
  _tag: "ForbiddenError";
  message: string;
};

export type Form_Answer = Record<string, Form_Value>;

export type Form_Answer_1 = Record<string, Form_Value_1>;

export type Form_BooleanField = {
  key: string;
  title?: string;
  description?: string;
  required?: boolean;
  hidden?: boolean;
  when?: Array<Form_When>;
  type: "boolean";
  default?: boolean;
};

export type Form_BooleanField_1 = {
  key: string;
  title?: string;
  description?: string;
  required?: boolean;
  hidden?: boolean;
  when?: Array<Form_When_1>;
  type: "boolean";
  default?: boolean;
};

export type Form_CreatePayload = {
  id?: Form_ID | null;
  title: string;
  metadata?: Form_Metadata;
  fields: Form_Fields;
};

export type Form_Detail = {
  id: Form_ID;
  sessionID: string;
  title: string;
  metadata?: Form_Metadata;
  fields: Form_Fields;
  state: Form_State;
};

export type Form_ExternalField = {
  key: string;
  type: "external";
  url: string;
  title?: string;
  description?: string;
};

export type Form_Field = Form_StringField | Form_NumberField | Form_IntegerField | Form_BooleanField | Form_MultiselectField | Form_ExternalField;

export type Form_Field_1 = Form_StringField_1 | Form_NumberField_1 | Form_IntegerField_1 | Form_BooleanField_1 | Form_MultiselectField_1 | Form_ExternalField;

export type Form_Fields = Array<Form_Field>;

export type Form_Fields_1 = Array<Form_Field_1>;

export type Form_ID = string;

export type Form_Info = {
  id: Form_ID;
  sessionID: string;
  title: string;
  metadata?: Form_Metadata;
  fields: Form_Fields;
};

export type Form_Info_1 = {
  id: Form_ID;
  sessionID: string;
  title: string;
  metadata?: Form_Metadata;
  fields: Form_Fields_1;
};

export type Form_IntegerField = {
  key: string;
  title?: string;
  description?: string;
  required?: boolean;
  hidden?: boolean;
  when?: Array<Form_When>;
  type: "integer";
  minimum?: number | ("Infinity" | "-Infinity" | "NaN");
  maximum?: number | ("Infinity" | "-Infinity" | "NaN");
  default?: number | ("Infinity" | "-Infinity" | "NaN");
};

export type Form_IntegerField_1 = {
  key: string;
  title?: string;
  description?: string;
  required?: boolean;
  hidden?: boolean;
  when?: Array<Form_When_1>;
  type: "integer";
  minimum?: number | ("NaN" | "Infinity" | "-Infinity");
  maximum?: number | ("NaN" | "Infinity" | "-Infinity");
  default?: number | ("NaN" | "Infinity" | "-Infinity");
};

export type Form_Metadata = Record<string, unknown>;

export type Form_MultiselectField = {
  key: string;
  title?: string;
  description?: string;
  required?: boolean;
  hidden?: boolean;
  when?: Array<Form_When>;
  type: "multiselect";
  options: Array<Form_Option>;
  minItems?: number;
  maxItems?: number;
  custom?: boolean;
  default?: Array<string>;
};

export type Form_MultiselectField_1 = {
  key: string;
  title?: string;
  description?: string;
  required?: boolean;
  hidden?: boolean;
  when?: Array<Form_When_1>;
  type: "multiselect";
  options: Array<Form_Option>;
  minItems?: number;
  maxItems?: number;
  custom?: boolean;
  default?: Array<string>;
};

export type Form_NumberField = {
  key: string;
  title?: string;
  description?: string;
  required?: boolean;
  hidden?: boolean;
  when?: Array<Form_When>;
  type: "number";
  minimum?: number | ("Infinity" | "-Infinity" | "NaN");
  maximum?: number | ("Infinity" | "-Infinity" | "NaN");
  default?: number | ("Infinity" | "-Infinity" | "NaN");
};

export type Form_NumberField_1 = {
  key: string;
  title?: string;
  description?: string;
  required?: boolean;
  hidden?: boolean;
  when?: Array<Form_When_1>;
  type: "number";
  minimum?: number | ("NaN" | "Infinity" | "-Infinity");
  maximum?: number | ("NaN" | "Infinity" | "-Infinity");
  default?: number | ("NaN" | "Infinity" | "-Infinity");
};

export type Form_Option = {
  value: string;
  label: string;
  description?: string;
};

export type Form_Reply = {
  answer: Form_Answer;
};

export type Form_State = {
  status: "pending";
} | {
  status: "answered";
  answer: Form_Answer;
} | {
  status: "cancelled";
  message?: string;
};

export type Form_StringField = {
  key: string;
  title?: string;
  description?: string;
  required?: boolean;
  hidden?: boolean;
  when?: Array<Form_When>;
  type: "string";
  format?: "email" | "uri" | "date" | "date-time";
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  placeholder?: string;
  default?: string;
  options?: Array<Form_Option>;
  custom?: boolean;
};

export type Form_StringField_1 = {
  key: string;
  title?: string;
  description?: string;
  required?: boolean;
  hidden?: boolean;
  when?: Array<Form_When_1>;
  type: "string";
  format?: "email" | "uri" | "date" | "date-time";
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  placeholder?: string;
  default?: string;
  options?: Array<Form_Option>;
  custom?: boolean;
};

export type Form_Value = string | number | ("Infinity" | "-Infinity" | "NaN") | boolean | Array<string>;

export type Form_Value_1 = string | number | ("NaN" | "Infinity" | "-Infinity") | boolean | Array<string>;

export type Form_When = {
  key: string;
  op: "eq" | "neq";
  value: string | number | ("Infinity" | "-Infinity" | "NaN") | boolean;
};

export type Form_When_1 = {
  key: string;
  op: "eq" | "neq";
  value: string | number | ("NaN" | "Infinity" | "-Infinity") | boolean;
};

export type FormAlreadySettledErrorEncoded = {
  _tag: "FormAlreadySettledError";
  id: string;
  message: string;
};

export type FormInvalidAnswerErrorEncoded = {
  _tag: "FormInvalidAnswerError";
  id: string;
  message: string;
};

export type FormNotFoundErrorEncoded = {
  _tag: "FormNotFoundError";
  id: string;
  message: string;
};

export type Generate_ChoiceAnswer = {
  type: "choice";
  name: string;
  choice: Generate_ChoiceValue;
  probabilities: Array<{
    value: Generate_ChoiceValue;
    probability: number;
  }>;
  confidence: number;
};

/** Pick one value from a fixed set */
export type Generate_ChoiceQuestion = {
  type: "choice";
  /** Unique within the request; echoed on the matching answer */
  name: string;
  instructions: string;
  choices: Array<{
    value: Generate_ChoiceValue;
    description?: string;
  }>;
};

/** Choice values are typed: true and "true" are different values */
export type Generate_ChoiceValue = string | boolean;

export type Generate_DecisionAnswer = Generate_PredicateAnswer | Generate_ChoiceAnswer | Generate_ScoreAnswer | Generate_ErrorAnswer;

export type Generate_DecisionFilePart = {
  type: "file";
  data: Prompt_Base64;
  mime: string;
  name?: string;
};

export type Generate_DecisionJsonPart = {
  type: "json";
  value: unknown;
};

export type Generate_DecisionPart = Generate_DecisionTextPart | Generate_DecisionJsonPart | Generate_DecisionFilePart;

export type Generate_DecisionQuestion = Generate_PredicateQuestion | Generate_ChoiceQuestion | Generate_ScoreQuestion;

export type Generate_DecisionRequest = {
  model: Model_Ref;
  /** The evidence every question is asked about, in order */
  input: Array<Generate_DecisionPart>;
  /** Question names must be unique; duplicates fail with InvalidRequestError */
  questions: Array<Generate_DecisionQuestion>;
};

export type Generate_DecisionResult = {
  /** One answer per question, in question order */
  answers: Array<Generate_DecisionAnswer>;
  cost?: Money_USD;
  tokens?: Generate_Usage;
  native?: Generate_Native;
};

export type Generate_DecisionTextPart = {
  type: "text";
  text: string;
};

/** This one question has no answer; the other answers still came back */
export type Generate_ErrorAnswer = {
  type: "error";
  name: string;
  /** Why the question has no answer, for example refusal */
  reason: string;
  message?: string;
};

export type Generate_File = {
  data: Prompt_Base64;
  mime: string;
  name?: string;
};

/** Aspect ratio as width:height, for example 16:9 */
export type Generate_ImageAspect = string;

export type Generate_ImageOutput = {
  type: "image";
  data: Prompt_Base64;
  mime: string;
  name?: string;
};

export type Generate_ImageRequest = {
  model: Model_Ref;
  prompt: string;
  images?: Array<Generate_File>;
  n?: number;
  aspect?: Generate_ImageAspect;
  resolution?: Generate_ImageResolution;
};

/** Size tier such as 1K, 2K or 4K; 1K is about as many pixels as 1024x1024 at the requested aspect */
export type Generate_ImageResolution = ("1K" | "2K" | "4K") | string;

export type Generate_ImageResult = {
  images: Array<Generate_ImageOutput>;
  cost?: Money_USD;
  tokens?: Generate_Usage;
  native?: Generate_Native;
};

/** Provider-specific data the shared fields do not cover */
export type Generate_Native = Record<string, unknown>;

export type Generate_PredicateAnswer = {
  type: "predicate";
  name: string;
  probability: number;
};

/** The probability that a statement is true */
export type Generate_PredicateQuestion = {
  type: "predicate";
  /** Unique within the request; echoed on the matching answer */
  name: string;
  instructions: string;
  criteria?: {
    true?: string;
    false?: string;
  };
};

export type Generate_ScoreAnswer = {
  type: "score";
  name: string;
  /** Probability-weighted level index, so it can fall between levels */
  score: number;
  probabilities: Array<{
    value: number;
    label: string;
    probability: number;
  }>;
  confidence: number;
};

/** Place the input on ordered levels, lowest first */
export type Generate_ScoreQuestion = {
  type: "score";
  /** Unique within the request; echoed on the matching answer */
  name: string;
  instructions: string;
  levels: Array<{
    label: string;
    description?: string;
  }>;
};

/** Token counts, when the provider reports them */
export type Generate_Usage = {
  input?: number;
  output?: number;
};

export type GenerateDecisionsResponse = {
  data: Generate_DecisionResult;
};

export type GenerateImageResponse = {
  data: Generate_ImageResult;
};

export type GenerateTextResponse = {
  data: {
    text: string;
  };
};

export type Instruction_Hash = string;

export type Instruction_Key = string;

export type InstructionEntry_Info = {
  key: InstructionEntry_Key;
  /** JSON value attached to the session's instructions */
  value: unknown;
};

/** Instruction entry key (lowercase alphanumerics plus . _ -) */
export type InstructionEntry_Key = string;

export type InstructionEntry_Snapshot = Array<{
  key: InstructionEntry_Key;
  /** JSON value attached to the session's instructions */
  value: unknown;
  removed: boolean;
}>;

export type InstructionEntryValueTooLargeErrorEncoded = {
  _tag: "InstructionEntryValueTooLargeError";
  actualBytes: number;
  maxBytes: number;
  message: string;
};

export type Integration_AttemptEncoded = {
  attemptID: Integration_AttemptID;
  url: string;
  instructions: string;
  mode: "auto" | "code";
  paste?: true;
  time: {
    created: number | ("Infinity" | "-Infinity" | "NaN");
    expires: number | ("Infinity" | "-Infinity" | "NaN");
  };
};

export type Integration_AttemptID = string;

export type Integration_AttemptStatus = ({
  status: "pending";
  time: {
    created: number | ("Infinity" | "-Infinity" | "NaN");
    expires: number | ("Infinity" | "-Infinity" | "NaN");
  };
}) | ({
  status: "complete";
  time: {
    created: number | ("Infinity" | "-Infinity" | "NaN");
    expires: number | ("Infinity" | "-Infinity" | "NaN");
  };
}) | ({
  status: "failed";
  message: string;
  time: {
    created: number | ("Infinity" | "-Infinity" | "NaN");
    expires: number | ("Infinity" | "-Infinity" | "NaN");
  };
}) | ({
  status: "expired";
  time: {
    created: number | ("Infinity" | "-Infinity" | "NaN");
    expires: number | ("Infinity" | "-Infinity" | "NaN");
  };
});

export type Integration_CommandAttempt = {
  attemptID: Integration_AttemptID;
  time: {
    created: number | ("Infinity" | "-Infinity" | "NaN");
    expires: number | ("Infinity" | "-Infinity" | "NaN");
  };
};

export type Integration_CommandAttemptStatus = ({
  status: "pending";
  message?: string;
  time: {
    created: number | ("Infinity" | "-Infinity" | "NaN");
    expires: number | ("Infinity" | "-Infinity" | "NaN");
  };
}) | ({
  status: "complete";
  time: {
    created: number | ("Infinity" | "-Infinity" | "NaN");
    expires: number | ("Infinity" | "-Infinity" | "NaN");
  };
}) | ({
  status: "failed";
  message: string;
  time: {
    created: number | ("Infinity" | "-Infinity" | "NaN");
    expires: number | ("Infinity" | "-Infinity" | "NaN");
  };
}) | ({
  status: "expired";
  time: {
    created: number | ("Infinity" | "-Infinity" | "NaN");
    expires: number | ("Infinity" | "-Infinity" | "NaN");
  };
});

export type Integration_CommandMethod = {
  id: Integration_MethodID;
  type: "command";
  label: string;
  command: Array<string>;
};

export type Integration_EnvMethod = {
  type: "env";
  names: Array<string>;
};

export type Integration_ExternalMethod = {
  id: Integration_MethodID;
  type: "external";
  label: string;
  form?: Form_Fields;
};

export type Integration_ID = string;

export type Integration_Info = {
  id: Integration_ID;
  name: string;
  metadata?: Record<string, unknown>;
  methods: Array<Integration_Method>;
  connections: Array<Connection_Info>;
};

export type Integration_KeyMethod = {
  type: "key";
  label?: string;
  form?: Form_Fields;
};

export type Integration_Method = Integration_OAuthMethod | Integration_CommandMethod | Integration_KeyMethod | Integration_ExternalMethod | Integration_EnvMethod;

export type Integration_MethodID = string;

export type Integration_OAuthMethod = {
  id: Integration_MethodID;
  type: "oauth";
  label: string;
  form?: Form_Fields;
};

export type IntegrationAttemptNotFoundErrorEncoded = {
  _tag: "IntegrationAttemptNotFoundError";
  integrationID: string;
  attemptID: string;
  message: string;
};

export type IntegrationMethodNotFoundErrorEncoded = {
  _tag: "IntegrationMethodNotFoundError";
  integrationID: string;
  methodID: string;
  message: string;
};

export type IntegrationNotFoundErrorEncoded = {
  _tag: "IntegrationNotFoundError";
  integrationID: string;
  message: string;
};

export type InvalidCursorErrorEncoded = {
  _tag: "InvalidCursorError";
  message: string;
};

export type InvalidRequestErrorEncoded = {
  _tag: "InvalidRequestError";
  message: string;
  kind?: string | null;
  field?: string | null;
};

export type Job_Image = {
  kind: "image";
  id: string;
  sessionID: Session_ID;
  status: Job_Status;
  title?: string;
  time: Job_Time;
  path: string;
  model: string;
};

export type Job_Info = Job_Shell | Job_Subagent | Job_Image;

export type Job_Kind = "shell" | "subagent" | "image";

export type Job_Shell = {
  kind: "shell";
  id: string;
  sessionID: Session_ID;
  status: Job_Status;
  title?: string;
  time: Job_Time;
  shellID: string;
  command: string;
};

export type Job_Status = "running" | "completed" | "error" | "cancelled";

export type Job_Subagent = {
  kind: "subagent";
  id: string;
  sessionID: Session_ID;
  status: Job_Status;
  title?: string;
  time: Job_Time;
  childSessionID: Session_ID;
  agent: string;
  description: string;
};

export type Job_Time = {
  /** Start time in milliseconds since the Unix epoch */
  started: number;
  completed?: number;
};

export type Location_PublicInfo = {
  directory: AbsolutePath;
  project: {
    id: Project_ID;
    directory: AbsolutePath;
    canonical: AbsolutePath;
  };
};

export type Location_PublicRef = {
  directory: AbsolutePath;
};

export type Location_Ref = {
  directory: AbsolutePath;
  workspaceID?: Workspace_ID;
};

export type LocationNotFoundErrorEncoded = {
  _tag: "LocationNotFoundError";
  location: Location_PublicRef;
  message: string;
};

export type Mcp_LocalConfigEncoded = {
  type: "local";
  command: Array<string>;
  cwd?: string;
  environment?: Record<string, string>;
  disabled?: boolean;
  codemode?: boolean;
  timeout?: {
    startup?: number;
    catalog?: number;
    execution?: number;
  };
  protocol?: Mcp_Protocol;
  pool?: boolean;
};

export type Mcp_OAuthConfigEncoded = {
  client_id?: string;
  client_secret?: string;
  scope?: string;
  callback_port?: number;
  redirect_uri?: string;
  auth_server_metadata_url?: string;
};

/** MCP protocol negotiation. "legacy" (default) opens with the initialize handshake and speaks protocol revisions up to 2025-11-25. "auto" probes for the 2026-07-28 revision and falls back to legacy when the server does not support it. "2026-07-28" requires that revision and fails otherwise. */
export type Mcp_Protocol = "legacy" | "auto" | "2026-07-28";

export type Mcp_RemoteConfigEncoded = {
  type: "remote";
  url: string;
  headers?: Record<string, string>;
  oauth?: Mcp_OAuthConfigEncoded | false;
  disabled?: boolean;
  codemode?: boolean;
  timeout?: {
    startup?: number;
    catalog?: number;
    execution?: number;
  };
  protocol?: Mcp_Protocol;
  pool?: boolean;
};

export type Mcp_Resource = {
  server: string;
  name: string;
  uri: string;
  description?: string;
  mimeType?: string;
};

export type Mcp_ResourceCatalog = {
  resources: Array<Mcp_Resource>;
  templates: Array<Mcp_ResourceTemplate>;
};

export type Mcp_ResourceTemplate = {
  server: string;
  name: string;
  uriTemplate: string;
  description?: string;
  mimeType?: string;
};

export type Mcp_Server = {
  name: string;
  status: Mcp_Status_Connected | Mcp_Status_Pending | Mcp_Status_Disabled | Mcp_Status_Failed | Mcp_Status_NeedsAuth;
  title?: string;
  integrationID?: Integration_ID;
};

export type Mcp_Status_Connected = {
  status: "connected";
};

export type Mcp_Status_Disabled = {
  status: "disabled";
};

export type Mcp_Status_Failed = {
  status: "failed";
  error: string;
};

export type Mcp_Status_NeedsAuth = {
  status: "needs_auth";
  error: string;
};

export type Mcp_Status_Pending = {
  status: "pending";
};

export type McpServerNotFoundErrorEncoded = {
  _tag: "McpServerNotFoundError";
  server: string;
  message: string;
};

export type MediaHash = string;

export type MessageNotFoundErrorEncoded = {
  _tag: "MessageNotFoundError";
  sessionID: string;
  messageID: string;
  message: string;
};

export type Model_CacheFormat = "anthropic" | "alibaba";

export type Model_Capabilities = {
  tools: boolean;
  input: Array<string>;
  output: Array<string>;
  temperature?: boolean;
};

export type Model_Compatibility = {
  reasoningField?: Model_ReasoningField;
  requireReasoning?: boolean;
  maxTokensField?: Model_MaxTokensField;
  requireFinishReason?: boolean;
  requireAssistantAfterTool?: boolean;
  supportsPromptCacheKey?: boolean;
  streamUsage?: boolean;
  cacheFormat?: Model_CacheFormat;
  supportsThinkingBlockBinding?: boolean;
  supportsEffortUpdates?: boolean;
  mediaInput?: Model_MediaInput;
};

export type Model_Cost = {
  tier?: {
    type: "context";
    size: number;
  };
  input: Money_USDPerMillionTokens;
  output: Money_USDPerMillionTokens;
  cache: {
    read: Money_USDPerMillionTokens;
    write: Money_USDPerMillionTokens;
  };
};

export type Model_Info = {
  id: string;
  modelID: string;
  providerID: Provider_ID;
  canonical?: Provider_ID;
  type?: Model_Type;
  family?: string;
  name: string;
  compatibility?: Model_Compatibility;
  package?: string;
  settings?: Model_Settings;
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
  capabilities: Model_Capabilities;
  variants: Array<Model_Variant>;
  time: {
    released: number;
  };
  cost: Array<Model_Cost>;
  status: "alpha" | "beta" | "deprecated" | "active";
  enabled: boolean;
  limit: {
    context: number;
    input?: number;
    output: number;
  };
};

export type Model_MaxTokensField = "max_completion_tokens" | "max_tokens";

export type Model_MediaInput = "assets" | "state" | "root";

export type Model_ReasoningField = ("reasoning" | "reasoning_content" | "reasoning_text") | string;

export type Model_Ref = {
  id: string;
  providerID: Provider_ID;
  variant?: string;
};

export type Model_Settings = {
  compaction?: Provider_Compaction;
  cache?: Provider_Cache;
  encoding?: Provider_Encoding;
} & Record<string, unknown>;

export type Model_Type = ("chat" | "decision" | "image") | string;

export type Model_Variant = {
  id: string;
  settings?: Model_VariantSettings;
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
};

export type Model_VariantSettings = {
  compaction?: Provider_Compaction;
  encoding?: Provider_Encoding;
} & Record<string, unknown>;

export type ModelNotFoundErrorEncoded = {
  _tag: "ModelNotFoundError";
  providerID: string;
  modelID: string;
  message: string;
};

export type Money_USD = number;

export type Money_USDPerMillionTokens = number;

export type PairingCode = {
  code: string;
  expires_in: number;
};

export type PairingSession = {
  token: string;
};

export type Permission_Effect = "allow" | "deny" | "ask";

export type Permission_ID = string;

export type Permission_Reply = "once" | "always" | "reject";

export type Permission_Request = {
  id: Permission_ID;
  sessionID: Session_ID;
  action: string;
  resources: Array<string>;
  save?: Array<string>;
  metadata?: Record<string, unknown>;
  source?: Permission_Source;
  message?: string;
};

export type Permission_Rule = {
  action: string;
  resource: string;
  effect: Permission_Effect;
};

export type Permission_Ruleset = Array<Permission_Rule>;

export type Permission_Source = {
  type: "tool";
  messageID: string;
  id: string;
};

export type PermissionNotFoundErrorEncoded = {
  _tag: "PermissionNotFoundError";
  requestID: string;
  message: string;
};

export type PermissionSaved_ID = string;

export type PermissionSaved_Info = {
  id: PermissionSaved_ID;
  projectID: Project_ID;
  action: string;
  resource: string;
  time: {
    created: number;
    updated: number;
  };
};

export type PermissionSavedNotFoundErrorEncoded = {
  _tag: "PermissionSavedNotFoundError";
  id: string;
  message: string;
};

export type PersistentPty_CreateInput = {
  command?: string;
  args: Array<string>;
  cwd?: string;
  title: string;
  env: Record<string, string>;
  size?: {
    cols: number;
    rows: number;
  };
};

export type PersistentPty_Handoff = {
  directory: string;
  instanceID: string;
  ticket: string;
  expiresAt: number | ("Infinity" | "-Infinity" | "NaN");
};

export type PersistentPty_Info = {
  id: Pty_ID;
  title: string;
  command: string;
  args: Array<string>;
  cwd: string;
  status: "running" | "exited";
  pid: number;
  exitCode?: number;
  sessionID: Session_ID;
  userTitle: string | null;
  foregroundProcess: string | null;
  size: {
    cols: number;
    rows: number;
  };
  output: {
    head: number;
    tail: number;
  };
};

export type PersistentPty_ReadResult = {
  ptyID: Pty_ID;
  title: string;
  cwd: string;
  foregroundProcess: string | null;
  screen: {
    text: string;
    cols: number;
    rows: number;
    cursor: {
      x: number;
      y: number;
    };
  };
};

export type PersistentPty_Snapshot = {
  info: PersistentPty_Info;
  text: string;
  checkpoint: string;
  cursor: {
    x: number;
    y: number;
  };
};

export type PersistentPty_UpdateInput = {
  attachmentID?: string;
  size?: {
    cols: number;
    rows: number;
  };
  title?: string | null;
};

export type Plugin_Features = {
  server?: true;
  tui?: true;
  rpc?: true;
  gui?: true;
};

export type Plugin_GuiBundle = {
  code: string;
  revision: string;
  options: Record<string, unknown>;
};

export type Plugin_ID = string;

export type Plugin_Info = {
  id?: Plugin_ID;
  source: Plugin_Source;
  features: Plugin_Features;
  state: Plugin_State;
};

export type Plugin_Source = {
  type: "builtin";
} | {
  type: "package";
  target: string;
  version?: string;
  outdated?: true;
  updating?: true;
} | {
  type: "local";
  path: string;
} | {
  type: "sdk";
};

export type Plugin_State = {
  status: "active";
} | {
  status: "failed";
  error: string;
  ref?: string;
};

export type PluginNotFoundErrorEncoded = {
  _tag: "PluginNotFoundError";
  pluginID: string;
  message: string;
};

export type Project = {
  id: Project_ID;
  canonical: AbsolutePath;
  vcs?: Project_Vcs;
  name?: string;
  icon?: Project_Icon;
  commands?: Project_Commands;
  time: Project_Time;
  sandboxes: Array<string>;
};

export type Project_Commands = {
  /** Startup script to run when creating a new workspace (worktree) */
  start?: string;
};

export type Project_ID = string;

export type Project_Icon = {
  url?: string;
  override?: string;
  color?: string;
};

export type Project_Time = {
  created: number;
  updated: number;
  active: number;
  archived?: number;
};

export type Project_Vcs = string;

export type ProjectNotFoundErrorEncoded = {
  _tag: "ProjectNotFoundError";
  projectID: string;
  message: string;
};

export type Prompt_AgentAttachment = {
  name: string;
  mention?: Prompt_Mention;
};

export type Prompt_Base64 = string;

export type Prompt_FileAttachment = {
  data: Prompt_Base64;
  mime: string;
  source: Prompt_FileSource;
  name?: string;
  description?: string;
  mention?: Prompt_Mention;
};

export type Prompt_FileSource = {
  type: "inline";
} | {
  type: "uri";
  uri: string;
};

export type Prompt_Mention = {
  start: number;
  end: number;
  text: string;
};

export type Prompt_SkillAttachment = {
  id: Skill_ID;
  name: Skill_Name;
  text?: string;
  mention?: Prompt_Mention;
};

export type PromptInput_FileAttachment = {
  uri: string;
  source?: Prompt_FileSource;
  name?: string;
  description?: string;
  mention?: Prompt_Mention;
};

export type PromptInput_SkillAttachment = {
  id: Skill_ID;
  mention?: Prompt_Mention;
};

export type Provider_Cache = {
  ttl?: Provider_CacheTTL;
  warming?: Provider_CacheWarming;
};

export type Provider_CacheTTL = string;

export type Provider_CacheWarming = boolean | ({
  interval?: "auto" | string;
  duration?: string;
});

export type Provider_Compaction = {
  type: "summary";
} | {
  type: "native";
};

export type Provider_Compatibility = {
  reasoningField?: Model_ReasoningField;
  requireReasoning?: boolean;
  maxTokensField?: Model_MaxTokensField;
  requireFinishReason?: boolean;
  requireAssistantAfterTool?: boolean;
  supportsPromptCacheKey?: boolean;
  streamUsage?: boolean;
  cacheFormat?: Model_CacheFormat;
  mediaInput?: Model_MediaInput;
};

export type Provider_Encoding = "zstd" | "gzip" | "none";

export type Provider_ID = string;

export type Provider_Info = {
  id: Provider_ID;
  canonical?: Provider_ID;
  integrationID?: Integration_ID;
  name: string;
  activation: "auto" | "enabled" | "disabled";
  package: string;
  compatibility?: Provider_Compatibility;
  settings?: Provider_Settings;
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
};

export type Provider_Request = {
  settings: Provider_Settings;
  headers: Record<string, string>;
  body: Record<string, unknown>;
};

export type Provider_Settings = {
  timeout?: number | false;
  headerTimeout?: number | false;
  chunkTimeout?: number | false;
  compaction?: Provider_Compaction;
  cache?: Provider_Cache;
  transport?: Provider_Transport;
  encoding?: Provider_Encoding;
} & Record<string, unknown>;

export type Provider_Transport = "http" | "websocket";

export type ProviderNotFoundErrorEncoded = {
  _tag: "ProviderNotFoundError";
  providerID: string;
  message: string;
};

export type ProviderRequestErrorEncoded = {
  _tag: "ProviderRequestError";
  providerID: string;
  reason: "authentication" | "rate_limit" | "content_filter" | "invalid_request" | "overloaded" | "provider";
  message: string;
  status?: number | null;
  retryAfterMs?: number | null;
};

export type Pty = {
  id: Pty_ID;
  title: string;
  command: string;
  args: Array<string>;
  cwd: string;
  status: "running" | "exited";
  pid: number;
  exitCode?: number;
};

export type Pty_ID = string;

export type PtyFeatureUnsupportedErrorEncoded = {
  _tag: "PtyFeatureUnsupportedError";
  feature: string;
  message: string;
};

export type PtyNotFoundErrorEncoded = {
  _tag: "PtyNotFoundError";
  ptyID: string;
  message: string;
};

export type PtyTicket_ConnectToken = {
  ticket: string;
  expires_in: number;
};

export type Reference_GitSource = {
  type: "git";
  repository: string;
  branch?: string;
};

export type Reference_Info = {
  name: string;
  path: AbsolutePath;
  description?: string;
  hidden?: boolean;
  source: Reference_Source;
};

export type Reference_LocalSource = {
  type: "local";
  path: AbsolutePath;
};

export type Reference_Source = Reference_LocalSource | Reference_GitSource;

export type RelativePath = string;

export type Rpc_Input = {
  input?: unknown;
};

export type Rpc_Output = {
  output?: unknown;
};

export type RpcErrorEncoded = {
  _tag: "RpcError";
  type: string;
  message: string;
  data?: unknown | null;
};

export type RpcInternalErrorEncoded = {
  _tag: "RpcInternalError";
  type: "rpc.internal" | "rpc.invalid_output";
  message: string;
  data?: unknown | null;
};

export type Schedule_Action = Schedule_Action_Prompt;

export type Schedule_Action_Prompt = {
  type: "prompt";
  prompt: string;
};

export type Schedule_Condition = Schedule_Condition_Shell | Schedule_Condition_Code;

export type Schedule_Condition_Code = {
  type: "code";
  code: string;
};

export type Schedule_Condition_Shell = {
  type: "shell";
  run: string;
  is?: string;
  matches?: string;
  changes?: boolean;
};

export type Schedule_ConditionInput = {
  /** Shell command to run in the Session's directory. Alone, exit 0 wakes and stdout is appended. */
  run: string;
  is?: string;
  matches?: string;
  changes?: boolean;
  code?: unknown;
} | ({
  /** Code Mode JavaScript check (no fetch; 30s, 20 tool calls, 32 KB output cap). Call tools statically as tools.<ns>.<tool>(...) or tools["ns-name"].tool(...); each is authorized once at creation to run unattended. Runs once at creation with state = null (if baselines state without waking; until matches immediately if true), with globals state, now (epoch ms) and runs. Return a boolean or { wake, state?, message? } (message is appended to prompt on wake), e.g.: const t = await tools.slack.read_thread({ id }); return { wake: state !== null && t.count > state.count, state: { count: t.count }, message: "New reply" } */
  code: string;
  run?: unknown;
  is?: unknown;
  matches?: unknown;
  changes?: unknown;
});

export type Schedule_CreatePayload = {
  sessionID: Session_ID;
  name?: string;
  when?: Schedule_WhenInput;
  if?: Schedule_ConditionInput;
  until?: Schedule_ConditionInput;
  ends?: Schedule_Ends;
  /** The message the Session receives when the schedule wakes. */
  prompt: string;
};

/** A duration such as "90 seconds", "5 minutes" or "2 hours". */
export type Schedule_Duration = string;

export type Schedule_Ends = {
  after?: Schedule_Duration;
  at?: string;
  times?: number;
};

export type Schedule_ID = string;

export type Schedule_Info = {
  id: Schedule_ID;
  sessionID?: Session_ID;
  name?: string;
  when: Schedule_When;
  tz: string;
  if?: Schedule_Condition;
  until?: Schedule_Condition;
  action: Schedule_Action;
  status: Schedule_Status;
  nextDueAt?: number;
  endsAt?: number;
  remainingRuns?: number;
  runCount: number;
  lastFiredAt?: number;
  lastOutcome?: Schedule_Outcome;
  lastOutput?: string;
  time: {
    created: number;
    updated: number;
  };
};

export type Schedule_Outcome = "fired" | "late" | "checked" | "expired" | "skipped" | "disabled" | "failed";

export type Schedule_Status = "active" | "paused" | "done";

export type Schedule_When = Schedule_When_In | Schedule_When_At | Schedule_When_Every | Schedule_When_Cron;

export type Schedule_When_At = {
  type: "at";
  at: string;
  tz?: string;
};

export type Schedule_When_Cron = {
  type: "cron";
  cron: string;
  tz?: string;
};

export type Schedule_When_Every = {
  type: "every";
  every: Schedule_Duration;
  tz?: string;
};

export type Schedule_When_In = {
  type: "in";
  in: Schedule_Duration;
  tz?: string;
};

export type Schedule_WhenInput = {
  in: Schedule_Duration;
  at?: unknown;
  every?: unknown;
  cron?: unknown;
  tz?: string;
} | {
  at: string;
  in?: unknown;
  every?: unknown;
  cron?: unknown;
  tz?: string;
} | {
  every: Schedule_Duration;
  in?: unknown;
  at?: unknown;
  cron?: unknown;
  tz?: string;
} | {
  cron: string;
  in?: unknown;
  at?: unknown;
  every?: unknown;
  tz?: string;
};

export type ScheduleNotFoundErrorEncoded = {
  _tag: "ScheduleNotFoundError";
  scheduleID: string;
  message: string;
};

export type ServerInfo = {
  version: string;
  pid: number;
  hostname?: string | null;
  urls: Array<string>;
  paths: {
    tmp: string;
  };
  capabilities?: ({
    persistentPty?: boolean | null;
  }) | null;
};

export type ServiceUnavailableErrorEncoded = {
  _tag: "ServiceUnavailableError";
  message: string;
  service?: string | null;
};

export type Session_Event_Durable = session_created | session_agent_selected | session_model_selected | session_moved | session_renamed | session_metadata_updated | session_permissions | session_viewed | session_archived | session_unarchived | session_deleted | session_forked | session_inbox_delivered | session_inbox_enqueued | session_inbox_cancelled | session_inbox_delivery_changed | session_execution_started | session_execution_succeeded | session_execution_failed | session_execution_interrupted | session_instructions_updated | session_synthetic | session_skill_activated | session_shell_started | session_shell_ended | session_step_started | session_step_streamed | session_step_ended | session_step_failed | session_text_started | session_text_ended | session_reasoning_started | session_reasoning_ended | session_tool_input_started | session_tool_input_ended | session_tool_called | session_tool_success | session_tool_failed | session_retry_scheduled | session_compaction_started | session_compaction_ended | session_compaction_failed | session_revert_staged | session_revert_cleared | session_revert_committed | session_usage_recorded | session_message_content_updated;

export type Session_ForkBoundary = {
  type: "before";
  messageID: Session_Message_ID;
} | {
  type: "through";
  messageID: Session_Message_ID;
};

export type Session_ID = string;

export type Session_Inbox_Compaction = {
  id: Session_Message_ID;
  sessionID: Session_ID;
  time: {
    created: number;
  };
  type: "compaction";
  payload: Session_Inbox_CompactionPayload;
  delivery: Session_Inbox_Delivery;
};

export type Session_Inbox_CompactionPayload = unknown;

export type Session_Inbox_Delivery = "steer" | "queue";

export type Session_Inbox_Info = Session_Inbox_User | Session_Inbox_Synthetic | Session_Inbox_Compaction | Session_Inbox_Move;

export type Session_Inbox_Item = {
  type: "user";
  payload: Session_Inbox_UserPayload;
  delivery: Session_Inbox_Delivery;
} | {
  type: "synthetic";
  payload: Session_Inbox_SyntheticPayload;
  delivery: Session_Inbox_Delivery;
} | {
  type: "compaction";
  payload: Session_Inbox_CompactionPayload;
  delivery: Session_Inbox_Delivery;
} | {
  type: "move";
  payload: Session_Inbox_MovePayload_1;
  delivery: Session_Inbox_Delivery;
};

export type Session_Inbox_Move = {
  id: Session_Message_ID;
  sessionID: Session_ID;
  time: {
    created: number;
  };
  type: "move";
  delivery: Session_Inbox_Delivery;
  payload: Session_Inbox_MovePayload;
};

export type Session_Inbox_MovePayload = {
  projectID: Project_ID;
  subpath?: RelativePath;
  location: Location_PublicRef;
};

export type Session_Inbox_MovePayload_1 = {
  location: Location_Ref;
  projectID: Project_ID;
  subpath?: RelativePath;
};

export type Session_Inbox_Synthetic = {
  id: Session_Message_ID;
  sessionID: Session_ID;
  time: {
    created: number;
  };
  type: "synthetic";
  payload: Session_Inbox_SyntheticPayload;
  delivery: Session_Inbox_Delivery;
};

export type Session_Inbox_SyntheticPayload = {
  text: string;
  description?: string;
  metadata?: Record<string, unknown>;
};

export type Session_Inbox_User = {
  id: Session_Message_ID;
  sessionID: Session_ID;
  time: {
    created: number;
  };
  type: "user";
  payload: Session_Inbox_UserPayload;
  delivery: Session_Inbox_Delivery;
};

export type Session_Inbox_UserPayload = {
  text: string;
  files?: Array<Prompt_FileAttachment>;
  agents?: Array<Prompt_AgentAttachment>;
  skills?: Array<Prompt_SkillAttachment>;
  metadata?: Record<string, unknown>;
};

export type Session_Info = {
  id: Session_ID;
  parentID?: Session_ID;
  fork?: {
    sessionID: Session_ID;
    boundary: Session_ForkBoundary;
  };
  projectID: Project_ID;
  agent?: Agent_ID;
  model?: Model_Ref;
  cost: Money_USD;
  tokens: TokenUsage_Info;
  outcome?: "succeeded" | "failed" | "interrupted";
  time: {
    created: number;
    updated: number;
    busy?: number;
    idle?: number;
    viewed?: number;
    archived?: number;
  };
  title?: string;
  subpath?: RelativePath;
  metadata?: Session_Metadata;
  permissions?: Permission_Ruleset;
  revert?: Session_Revert;
  location: Location_PublicRef;
};

export type Session_Message_AgentSelected = {
  id: Session_Message_ID;
  metadata?: Record<string, unknown>;
  time: {
    created: number;
  };
  type: "agent-switched";
  agent: Agent_ID;
  previous?: Agent_ID;
};

export type Session_Message_Assistant = {
  id: Session_Message_ID;
  metadata?: Record<string, unknown>;
  time: {
    created: number;
    streamed?: number;
    completed?: number;
  };
  type: "assistant";
  agent: Agent_ID;
  model: Model_Ref;
  content: Array<Session_Message_Assistant_Text | Session_Message_Assistant_Reasoning | Session_Message_Assistant_Tool>;
  snapshot?: {
    start?: Snapshot_ID;
    end?: Snapshot_ID;
    files?: Array<RelativePath>;
  };
  finish?: "stop" | "length" | "tool-calls" | "content-filter" | "error" | "unknown";
  rawFinish?: string;
  native?: Session_Message_Native;
  cost?: Money_USD;
  tokens?: TokenUsage_Info;
  error?: Session_StructuredError;
  retry?: Session_Message_Assistant_Retry;
};

export type Session_Message_Assistant_Reasoning = {
  type: "reasoning";
  text: string;
  native?: Session_Message_Native;
  time?: {
    created: number;
    completed?: number;
  };
};

export type Session_Message_Assistant_Retry = {
  attempt: number;
  at: number;
  error: Session_StructuredError;
};

export type Session_Message_Assistant_Text = {
  type: "text";
  text: string;
  native?: Session_Message_Native;
};

export type Session_Message_Assistant_Tool = {
  type: "tool";
  id: string;
  name: string;
  executed?: boolean;
  native?: Session_Message_Native;
  state: Session_Message_ToolState_Streaming | Session_Message_ToolState_Running | Session_Message_ToolState_Completed | Session_Message_ToolState_Error;
  time: {
    created: number;
    ran?: number;
    completed?: number;
  };
};

export type Session_Message_AssistantContent_Encoded = Session_Message_Assistant_Text | Session_Message_Assistant_Reasoning | Session_Message_Assistant_Tool;

export type Session_Message_Compaction = Session_Message_Compaction_Running | Session_Message_Compaction_Completed | Session_Message_Compaction_Failed;

export type Session_Message_Compaction_Completed = {
  type: "compaction";
  id: Session_Message_ID;
  metadata?: Record<string, unknown>;
  time: {
    created: number;
  };
  status: "completed";
  reason: "auto" | "manual";
  model?: Model_Ref;
  native?: Session_Message_Native;
  summary: string;
  cost?: Money_USD;
  tokens?: TokenUsage_Info;
};

export type Session_Message_Compaction_Failed = {
  type: "compaction";
  id: Session_Message_ID;
  metadata?: Record<string, unknown>;
  time: {
    created: number;
  };
  status: "failed";
  reason: "auto" | "manual";
  error: Session_StructuredError;
  cost?: Money_USD;
  tokens?: TokenUsage_Info;
};

export type Session_Message_Compaction_Running = {
  type: "compaction";
  id: Session_Message_ID;
  metadata?: Record<string, unknown>;
  time: {
    created: number;
  };
  status: "running";
  reason: "auto" | "manual";
  summary: string;
};

export type Session_Message_ID = string;

export type Session_Message_Idle = {
  id: Session_Message_ID;
  metadata?: Record<string, unknown>;
  time: {
    created: number;
  };
  type: "idle";
  outcome: "succeeded" | "failed" | "interrupted";
  error?: Session_StructuredError;
};

export type Session_Message_Info = Session_Message_AgentSelected | Session_Message_ModelSelected | Session_Message_LocationSwitched | Session_Message_User | Session_Message_Synthetic | Session_Message_System | Session_Message_Skill | Session_Message_Shell | Session_Message_Assistant | Session_Message_Compaction | Session_Message_Idle;

export type Session_Message_LocationSwitched = {
  id: Session_Message_ID;
  metadata?: Record<string, unknown>;
  time: {
    created: number;
  };
  type: "location-switched";
  projectID?: Project_ID;
  subpath?: RelativePath;
  location: Location_PublicRef;
  previous?: {
    location: Location_PublicRef;
    projectID?: Project_ID;
    subpath?: RelativePath;
  } | null;
};

export type Session_Message_ModelSelected = {
  id: Session_Message_ID;
  metadata?: Record<string, unknown>;
  time: {
    created: number;
  };
  type: "model-switched";
  model: Model_Ref;
  previous?: Model_Ref;
};

export type Session_Message_Native = Record<string, unknown>;

export type Session_Message_Shell = {
  id: Session_Message_ID;
  metadata?: Record<string, unknown>;
  time: {
    created: number;
    completed?: number;
  };
  type: "shell";
  shellID: Shell_ID;
  command: string;
  status: "running" | "exited" | "timeout" | "killed";
  exit?: number | ("Infinity" | "-Infinity" | "NaN");
  output?: {
    output: string;
    cursor: number;
    size: number;
    truncated: boolean;
  };
};

export type Session_Message_Skill = {
  id: Session_Message_ID;
  metadata?: Record<string, unknown>;
  time: {
    created: number;
  };
  type: "skill";
  skill: Skill_ID;
  name: Skill_Name;
  text: string;
};

export type Session_Message_Synthetic = {
  id: Session_Message_ID;
  metadata?: Record<string, unknown>;
  time: {
    created: number;
  };
  text: string;
  description?: string;
  type: "synthetic";
};

export type Session_Message_System = {
  id: Session_Message_ID;
  metadata?: Record<string, unknown>;
  time: {
    created: number;
  };
  type: "system";
  text: string;
  description?: string;
};

export type Session_Message_ToolState_Completed = {
  status: "completed";
  input: Record<string, unknown>;
  content: Array<Tool_Content>;
  metadata?: Record<string, unknown>;
};

export type Session_Message_ToolState_Error = {
  status: "error";
  input: Record<string, unknown>;
  error: Session_StructuredError;
  content?: Array<Tool_Content>;
  metadata?: Record<string, unknown>;
};

export type Session_Message_ToolState_Running = {
  status: "running";
  input: Record<string, unknown>;
  metadata: Record<string, unknown>;
};

export type Session_Message_ToolState_Streaming = {
  status: "streaming";
  input: string;
};

export type Session_Message_User = {
  id: Session_Message_ID;
  metadata?: Record<string, unknown>;
  time: {
    created: number;
  };
  text: string;
  files?: Array<Prompt_FileAttachment>;
  agents?: Array<Prompt_AgentAttachment>;
  skills?: Array<Prompt_SkillAttachment>;
  type: "user";
};

export type Session_Metadata = Record<string, unknown>;

export type Session_Revert = {
  messageID: Session_Message_ID;
  partID?: string;
  snapshot?: Snapshot_ID;
  files?: Array<FileDiff_Info>;
};

export type Session_StructuredError = {
  type: string;
  message: string;
  status?: number;
  response?: {
    body: string;
  };
  retryAfterMs?: number;
};

export type SessionActive = {
  type: "running";
};

export type SessionBusyErrorEncoded = {
  _tag: "SessionBusyError";
  sessionID: string;
  message: string;
};

export type SessionGenerateResponse = {
  data: {
    text: string;
    tokens: TokenUsage_Info;
    cost: Money_USD;
  };
};

export type SessionInterruptResponse = {
  /** Whether an active execution owned by this OpenCode process was interrupted. */
  interrupted: boolean;
};

export type SessionLogItem = Session_Event_Durable | EventLog_Synced;

export type SessionLogItemEncoded = string;

export type SessionMessagesResponse = {
  data: Array<Session_Message_Info>;
  cursor: {
    previous?: string | null;
    next?: string | null;
  };
};

export type SessionNotFoundErrorEncoded = {
  _tag: "SessionNotFoundError";
  sessionID: string;
  message: string;
};

export type SessionStats_Activity = {
  date: string;
  steps: number;
};

export type SessionStats_Info = {
  range: {
    from: number;
    to: number;
  };
  sessions: number;
  subagents: number;
  prompts: number;
  steps: number;
  tokens: TokenUsage_Info;
  cost: Money_USD;
  tools: SessionStats_Tools;
  activeDays: number;
  streak: number;
  activity: Array<SessionStats_Activity>;
  models: Array<SessionStats_ModelUsage>;
};

export type SessionStats_ModelUsage = {
  model: Model_Ref;
  steps: number;
  tokens: TokenUsage_Info;
  cost: Money_USD;
};

export type SessionStats_ToolTotals = {
  calls: number;
  succeeded: number;
  failed: number;
  unfinished: number;
};

export type SessionStats_ToolUsage = {
  name: string;
  calls: number;
  succeeded: number;
  failed: number;
  unfinished: number;
  durationP50?: number;
};

export type SessionStats_Tools = {
  mode: "none";
} | {
  mode: "summary";
  totals: SessionStats_ToolTotals;
} | {
  mode: "detail";
  totals: SessionStats_ToolTotals;
  usage: Array<SessionStats_ToolUsage>;
};

export type SessionStatus = {
  type: "idle";
} | {
  type: "retry";
  attempt: number;
  message: string;
  action?: {
    reason: string;
    provider: string;
    title: string;
    message: string;
    label: string;
    link?: string;
  };
  next: number;
} | {
  type: "busy";
};

export type SessionStatusUpdated = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "session.status";
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
    status: SessionStatus;
  };
};

export type SessionTransfer_Data = {
  info: Session_Info;
  messages: Array<Session_Message_Info>;
};

/** Opaque pagination cursor returned as cursor.previous or cursor.next in the previous response. */
export type SessionsCursor = string;

export type SessionsResponse = {
  data: Array<Session_Info>;
  cursor: {
    previous?: SessionsCursor | null;
    next?: SessionsCursor | null;
  };
};

export type Shell_ID = string;

export type Shell_Info = {
  id: Shell_ID;
  status: "running" | "exited" | "timeout" | "killed";
  command: string;
  cwd: string;
  shell: string;
  file: string;
  pid?: number;
  exit?: number;
  signal?: string;
  metadata: Record<string, unknown>;
  time: {
    /** Start time in milliseconds since the Unix epoch */
    started: number;
    completed?: number;
  };
};

export type ShellNotFoundErrorEncoded = {
  _tag: "ShellNotFoundError";
  id: string;
  message: string;
};

export type Skill_ID = string;

export type Skill_Info = {
  id: Skill_ID;
  name: Skill_Name;
  description?: string;
  autoinvoke?: boolean;
  path: AbsolutePath;
  content: string;
};

export type Skill_Name = string;

export type SkillNotFoundErrorEncoded = {
  _tag: "SkillNotFoundError";
  skill: Skill_ID;
  message: string;
};

export type Snapshot_ID = string;

export type TokenUsage_Info = {
  input: number;
  output: number;
  reasoning: number;
  cache: {
    read: number;
    write: number;
  };
};

export type Tool_Content = Tool_TextContent | Tool_FileContent;

export type Tool_FileContent = {
  type: "file";
  uri: string;
  mime: string;
  name?: string | null;
};

export type Tool_TextContent = {
  type: "text";
  text: string;
};

export type UnauthorizedErrorEncoded = {
  _tag: "UnauthorizedError";
  message: string;
};

export type UnknownErrorEncoded = {
  _tag: "UnknownError";
  message: string;
  ref?: string | null;
};

export type UnsupportedModelErrorEncoded = {
  _tag: "UnsupportedModelError";
  providerID: string;
  modelID: string;
  capability: string;
  message: string;
};

export type UsageLimits_Budget = {
  id: string;
  limit: Money_USD;
  spent: Money_USD;
  scope: "each" | "combined";
  per: "set" | "model";
  coverage: "all" | "models";
  models: Array<UsageLimits_BudgetModel>;
  vendors: Array<string>;
  inputPriceAtLeast?: Money_USDPerMillionTokens;
  picked: boolean;
  shared: boolean;
  /** Milliseconds since the Unix epoch */
  resetsAt: number;
};

export type UsageLimits_BudgetModel = {
  providerID: Provider_ID;
  modelID: string;
  name: string;
  spent?: Money_USD;
};

export type UsageLimits_Go = {
  rolling: UsageLimits_Meter;
  weekly: UsageLimits_Meter;
  monthly: UsageLimits_Meter;
};

export type UsageLimits_Info = {
  workspace: {
    id: string;
    name?: string;
    usageURL: string;
  };
  go?: UsageLimits_Go;
  budgets: Array<UsageLimits_Budget>;
};

export type UsageLimits_Meter = {
  percent: number;
  limited: boolean;
  /** Milliseconds since the Unix epoch */
  resetsAt: number;
};

export type V2Event = location_shutdown | models_dev_refreshed | credential_updated | credential_switched | integration_updated | provider_updated | model_updated | agent_updated | session_created | session_agent_selected | session_model_selected | session_moved | session_renamed | session_metadata_updated | session_permissions | session_viewed | session_archived | session_unarchived | session_usage_updated | session_deleted | session_forked | session_inbox_delivered | session_inbox_enqueued | session_inbox_cancelled | session_inbox_delivery_changed | session_execution_started | session_execution_succeeded | session_execution_failed | session_execution_interrupted | session_instructions_updated | session_synthetic | session_skill_activated | session_shell_started | session_shell_ended | session_step_started | session_step_streamed | session_step_ended | session_step_failed | session_text_started | session_text_delta | session_text_ended | session_reasoning_started | session_reasoning_delta | session_reasoning_ended | session_tool_input_started | session_tool_input_delta | session_tool_input_ended | session_tool_called | session_tool_progress | session_tool_success | session_tool_failed | session_retry_scheduled | session_compaction_started | session_compaction_delta | session_compaction_ended | session_compaction_failed | session_revert_staged | session_revert_cleared | session_revert_committed | filesystem_changed | reference_updated | permission_asked | permission_replied | plugin_updated | project_updated | worktree_updated | worktree_resolved | command_updated | config_updated | skill_updated | pty_created | pty_updated | pty_exited | pty_deleted | persistent_pty_added | persistent_pty_removed | persistent_pty_updated | shell_created | shell_exited | shell_deleted | form_created | form_replied | form_cancelled | websearch_updated | artifact_updated | SessionStatusUpdated | session_idle | tui_prompt_append | tui_command_execute | tui_toast_show | tui_session_select | installation_updated | installation_update_available | vcs_branch_updated | mcp_status_changed | mcp_resources_changed | V2Event_rpc | V2Event_server_connected;

export type V2Event_rpc = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown> | null;
  type: string;
  location: Location_PublicRef;
  data: Record<string, unknown>;
};

export type V2Event_server_connected = {
  id: Event_ID;
  metadata?: Record<string, unknown> | null;
  location?: Location_PublicRef | null;
  type: "server.connected";
  data: unknown;
};

export type V2EventEncoded = string;

export type Vcs_Base = {
  name: string;
  ref: string;
  source: "reflog" | "default";
};

export type Vcs_Branch = {
  current?: string;
  default?: string;
};

export type Vcs_BranchList = Array<string>;

export type Vcs_FileStatus = {
  file: string;
  additions: number;
  deletions: number;
  status: "added" | "deleted" | "modified";
};

export type Vcs_Info = {
  provider?: string;
  branch: Vcs_Branch;
};

export type Vcs_Mode = "working" | "branch" | "committed";

export type Vcs_Untracked = "files" | "folders";

export type VcsInitNotSupportedErrorEncoded = {
  _tag: "VcsInitNotSupportedError";
  providerID: string;
  message: string;
};

export type VoiceModel = {
  model: string;
  provider: string;
  transports: Array<VoiceTransportType>;
  available: boolean;
};

export type VoiceModelsResponse = {
  data: {
    models: Array<VoiceModel>;
    default?: string | null;
  };
};

export type VoiceSessionResponse = {
  data: {
    transport: VoiceTransport;
  };
};

export type VoiceTransport = VoiceWebRTCTransport | VoiceWebSocketTransport;

export type VoiceTransportInput = VoiceWebRTCTransportInput | VoiceWebSocketTransportInput;

export type VoiceTransportType = "webrtc" | "websocket";

export type VoiceWebRTCTransport = {
  type: "webrtc";
  sdp: string;
};

export type VoiceWebRTCTransportInput = {
  type: "webrtc";
  sdp: string;
  dcid?: number | ("Infinity" | "-Infinity" | "NaN") | null;
};

export type VoiceWebSocketTransport = {
  type: "websocket";
  url: string;
  token: string;
  expiresAt: number | ("Infinity" | "-Infinity" | "NaN");
};

export type VoiceWebSocketTransportInput = {
  type: "websocket";
};

export type WebSearch_ID = string;

export type WebSearch_Provider = {
  id: WebSearch_ID;
  name: string;
};

export type WebSearch_ResponseEncoded = {
  providerID: WebSearch_ID;
  results: Array<WebSearch_Result>;
};

export type WebSearch_Result = {
  url: string;
  title?: string;
  content?: string;
  time: {
    published?: number;
  };
};

export type Workspace_ID = string;

export type Worktree_CreateInput = {
  projectID: Project_ID;
  from?: AbsolutePath;
  branch?: string;
  directory?: AbsolutePath;
  name?: string;
};

export type Worktree_Directory = {
  directory: AbsolutePath;
  strategy?: string;
};

export type Worktree_Info = {
  directory: AbsolutePath;
};

export type Worktree_List = Array<Worktree_Directory>;

export type Worktree_RemoveInput = {
  projectID: Project_ID;
  directory: AbsolutePath;
  force: boolean;
};

export type WorktreeErrorEncoded = {
  _tag: "WorktreeError";
  name: "WorktreeError";
  data: {
    message: string;
    forceRequired?: boolean | null;
  };
};

export type agent_updated = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "agent.updated";
  location?: Location_Ref;
  data: unknown;
};

export type artifact_updated = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "artifact.updated";
  location?: Location_Ref;
  data: unknown;
};

export type command_updated = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "command.updated";
  location?: Location_Ref;
  data: unknown;
};

export type config_updated = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "config.updated";
  location?: Location_Ref;
  data: unknown;
};

export type credential_switched = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "credential.switched";
  location?: Location_Ref;
  data: {
    integrationID: Integration_ID;
    credentialID: Credential_ID | null;
  };
};

export type credential_updated = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "credential.updated";
  location?: Location_Ref;
  data: {
    integrationID: Integration_ID;
    credentialID: Credential_ID;
  };
};

export type filesystem_changed = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "filesystem.changed";
  location?: Location_Ref;
  data: {
    file: string;
    event: "add" | "change" | "unlink";
  };
};

export type form_cancelled = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "form.cancelled";
  location?: Location_Ref;
  data: {
    id: Form_ID;
    sessionID: string;
  };
};

export type form_created = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "form.created";
  location?: Location_Ref;
  data: {
    form: Form_Info_1;
  };
};

export type form_replied = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "form.replied";
  location?: Location_Ref;
  data: {
    id: Form_ID;
    sessionID: string;
    answer: Form_Answer_1;
  };
};

export type installation_update_available = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "installation.update-available";
  location?: Location_Ref;
  data: {
    version: string;
  };
};

export type installation_updated = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "installation.updated";
  location?: Location_Ref;
  data: {
    version: string;
  };
};

export type integration_updated = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "integration.updated";
  location?: Location_Ref;
  data: unknown;
};

export type location_shutdown = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "location.shutdown";
  location?: Location_Ref;
  data: unknown;
};

export type mcp_resources_changed = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "mcp.resources.changed";
  location?: Location_Ref;
  data: {
    server: string;
  };
};

export type mcp_status_changed = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "mcp.status.changed";
  location?: Location_Ref;
  data: {
    server: string;
  };
};

export type model_updated = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "model.updated";
  location?: Location_Ref;
  data: unknown;
};

export type models_dev_refreshed = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "models-dev.refreshed";
  location?: Location_Ref;
  data: unknown;
};

export type permission_asked = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "permission.asked";
  location?: Location_Ref;
  data: {
    id: Permission_ID;
    sessionID: Session_ID;
    action: string;
    resources: Array<string>;
    save?: Array<string>;
    metadata?: Record<string, unknown>;
    source?: Permission_Source;
    message?: string;
  };
};

export type permission_replied = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "permission.replied";
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
    requestID: Permission_ID;
    reply: Permission_Reply;
  };
};

export type persistent_pty_added = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "persistent-pty.added";
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
    terminal: PersistentPty_Info;
  };
};

export type persistent_pty_removed = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "persistent-pty.removed";
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
    ptyID: Pty_ID;
  };
};

export type persistent_pty_updated = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "persistent-pty.updated";
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
    terminal: PersistentPty_Info;
  };
};

export type plugin_updated = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "plugin.updated";
  location?: Location_Ref;
  data: unknown;
};

export type project_updated = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "project.updated";
  location?: Location_Ref;
  data: {
    id: Project_ID;
    canonical: AbsolutePath;
    vcs?: Project_Vcs;
    name?: string;
    icon?: Project_Icon;
    commands?: Project_Commands;
    time: Project_Time;
    sandboxes: Array<string>;
  };
};

export type provider_updated = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "provider.updated";
  location?: Location_Ref;
  data: unknown;
};

export type pty_created = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "pty.created";
  location?: Location_Ref;
  data: {
    info: Pty;
  };
};

export type pty_deleted = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "pty.deleted";
  location?: Location_Ref;
  data: {
    id: Pty_ID;
  };
};

export type pty_exited = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "pty.exited";
  location?: Location_Ref;
  data: {
    id: Pty_ID;
    exitCode: number;
  };
};

export type pty_updated = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "pty.updated";
  location?: Location_Ref;
  data: {
    info: Pty;
  };
};

export type reference_updated = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "reference.updated";
  location?: Location_Ref;
  data: unknown;
};

export type session_agent_selected = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "session.agent.selected";
  durable: {
    aggregateID: string;
    seq: Event_Seq;
    version: Event_VersionEncoded_c77c5abcb68d;
  };
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
    agent: Agent_ID;
    previous?: Agent_ID;
  };
};

export type session_archived = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "session.archived";
  durable: {
    aggregateID: string;
    seq: Event_Seq;
    version: Event_VersionEncoded_c77c5abcb68d;
  };
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
  };
};

export type session_compaction_delta = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "session.compaction.delta";
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
    text: string;
  };
};

export type session_compaction_ended = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "session.compaction.ended";
  durable: {
    aggregateID: string;
    seq: Event_Seq;
    version: Event_VersionEncoded_c77c5abcb68d;
  };
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
    reason: "auto" | "manual";
    model?: Model_Ref;
    native?: Session_Message_Native;
    text: string;
    cost?: Money_USD;
    tokens?: TokenUsage_Info;
  };
};

export type session_compaction_failed = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "session.compaction.failed";
  durable: {
    aggregateID: string;
    seq: Event_Seq;
    version: Event_VersionEncoded_c77c5abcb68d;
  };
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
    reason: "auto" | "manual";
    error: Session_StructuredError;
    inputID?: Session_Message_ID;
    cost?: Money_USD;
    tokens?: TokenUsage_Info;
  };
};

export type session_compaction_started = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "session.compaction.started";
  durable: {
    aggregateID: string;
    seq: Event_Seq;
    version: Event_VersionEncoded_c77c5abcb68d;
  };
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
    reason: "auto" | "manual";
    inputID?: Session_Message_ID;
  };
};

export type session_created = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "session.created";
  durable: {
    aggregateID: string;
    seq: Event_Seq;
    version: Event_VersionEncoded_c77c5abcb68d;
  };
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
    projectID: Project_ID;
    location: Location_Ref;
    subpath?: RelativePath;
    parentID?: Session_ID;
    slug: string;
    title?: string;
    agent?: Agent_ID;
    model?: Model_Ref;
    metadata?: Session_Metadata;
    permissions?: Permission_Ruleset;
    version: string;
  };
};

export type session_deleted = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "session.deleted";
  durable: {
    aggregateID: string;
    seq: Event_Seq;
    version: Event_VersionEncoded_c3ea984aceae;
  };
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
  };
};

export type session_execution_failed = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "session.execution.failed";
  durable: {
    aggregateID: string;
    seq: Event_Seq;
    version: Event_VersionEncoded_c77c5abcb68d;
  };
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
    error: Session_StructuredError;
  };
};

export type session_execution_interrupted = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "session.execution.interrupted";
  durable: {
    aggregateID: string;
    seq: Event_Seq;
    version: Event_VersionEncoded_c77c5abcb68d;
  };
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
    reason: "user" | "shutdown" | "superseded" | "inactivity";
  };
};

export type session_execution_started = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "session.execution.started";
  durable: {
    aggregateID: string;
    seq: Event_Seq;
    version: Event_VersionEncoded_c77c5abcb68d;
  };
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
  };
};

export type session_execution_succeeded = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "session.execution.succeeded";
  durable: {
    aggregateID: string;
    seq: Event_Seq;
    version: Event_VersionEncoded_c77c5abcb68d;
  };
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
  };
};

export type session_forked = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "session.forked";
  durable: {
    aggregateID: string;
    seq: Event_Seq;
    version: Event_VersionEncoded_c3ea984aceae;
  };
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
    parentID: Session_ID;
    boundary: Session_ForkBoundary;
    instructions?: Record<string, never>;
    instructionEntries?: InstructionEntry_Snapshot;
  };
};

export type session_idle = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "session.idle";
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
  };
};

export type session_inbox_cancelled = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "session.inbox.cancelled";
  durable: {
    aggregateID: string;
    seq: Event_Seq;
    version: Event_VersionEncoded_c77c5abcb68d;
  };
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
    inboxID: Session_Message_ID;
  };
};

export type session_inbox_delivered = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "session.inbox.delivered";
  durable: {
    aggregateID: string;
    seq: Event_Seq;
    version: Event_VersionEncoded_c77c5abcb68d;
  };
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
    inboxID: Session_Message_ID;
  };
};

export type session_inbox_delivery_changed = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "session.inbox.delivery.changed";
  durable: {
    aggregateID: string;
    seq: Event_Seq;
    version: Event_VersionEncoded_c77c5abcb68d;
  };
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
    inboxID: Session_Message_ID;
    delivery: Session_Inbox_Delivery;
  };
};

export type session_inbox_enqueued = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "session.inbox.enqueued";
  durable: {
    aggregateID: string;
    seq: Event_Seq;
    version: Event_VersionEncoded_c77c5abcb68d;
  };
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
    inboxID: Session_Message_ID;
    item: Session_Inbox_Item;
  };
};

export type session_instructions_updated = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "session.instructions.updated";
  durable: {
    aggregateID: string;
    seq: Event_Seq;
    version: Event_VersionEncoded_c3ea984aceae;
  };
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
    delta: Record<string, Instruction_Hash | "removed">;
    text?: string;
  };
};

export type session_message_content_updated = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "session.message.content.updated";
  durable: {
    aggregateID: string;
    seq: Event_Seq;
    version: Event_VersionEncoded_c77c5abcb68d;
  };
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
    messageID: Session_Message_ID;
    content: Array<Session_Message_AssistantContent_Encoded>;
  };
};

export type session_metadata_updated = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "session.metadata.updated";
  durable: {
    aggregateID: string;
    seq: Event_Seq;
    version: Event_VersionEncoded_c77c5abcb68d;
  };
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
    metadata: Session_Metadata;
  };
};

export type session_model_selected = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "session.model.selected";
  durable: {
    aggregateID: string;
    seq: Event_Seq;
    version: Event_VersionEncoded_c77c5abcb68d;
  };
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
    model: Model_Ref;
    previous?: Model_Ref;
  };
};

export type session_moved = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "session.moved";
  durable: {
    aggregateID: string;
    seq: Event_Seq;
    version: Event_VersionEncoded_c77c5abcb68d;
  };
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
    location: Location_Ref;
    projectID: Project_ID;
    subpath?: RelativePath;
  };
};

export type session_permissions = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "session.permissions";
  durable: {
    aggregateID: string;
    seq: Event_Seq;
    version: Event_VersionEncoded_c77c5abcb68d;
  };
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
    permissions: Permission_Ruleset;
  };
};

export type session_reasoning_delta = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "session.reasoning.delta";
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
    assistantMessageID: Session_Message_ID;
    ordinal: number;
    delta: string;
  };
};

export type session_reasoning_ended = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "session.reasoning.ended";
  durable: {
    aggregateID: string;
    seq: Event_Seq;
    version: Event_VersionEncoded_c77c5abcb68d;
  };
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
    assistantMessageID: Session_Message_ID;
    ordinal: number;
    text: string;
    native?: Session_Message_Native;
  };
};

export type session_reasoning_started = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "session.reasoning.started";
  durable: {
    aggregateID: string;
    seq: Event_Seq;
    version: Event_VersionEncoded_c77c5abcb68d;
  };
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
    assistantMessageID: Session_Message_ID;
    ordinal: number;
    native?: Session_Message_Native;
  };
};

export type session_renamed = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "session.renamed";
  durable: {
    aggregateID: string;
    seq: Event_Seq;
    version: Event_VersionEncoded_c77c5abcb68d;
  };
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
    title: string;
  };
};

export type session_retry_scheduled = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "session.retry.scheduled";
  durable: {
    aggregateID: string;
    seq: Event_Seq;
    version: Event_VersionEncoded_c77c5abcb68d;
  };
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
    assistantMessageID: Session_Message_ID;
    attempt: number;
    at: number;
    error: Session_StructuredError;
  };
};

export type session_revert_cleared = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "session.revert.cleared";
  durable: {
    aggregateID: string;
    seq: Event_Seq;
    version: Event_VersionEncoded_c77c5abcb68d;
  };
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
  };
};

export type session_revert_committed = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "session.revert.committed";
  durable: {
    aggregateID: string;
    seq: Event_Seq;
    version: Event_VersionEncoded_c77c5abcb68d;
  };
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
    to: Session_Message_ID;
  };
};

export type session_revert_staged = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "session.revert.staged";
  durable: {
    aggregateID: string;
    seq: Event_Seq;
    version: Event_VersionEncoded_c77c5abcb68d;
  };
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
    revert: Session_Revert;
  };
};

export type session_shell_ended = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "session.shell.ended";
  durable: {
    aggregateID: string;
    seq: Event_Seq;
    version: Event_VersionEncoded_c77c5abcb68d;
  };
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
    shell: Shell_Info;
    output: {
      output: string;
      cursor: number;
      size: number;
      truncated: boolean;
    };
  };
};

export type session_shell_started = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "session.shell.started";
  durable: {
    aggregateID: string;
    seq: Event_Seq;
    version: Event_VersionEncoded_c77c5abcb68d;
  };
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
    shell: Shell_Info;
  };
};

export type session_skill_activated = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "session.skill.activated";
  durable: {
    aggregateID: string;
    seq: Event_Seq;
    version: Event_VersionEncoded_c77c5abcb68d;
  };
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
    id: Skill_ID;
    name: Skill_Name;
    text: string;
  };
};

export type session_step_ended = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "session.step.ended";
  durable: {
    aggregateID: string;
    seq: Event_Seq;
    version: Event_VersionEncoded_c77c5abcb68d;
  };
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
    assistantMessageID: Session_Message_ID;
    finish: "stop" | "length" | "tool-calls" | "content-filter" | "error" | "unknown";
    rawFinish?: string;
    native?: Session_Message_Native;
    cost: Money_USD;
    tokens: TokenUsage_Info;
    snapshot?: Snapshot_ID;
    files?: Array<RelativePath>;
  };
};

export type session_step_failed = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "session.step.failed";
  durable: {
    aggregateID: string;
    seq: Event_Seq;
    version: Event_VersionEncoded_c77c5abcb68d;
  };
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
    assistantMessageID: Session_Message_ID;
    error: Session_StructuredError;
    finish?: "content-filter";
    rawFinish?: string;
    native?: Session_Message_Native;
    cost?: Money_USD;
    tokens?: TokenUsage_Info;
    snapshot?: Snapshot_ID;
    files?: Array<RelativePath>;
  };
};

export type session_step_started = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "session.step.started";
  durable: {
    aggregateID: string;
    seq: Event_Seq;
    version: Event_VersionEncoded_c77c5abcb68d;
  };
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
    assistantMessageID: Session_Message_ID;
    agent: Agent_ID;
    model: Model_Ref;
    snapshot?: Snapshot_ID;
    started: number;
  };
};

export type session_step_streamed = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "session.step.streamed";
  durable: {
    aggregateID: string;
    seq: Event_Seq;
    version: Event_VersionEncoded_c77c5abcb68d;
  };
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
    assistantMessageID: Session_Message_ID;
  };
};

export type session_synthetic = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "session.synthetic";
  durable: {
    aggregateID: string;
    seq: Event_Seq;
    version: Event_VersionEncoded_c77c5abcb68d;
  };
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
    text: string;
    description?: string;
    metadata?: Record<string, unknown>;
  };
};

export type session_text_delta = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "session.text.delta";
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
    assistantMessageID: Session_Message_ID;
    ordinal: number;
    delta: string;
  };
};

export type session_text_ended = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "session.text.ended";
  durable: {
    aggregateID: string;
    seq: Event_Seq;
    version: Event_VersionEncoded_c77c5abcb68d;
  };
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
    assistantMessageID: Session_Message_ID;
    ordinal: number;
    text: string;
    native?: Session_Message_Native;
  };
};

export type session_text_started = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "session.text.started";
  durable: {
    aggregateID: string;
    seq: Event_Seq;
    version: Event_VersionEncoded_c77c5abcb68d;
  };
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
    assistantMessageID: Session_Message_ID;
    ordinal: number;
  };
};

export type session_tool_called = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "session.tool.called";
  durable: {
    aggregateID: string;
    seq: Event_Seq;
    version: Event_VersionEncoded_c77c5abcb68d;
  };
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
    assistantMessageID: Session_Message_ID;
    id: string;
    input: Record<string, unknown>;
    executed: boolean;
    native?: Session_Message_Native;
  };
};

export type session_tool_failed = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "session.tool.failed";
  durable: {
    aggregateID: string;
    seq: Event_Seq;
    version: Event_VersionEncoded_c3ea984aceae;
  };
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
    assistantMessageID: Session_Message_ID;
    id: string;
    error: Session_StructuredError;
    content?: Array<Tool_Content>;
    metadata?: Record<string, unknown>;
    executed: boolean;
    native?: Session_Message_Native;
  };
};

export type session_tool_input_delta = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "session.tool.input.delta";
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
    assistantMessageID: Session_Message_ID;
    id: string;
    delta: string;
  };
};

export type session_tool_input_ended = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "session.tool.input.ended";
  durable: {
    aggregateID: string;
    seq: Event_Seq;
    version: Event_VersionEncoded_c77c5abcb68d;
  };
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
    assistantMessageID: Session_Message_ID;
    id: string;
    text: string;
  };
};

export type session_tool_input_started = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "session.tool.input.started";
  durable: {
    aggregateID: string;
    seq: Event_Seq;
    version: Event_VersionEncoded_c77c5abcb68d;
  };
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
    assistantMessageID: Session_Message_ID;
    id: string;
    name: string;
  };
};

export type session_tool_progress = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "session.tool.progress";
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
    assistantMessageID: Session_Message_ID;
    id: string;
    metadata: Record<string, unknown>;
  };
};

export type session_tool_success = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "session.tool.success";
  durable: {
    aggregateID: string;
    seq: Event_Seq;
    version: Event_VersionEncoded_c3ea984aceae;
  };
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
    assistantMessageID: Session_Message_ID;
    id: string;
    content: Array<Tool_Content>;
    metadata?: Record<string, unknown>;
    executed: boolean;
    native?: Session_Message_Native;
  };
};

export type session_unarchived = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "session.unarchived";
  durable: {
    aggregateID: string;
    seq: Event_Seq;
    version: Event_VersionEncoded_c77c5abcb68d;
  };
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
  };
};

export type session_usage_recorded = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "session.usage.recorded";
  durable: {
    aggregateID: string;
    seq: Event_Seq;
    version: Event_VersionEncoded_c77c5abcb68d;
  };
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
    source: "title" | "compaction" | "generate";
    cost: Money_USD;
    tokens: TokenUsage_Info;
  };
};

export type session_usage_updated = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "session.usage.updated";
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
    cost: Money_USD;
    tokens: TokenUsage_Info;
  };
};

export type session_viewed = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "session.viewed";
  durable: {
    aggregateID: string;
    seq: Event_Seq;
    version: Event_VersionEncoded_c77c5abcb68d;
  };
  location?: Location_Ref;
  data: {
    sessionID: Session_ID;
    idle: number;
  };
};

export type shell_created = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "shell.created";
  location?: Location_Ref;
  data: {
    info: Shell_Info;
  };
};

export type shell_deleted = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "shell.deleted";
  location?: Location_Ref;
  data: {
    id: Shell_ID;
  };
};

export type shell_exited = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "shell.exited";
  location?: Location_Ref;
  data: {
    id: Shell_ID;
    exit?: number;
    status: "running" | "exited" | "timeout" | "killed";
  };
};

export type skill_updated = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "skill.updated";
  location?: Location_Ref;
  data: unknown;
};

export type tui_command_execute = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "tui.command.execute";
  location?: Location_Ref;
  data: {
    command: ("session.list" | "session.new" | "session.interrupt" | "session.background" | "session.compact" | "session.page.up" | "session.page.down" | "session.line.up" | "session.line.down" | "session.half.page.up" | "session.half.page.down" | "session.first" | "session.last" | "prompt.clear" | "prompt.submit" | "agent.cycle") | string;
  };
};

export type tui_prompt_append = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "tui.prompt.append";
  location?: Location_Ref;
  data: {
    text: string;
  };
};

export type tui_session_select = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "tui.session.select";
  location?: Location_Ref;
  data: {
    sessionID: Session_ID & unknown;
  };
};

export type tui_toast_show = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "tui.toast.show";
  location?: Location_Ref;
  data: {
    title?: string;
    message: string;
    variant: "info" | "success" | "warning" | "error";
    duration?: number | null;
  };
};

export type vcs_branch_updated = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "vcs.branch.updated";
  location?: Location_Ref;
  data: {
    branch?: string;
  };
};

export type websearch_updated = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "websearch.updated";
  location?: Location_Ref;
  data: unknown;
};

export type worktree_resolved = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "worktree.resolved";
  durable: {
    aggregateID: string;
    seq: Event_Seq;
    version: Event_VersionEncoded_c77c5abcb68d;
  };
  location?: Location_Ref;
  data: {
    projectID: Project_ID;
    directory: AbsolutePath;
    previous: Project_ID;
    adopted?: Array<Project_ID>;
  };
};

export type worktree_updated = {
  id: Event_ID;
  created: number;
  metadata?: Record<string, unknown>;
  type: "worktree.updated";
  location?: Location_Ref;
  data: {
    projectID: Project_ID;
  };
};

/**
 * Every operation the pinned OpenAPI document declares: HTTP method, path
 * template, and whether the success response is a `text/event-stream`.
 *
 * `sse` is the load-bearing column — reading a JSON endpoint as a stream
 * (or the reverse) is exactly the mistake this table makes impossible to
 * hold for long, because upstream flipping it fails CI's `git diff`.
 */
export const OPENCODE_OPERATIONS = {
  "agent.get": { method: "GET", path: "/api/agent/{agentID}", sse: false },
  "agent.list": { method: "GET", path: "/api/agent", sse: false },
  "command.list": { method: "GET", path: "/api/command", sse: false },
  "config.get": { method: "GET", path: "/api/config", sse: false },
  "config.shells": { method: "GET", path: "/api/config/shell", sse: false },
  "credential.activate": { method: "POST", path: "/api/credential/{credentialID}/activate", sse: false },
  "credential.create": { method: "POST", path: "/api/credential", sse: false },
  "credential.list": { method: "GET", path: "/api/credential", sse: false },
  "credential.remove": { method: "DELETE", path: "/api/credential/{credentialID}", sse: false },
  "credential.update": { method: "PATCH", path: "/api/credential/{credentialID}", sse: false },
  "debug.heapDump": { method: "POST", path: "/api/debug/heap-dump", sse: false },
  "debug.location.evict": { method: "DELETE", path: "/api/debug/location", sse: false },
  "debug.location.list": { method: "GET", path: "/api/debug/location", sse: false },
  "event.subscribe": { method: "GET", path: "/api/event", sse: true },
  "experimental.artifacts.create": { method: "POST", path: "/api/experimental/artifacts", sse: false },
  "experimental.artifacts.delete": { method: "DELETE", path: "/api/experimental/artifacts/{artifactID}", sse: false },
  "experimental.artifacts.get": { method: "GET", path: "/api/experimental/artifacts/{artifactID}", sse: false },
  "experimental.artifacts.list": { method: "GET", path: "/api/experimental/artifacts", sse: false },
  "experimental.artifacts.providers": { method: "GET", path: "/api/experimental/artifacts/providers", sse: false },
  "experimental.artifacts.update": { method: "PATCH", path: "/api/experimental/artifacts/{artifactID}", sse: false },
  "experimental.artifacts.view": { method: "GET", path: "/api/experimental/artifacts/{artifactID}/view/*", sse: false },
  "experimental.config.update": { method: "PATCH", path: "/api/experimental/config", sse: false },
  "experimental.fs.unwatch": { method: "DELETE", path: "/api/experimental/fs/watch", sse: false },
  "experimental.fs.watch": { method: "POST", path: "/api/experimental/fs/watch", sse: false },
  "experimental.fs.write": { method: "POST", path: "/api/experimental/fs/write", sse: false },
  "experimental.generate.decisions": { method: "POST", path: "/api/experimental/generate/decisions", sse: false },
  "experimental.generate.image": { method: "POST", path: "/api/experimental/generate/image", sse: false },
  "experimental.generate.text": { method: "POST", path: "/api/experimental/generate/text", sse: false },
  "experimental.generate.textLegacy": { method: "POST", path: "/api/experimental/generate", sse: false },
  "experimental.integration.wellknown.add": { method: "POST", path: "/api/experimental/integration/wellknown", sse: false },
  "experimental.job.list": { method: "GET", path: "/api/experimental/job", sse: false },
  "experimental.mcp.add": { method: "PUT", path: "/api/experimental/mcp/{server}", sse: false },
  "experimental.mcp.client": { method: "GET", path: "/api/experimental/client-mcp", sse: false },
  "experimental.mcp.client.token": { method: "POST", path: "/api/experimental/client-mcp/token", sse: false },
  "experimental.mcp.connect": { method: "POST", path: "/api/experimental/mcp/{server}/connect", sse: false },
  "experimental.mcp.disconnect": { method: "POST", path: "/api/experimental/mcp/{server}/disconnect", sse: false },
  "experimental.mcp.remove": { method: "DELETE", path: "/api/experimental/mcp/{server}", sse: false },
  "experimental.media.get": { method: "GET", path: "/api/experimental/media/{hash}", sse: false },
  "experimental.migration.v1.status": { method: "GET", path: "/api/experimental/migration/v1", sse: false },
  "experimental.persistentPty.connect": { method: "GET", path: "/api/experimental/persistent-pty/{ptyID}/connect", sse: false },
  "experimental.persistentPty.connectToken": { method: "POST", path: "/api/experimental/persistent-pty/{ptyID}/connect-token", sse: false },
  "experimental.persistentPty.create": { method: "POST", path: "/api/experimental/session/{sessionID}/terminal", sse: false },
  "experimental.persistentPty.get": { method: "GET", path: "/api/experimental/persistent-pty/{ptyID}", sse: false },
  "experimental.persistentPty.handoff": { method: "POST", path: "/api/experimental/persistent-pty/handoff", sse: false },
  "experimental.persistentPty.list": { method: "GET", path: "/api/experimental/session/{sessionID}/terminal", sse: false },
  "experimental.persistentPty.read": { method: "GET", path: "/api/experimental/session/{sessionID}/terminal/read", sse: false },
  "experimental.persistentPty.remove": { method: "DELETE", path: "/api/experimental/persistent-pty/{ptyID}", sse: false },
  "experimental.persistentPty.shutdown": { method: "POST", path: "/api/experimental/persistent-pty/shutdown", sse: false },
  "experimental.persistentPty.snapshot": { method: "GET", path: "/api/experimental/persistent-pty/{ptyID}/snapshot", sse: false },
  "experimental.persistentPty.update": { method: "PUT", path: "/api/experimental/persistent-pty/{ptyID}", sse: false },
  "experimental.schedule.create": { method: "POST", path: "/api/experimental/schedule", sse: false },
  "experimental.schedule.delete": { method: "DELETE", path: "/api/experimental/schedule/{scheduleID}", sse: false },
  "experimental.schedule.get": { method: "GET", path: "/api/experimental/schedule/{scheduleID}", sse: false },
  "experimental.schedule.list": { method: "GET", path: "/api/experimental/schedule", sse: false },
  "experimental.schedule.pause": { method: "POST", path: "/api/experimental/schedule/{scheduleID}/pause", sse: false },
  "experimental.schedule.resume": { method: "POST", path: "/api/experimental/schedule/{scheduleID}/resume", sse: false },
  "experimental.session.export": { method: "GET", path: "/api/experimental/session/{sessionID}/export", sse: false },
  "experimental.session.import": { method: "POST", path: "/api/experimental/session/import", sse: false },
  "experimental.session.instructions.entry.list": { method: "GET", path: "/api/experimental/session/{sessionID}/instructions/entries", sse: false },
  "experimental.session.instructions.entry.put": { method: "PUT", path: "/api/experimental/session/{sessionID}/instructions/entries/{key}", sse: false },
  "experimental.session.instructions.entry.remove": { method: "DELETE", path: "/api/experimental/session/{sessionID}/instructions/entries/{key}", sse: false },
  "experimental.session.log": { method: "GET", path: "/api/experimental/session/{sessionID}/log", sse: true },
  "experimental.session.skill": { method: "POST", path: "/api/experimental/session/{sessionID}/skill", sse: false },
  "experimental.session.stats": { method: "GET", path: "/api/experimental/session/stats", sse: false },
  "experimental.session.wait": { method: "POST", path: "/api/experimental/session/{sessionID}/wait", sse: false },
  "experimental.usage.limits": { method: "GET", path: "/api/experimental/usage/limits", sse: false },
  "experimental.voice.models": { method: "GET", path: "/api/experimental/voice/models", sse: false },
  "experimental.voice.session": { method: "POST", path: "/api/experimental/voice/session", sse: false },
  "form.list": { method: "GET", path: "/api/form", sse: false },
  "fs.find": { method: "GET", path: "/api/fs/find", sse: false },
  "fs.list": { method: "GET", path: "/api/fs/list", sse: false },
  "fs.read": { method: "GET", path: "/api/fs/read/*", sse: false },
  "integration.command.cancel": { method: "DELETE", path: "/api/integration/{integrationID}/connect/command/{attemptID}", sse: false },
  "integration.command.connect": { method: "POST", path: "/api/integration/{integrationID}/connect/command", sse: false },
  "integration.command.status": { method: "GET", path: "/api/integration/{integrationID}/connect/command/{attemptID}", sse: false },
  "integration.connect.external": { method: "POST", path: "/api/integration/{integrationID}/connect/external", sse: false },
  "integration.connect.key": { method: "POST", path: "/api/integration/{integrationID}/connect/key", sse: false },
  "integration.get": { method: "GET", path: "/api/integration/{integrationID}", sse: false },
  "integration.list": { method: "GET", path: "/api/integration", sse: false },
  "integration.oauth.cancel": { method: "DELETE", path: "/api/integration/{integrationID}/connect/oauth/{attemptID}", sse: false },
  "integration.oauth.complete": { method: "POST", path: "/api/integration/{integrationID}/connect/oauth/{attemptID}/complete", sse: false },
  "integration.oauth.connect": { method: "POST", path: "/api/integration/{integrationID}/connect/oauth", sse: false },
  "integration.oauth.status": { method: "GET", path: "/api/integration/{integrationID}/connect/oauth/{attemptID}", sse: false },
  "location.get": { method: "GET", path: "/api/location", sse: false },
  "location.reload": { method: "POST", path: "/api/location/reload", sse: false },
  "mcp.list": { method: "GET", path: "/api/mcp", sse: false },
  "mcp.resource.catalog": { method: "GET", path: "/api/mcp/resource", sse: false },
  "model.default": { method: "GET", path: "/api/model/default", sse: false },
  "model.list": { method: "GET", path: "/api/model", sse: false },
  "permission.request.list": { method: "GET", path: "/api/permission/request", sse: false },
  "permission.saved.list": { method: "GET", path: "/api/permission/saved", sse: false },
  "permission.saved.remove": { method: "DELETE", path: "/api/permission/saved/{id}", sse: false },
  "permission.saved.update": { method: "PATCH", path: "/api/permission/saved/{id}", sse: false },
  "plugin.check": { method: "POST", path: "/api/plugin/check", sse: false },
  "plugin.gui": { method: "GET", path: "/api/plugin/gui", sse: false },
  "plugin.list": { method: "GET", path: "/api/plugin", sse: false },
  "plugin.update": { method: "POST", path: "/api/plugin/update", sse: false },
  "project.list": { method: "GET", path: "/api/project", sse: false },
  "project.update": { method: "PATCH", path: "/api/project/{projectID}", sse: false },
  "provider.get": { method: "GET", path: "/api/provider/{providerID}", sse: false },
  "provider.list": { method: "GET", path: "/api/provider", sse: false },
  "pty.connect": { method: "GET", path: "/api/pty/{ptyID}/connect", sse: false },
  "pty.connect.token": { method: "POST", path: "/api/pty/{ptyID}/connect-token", sse: false },
  "pty.create": { method: "POST", path: "/api/pty", sse: false },
  "pty.get": { method: "GET", path: "/api/pty/{ptyID}", sse: false },
  "pty.list": { method: "GET", path: "/api/pty", sse: false },
  "pty.remove": { method: "DELETE", path: "/api/pty/{ptyID}", sse: false },
  "pty.update": { method: "PUT", path: "/api/pty/{ptyID}", sse: false },
  "reference.list": { method: "GET", path: "/api/reference", sse: false },
  "rpc.call": { method: "POST", path: "/api/rpc/{rpcID}/{method}", sse: false },
  "server.connect": { method: "GET", path: "/auth/connect/{code}", sse: false },
  "server.info": { method: "GET", path: "/api/info", sse: false },
  "server.pair": { method: "POST", path: "/api/pair", sse: false },
  "session.active": { method: "GET", path: "/api/session/active", sse: false },
  "session.background": { method: "POST", path: "/api/session/{sessionID}/background", sse: false },
  "session.command": { method: "POST", path: "/api/session/{sessionID}/command", sse: false },
  "session.compact": { method: "POST", path: "/api/session/{sessionID}/compact", sse: false },
  "session.context": { method: "GET", path: "/api/session/{sessionID}/context", sse: false },
  "session.create": { method: "POST", path: "/api/session", sse: false },
  "session.diff": { method: "GET", path: "/api/session/{sessionID}/diff", sse: false },
  "session.environment": { method: "PUT", path: "/api/session/{sessionID}/environment", sse: false },
  "session.fork": { method: "POST", path: "/api/session/{sessionID}/fork", sse: false },
  "session.form.cancel": { method: "DELETE", path: "/api/session/{sessionID}/form/{formID}", sse: false },
  "session.form.create": { method: "POST", path: "/api/session/{sessionID}/form", sse: false },
  "session.form.get": { method: "GET", path: "/api/session/{sessionID}/form/{formID}", sse: false },
  "session.form.list": { method: "GET", path: "/api/session/{sessionID}/form", sse: false },
  "session.form.reply": { method: "POST", path: "/api/session/{sessionID}/form/{formID}/reply", sse: false },
  "session.generate": { method: "POST", path: "/api/session/{sessionID}/generate", sse: false },
  "session.get": { method: "GET", path: "/api/session/{sessionID}", sse: false },
  "session.inbox.cancel": { method: "DELETE", path: "/api/session/{sessionID}/inbox/{inboxID}", sse: false },
  "session.inbox.list": { method: "GET", path: "/api/session/{sessionID}/inbox", sse: false },
  "session.inbox.update": { method: "PATCH", path: "/api/session/{sessionID}/inbox/{inboxID}", sse: false },
  "session.interrupt": { method: "POST", path: "/api/session/{sessionID}/interrupt", sse: false },
  "session.list": { method: "GET", path: "/api/session", sse: false },
  "session.message.get": { method: "GET", path: "/api/session/{sessionID}/message/{messageID}", sse: false },
  "session.message.list": { method: "GET", path: "/api/session/{sessionID}/message", sse: false },
  "session.move": { method: "POST", path: "/api/session/{sessionID}/move", sse: false },
  "session.permission.create": { method: "POST", path: "/api/session/{sessionID}/permission", sse: false },
  "session.permission.get": { method: "GET", path: "/api/session/{sessionID}/permission/{requestID}", sse: false },
  "session.permission.list": { method: "GET", path: "/api/session/{sessionID}/permission", sse: false },
  "session.permission.reply": { method: "POST", path: "/api/session/{sessionID}/permission/{requestID}/reply", sse: false },
  "session.prompt": { method: "POST", path: "/api/session/{sessionID}/prompt", sse: false },
  "session.remove": { method: "DELETE", path: "/api/session/{sessionID}", sse: false },
  "session.revert.clear": { method: "DELETE", path: "/api/session/{sessionID}/revert", sse: false },
  "session.revert.commit": { method: "POST", path: "/api/session/{sessionID}/revert/commit", sse: false },
  "session.revert.stage": { method: "POST", path: "/api/session/{sessionID}/revert/stage", sse: false },
  "session.shell": { method: "POST", path: "/api/session/{sessionID}/shell", sse: false },
  "session.switchAgent": { method: "POST", path: "/api/session/{sessionID}/agent", sse: false },
  "session.switchModel": { method: "POST", path: "/api/session/{sessionID}/model", sse: false },
  "session.synthetic": { method: "POST", path: "/api/session/{sessionID}/synthetic", sse: false },
  "session.update": { method: "PATCH", path: "/api/session/{sessionID}", sse: false },
  "session.view": { method: "POST", path: "/api/session/{sessionID}/view", sse: false },
  "shell.create": { method: "POST", path: "/api/shell", sse: false },
  "shell.get": { method: "GET", path: "/api/shell/{id}", sse: false },
  "shell.list": { method: "GET", path: "/api/shell", sse: false },
  "shell.output": { method: "GET", path: "/api/shell/{id}/output", sse: false },
  "shell.remove": { method: "DELETE", path: "/api/shell/{id}", sse: false },
  "skill.list": { method: "GET", path: "/api/skill", sse: false },
  "vcs.base": { method: "GET", path: "/api/vcs/base", sse: false },
  "vcs.branch.list": { method: "GET", path: "/api/vcs/branch", sse: false },
  "vcs.diff": { method: "GET", path: "/api/vcs/diff", sse: false },
  "vcs.get": { method: "GET", path: "/api/vcs", sse: false },
  "vcs.init": { method: "POST", path: "/api/vcs/init", sse: false },
  "vcs.status": { method: "GET", path: "/api/vcs/status", sse: false },
  "websearch.providers": { method: "GET", path: "/api/websearch/provider", sse: false },
  "websearch.query": { method: "POST", path: "/api/websearch", sse: false },
  "worktree.create": { method: "POST", path: "/api/worktree", sse: false },
  "worktree.list": { method: "GET", path: "/api/worktree", sse: false },
  "worktree.refresh": { method: "POST", path: "/api/worktree/refresh", sse: false },
  "worktree.remove": { method: "DELETE", path: "/api/worktree", sse: false },
} as const;

/** Operation ids present in the pinned document. */
export type OpencodeOperationId = keyof typeof OPENCODE_OPERATIONS;
