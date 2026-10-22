export const FolderNodeResponseAccessLevelEnum = {
    Readonly: 'READONLY',
    Protected: 'PROTECTED'
} as const;

export type FolderNodeResponseAccessLevelEnum =
    typeof FolderNodeResponseAccessLevelEnum[keyof typeof FolderNodeResponseAccessLevelEnum];
