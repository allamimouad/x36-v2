import type { FileSystemNode } from './file-system-node.model';

export interface NodeContextMenuRequest {
    event: MouseEvent;
    node: FileSystemNode;
    source: 'tree' | 'table';
}

export interface ItemRenameRequest {
    node: FileSystemNode;
    name: string;
}
