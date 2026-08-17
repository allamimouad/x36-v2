import type { FileSystemNode } from './file-system-node.model';
import type { DocumentSearchResult } from './document-search-result.model';

export interface NodeContextMenuRequest {
    event: MouseEvent;
    node: FileSystemNode;
    source: 'tree' | 'table';
}

export interface ItemRenameRequest {
    node: FileSystemNode;
    name: string;
}

export interface SearchResultContextMenuRequest {
    event: MouseEvent;
    result: DocumentSearchResult;
}
