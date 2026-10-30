export interface ComputerFrameView {
  id: string;
  createdAt: string;
  width?: number;
  height?: number;
}

export interface ComputerActivityView {
  action: string;
  appLabel: string;
  target: string | null;
  path: string | null;
  verified?: boolean;
  refusalCode: string | null;
  artifactId: string | null;
  createdAt: string;
}

/** Resource URLs consumed by authenticated native hosts and WebSockets. */
const enc = encodeURIComponent;
const workspace = (id: string) => `/api/workspaces/${enc(id)}`;
export const resourcePaths = {
  terminalStream: (id: string, sid: string) => `${workspace(id)}/terminals/${enc(sid)}/stream`,
  browserFile: (id: string, path: string) => {
    const clean = path.replace(/\\/g, '/').replace(/^\/+/, '');
    return `${workspace(id)}/browser/files/${clean.split('/').map(enc).join('/')}`;
  },
  voiceStream: (kind: 'stt' | 'tts') => `/api/${kind}/stream`,
};
export interface BinaryResource { data: Uint8Array; contentType: string }
export interface BrowserDescriptorView {
  status?: string;
  mode?: string;
  canGoBack?: boolean;
  canGoForward?: boolean;
  ready?: boolean;
  currentUrl?: string | null;
  viewport?: { width: number; height: number };
  attachedToChat?: boolean;
  title?: string;
}

type JsonRequest = <T>(path: string, init?: RequestInit) => Promise<T>;
type BinaryRequest = (path: string, init?: RequestInit) => Promise<BinaryResource>;

export function createResourceMethods(request: JsonRequest, binary: BinaryRequest) {
  return {
    terminalLines: (id: string, sid: string, tailLines: number) => {
      const count = Math.max(1, Math.min(5_000, Math.floor(tailLines)));
      return request<{ lines?: string[] }>(`${workspace(id)}/terminals/${enc(sid)}/scrollback?format=text&tailLines=${count}`);
    },
    terminalBytes: (id: string, sid: string, tailBytes: number) =>
      binary(`${workspace(id)}/terminals/${enc(sid)}/scrollback?tailBytes=${Math.max(1, Math.floor(tailBytes))}`),
    browserDescriptor: (id: string) => request<BrowserDescriptorView>(`${workspace(id)}/browser/descriptor`),
    browserCapture: (id: string, clip: { x: number; y: number; width: number; height: number }) =>
      binary(`${workspace(id)}/browser/capture`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clip }) }),
    browserScreencast: (id: string, quality: number, cacheKey: number) =>
      binary(`${workspace(id)}/browser/screencast.jpg?quality=${quality}&k=${cacheKey}`),
    computerFrames: (id: string) => request<{ enabled?: boolean; frames?: ComputerFrameView[] }>(`${workspace(id)}/computer/frames`),
    computerActivity: (id: string) => request<{ entries?: ComputerActivityView[] }>(`${workspace(id)}/computer/activity`),
    computerFrame: (id: string, frameId: string) => binary(`${workspace(id)}/computer/frames/${enc(frameId)}`),
  };
}
