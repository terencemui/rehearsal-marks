import type { Marker } from '../domain/marker';

/** Test fixture for a domain marker with sensible defaults. */
export function marker(
  id: string,
  time: number,
  aliases: string[] = [],
  createdAt = 0,
): Marker {
  return { id, time, aliases, createdAt };
}
