const INVALID_CHARS = /[\\/:*?"<>|]/;
const MAX_NAME_LENGTH = 128;

export type NameValidationResult =
  | { valid: true }
  | { valid: false; reason: 'empty' | 'reserved' | 'invalid-chars' | 'too-long' };

export function validateName(name: string): NameValidationResult {
  const trimmed = name.trim();
  if (trimmed.length === 0) return { valid: false, reason: 'empty' };
  if (trimmed === '.' || trimmed === '..') return { valid: false, reason: 'reserved' };
  if (INVALID_CHARS.test(trimmed)) return { valid: false, reason: 'invalid-chars' };
  if (trimmed.length > MAX_NAME_LENGTH) return { valid: false, reason: 'too-long' };
  return { valid: true };
}
