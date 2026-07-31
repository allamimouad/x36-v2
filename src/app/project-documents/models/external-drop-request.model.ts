import type { FolderNode } from './file-system-node.model';

export interface ExternalFolderDropRequest {
    event: DragEvent;
    target: FolderNode;
}
