/** Decode RFC 5987 names, stripping directory components before native saving. */
export function artifactDownloadName(disposition: string | null, fallback: string): string {
  const extended = disposition?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  const quoted = disposition?.match(/filename="([^"]*)"/i)?.[1];
  const bare = disposition?.match(/filename=([^;]+)/i)?.[1];
  let value = quoted ?? bare?.trim() ?? fallback;
  if (extended) { try { value = decodeURIComponent(extended.trim()); } catch { /* use basic filename */ } }
  const name = value.replace(/\\/g, '/').split('/').pop()?.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return name && name !== '.' && name !== '..' ? name : fallback;
}
