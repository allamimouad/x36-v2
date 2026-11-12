/**
 * Declared as a real `enum`, matching the generated client. A `const` object with a
 * union type would accept a raw `'READONLY'` string, which the generated type rejects:
 * keeping the stricter form means a fixture that writes the string fails here rather
 * than at integration.
 */
export enum FolderNodeResponseAccessLevelEnum {
    Readonly = 'READONLY',
    Protected = 'PROTECTED'
}
