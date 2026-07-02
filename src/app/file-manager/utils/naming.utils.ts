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

export function resolveNameCollision(baseName: string, existingNames: Iterable<string>): string {
    const existing = new Set(Array.from(existingNames, (name) => name.toLocaleLowerCase()));
    if (!existing.has(baseName.toLocaleLowerCase())) return baseName;

    const { stem, extension } = splitExtension(baseName);
    let suffix = 2;
    while (true) {
        const candidate = `${stem} (${suffix})${extension}`;
        if (!existing.has(candidate.toLocaleLowerCase())) return candidate;
        suffix += 1;
    }
}

function splitExtension(name: string): { stem: string; extension: string } {
    const idx = name.lastIndexOf('.');
    if (idx <= 0 || idx === name.length - 1) {
        return { stem: name, extension: '' };
    }
    return {
        stem: name.slice(0, idx),
        extension: name.slice(idx)
    };
}
