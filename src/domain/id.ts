/** Generates a uuid v4 for marker and project ids. */
export function newId(): string {
  return crypto.randomUUID();
}
