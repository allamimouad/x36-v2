import type { FileSystemNode } from '../models/file-system-node.model';

const INVALID_CHARS = /[\\/:*?"<>|]/;
const MAX_NAME_LENGTH = 128;

export type NameValidationResult =
  | { valid: true }
  | { valid: false; reason: 'empty' | 'reserved' | 'invalid-chars' | 'too-long' };

export function validateName(name: string): NameValidationResult {
    const trimmed = name.trim();
    if (trimmed.length === 0) { return { valid: false, reason: 'empty' }; }
    if (trimmed === '.' || trimmed === '..') { return { valid: false, reason: 'reserved' }; }
    if (INVALID_CHARS.test(trimmed)) { return { valid: false, reason: 'invalid-chars' }; }
    if (trimmed.length > MAX_NAME_LENGTH) { return { valid: false, reason: 'too-long' }; }

    return { valid: true };
}

export function resolveNameCollision(
    baseName: string,
    existingNames: Iterable<string>,
    firstSuffix = 2
): string {
    const existing = new Set(Array.from(existingNames, (name) => name.toLocaleLowerCase()));
    if (!existing.has(baseName.toLocaleLowerCase())) { return baseName; }

    const { base, ext } = splitFileName(baseName);
    const extension = ext ? `.${ext}` : '';
    let suffix = firstSuffix;
    while (true) {
        const candidate = `${base} (${suffix})${extension}`;
        if (!existing.has(candidate.toLocaleLowerCase())) { return candidate; }
        suffix += 1;
    }
}

/**
 * A file name split at its last dot, with `ext` carrying no dot of its own.
 *
 * A leading dot is part of the name (`.gitignore` has no extension), and so is a
 * trailing one (`report.` is a name ending in a dot, not an empty extension) — both
 * would otherwise produce an empty half that callers then rebuild wrongly.
 */
export function splitFileName(name: string): { base: string; ext: string } {
    const dot = name.lastIndexOf('.');
    if (dot <= 0 || dot === name.length - 1) { return { base: name, ext: '' }; }

    return { base: name.slice(0, dot), ext: name.slice(dot + 1) };
}

/**
 * What an inline rename puts in the box: a file's extension is withheld so it cannot be
 * edited away by accident, a folder's whole name is offered.
 *
 * Shared by both tables. The surrounding plumbing — the `viewChild`s, the focus effects
 * and the event emitters — stays duplicated in each component on purpose: `viewChild`
 * and `effect` belong to the component that owns the elements, and extracting
 * three-line emitters would buy indirection rather than meaning.
 */
export function editableName(node: FileSystemNode): string {
    return node.kind === 'file' ? splitFileName(node.name).base : node.name;
}

/** The name an inline rename submits, putting back the extension `editableName` held. */
export function submittedName(node: FileSystemNode, edited: string): string {
    if (node.kind === 'folder') { return edited; }
    const { ext } = splitFileName(node.name);
    const trimmedBase = edited.trim();

    return ext && trimmedBase ? `${trimmedBase}.${ext}` : edited;
}
