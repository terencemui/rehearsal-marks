/**
 * The one place a user's data leaves the browser: a named download of an
 * in-memory blob, through a one-shot anchor. App takes this as an injectable
 * seam so tests capture downloads instead of touching the browser's URL API.
 */
export function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  // Safari ignores programmatic clicks on detached elements.
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // The browser fetches the blob URL after the click handler returns;
  // revoking in the same task aborts the download on some engines.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
