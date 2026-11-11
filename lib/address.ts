const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/** True for "0x" followed by 40 hex characters. */
export function isAddress(value: string): boolean {
  return ADDRESS_PATTERN.test(value);
}

/** Trim and lower-case an address. Returns null when it is not valid. */
export function normalizeAddress(value: string): string | null {
  const trimmed = value.trim();
  return isAddress(trimmed) ? trimmed.toLowerCase() : null;
}
