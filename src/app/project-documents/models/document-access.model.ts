/** Access decisions supplied by the document backend. Missing access means normal access. */
export const FolderNodeResponseAccessLevelEnum = {
    Readonly: 'READONLY',
    Protected: 'PROTECTED'
} as const;

export type FolderNodeResponseAccessLevelEnum =
    typeof FolderNodeResponseAccessLevelEnum[keyof typeof FolderNodeResponseAccessLevelEnum];

export const FileNodeResponseAccessLevelEnum = { Readonly: 'READONLY' } as const;

export type FileNodeResponseAccessLevelEnum =
    typeof FileNodeResponseAccessLevelEnum[keyof typeof FileNodeResponseAccessLevelEnum];
