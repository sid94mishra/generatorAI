export interface AndroidManifestLike {
  manifest: { application?: Array<{ $?: Record<string, string> }> };
}
export function setUsesCleartextTraffic<T extends AndroidManifestLike>(manifest: T): T;
