/**
 * An opaque id for one credential. It is not a secret and says nothing about which
 * broker it belongs to; the backend prefixes it with its own namespace before it
 * reaches the store, and validates it against `[A-Za-z0-9_-]`.
 */
export function newSecretRef(): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '')
      : `${Date.now()}${Math.floor(Math.random() * 1e9)}`;
  return random.slice(0, 16);
}
