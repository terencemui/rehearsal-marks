/**
 * Recording identity — the hash that makes a label set applicable to exactly
 * one recording. Computed once at import and stored in `audioMeta.sha256`;
 * used later for label-set validation and library-cache verification.
 * Accepts raw bytes so callers that already hold the audio in memory (zip
 * import) don't have to copy it through a fresh Blob read.
 */
export async function sha256(data: Blob | Uint8Array): Promise<string> {
  const bytes = data instanceof Blob ? await data.arrayBuffer() : data;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
