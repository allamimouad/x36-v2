export const FileNodeResponseAccessLevelEnum = { Readonly: 'READONLY' } as const;

export type FileNodeResponseAccessLevelEnum =
    typeof FileNodeResponseAccessLevelEnum[keyof typeof FileNodeResponseAccessLevelEnum];
