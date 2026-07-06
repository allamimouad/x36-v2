export type FileSystemErrorCode =
  | 'not-found'
  | 'name-collision'
  | 'invalid-name'
  | 'descendant-move'
  | 'permission-denied'
  | 'network'
  | 'cancelled'
  | 'unknown';

export class FileSystemError extends Error {
    constructor(
        public readonly code: FileSystemErrorCode,
        message: string,
        public override readonly cause?: unknown
    ) {
        super(message);
        this.name = 'FileSystemError';
    }
}
