/**
 * Recording identity — the hash that makes a label set applicable to exactly
 * one recording. Computed once at import and stored in `audioMeta.sha256`;
 * used later for label-set validation and library-cache verification.
 */
export async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
