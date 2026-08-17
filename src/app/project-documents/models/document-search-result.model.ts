import type { FileSystemNode } from './file-system-node.model';

/**
 * A canonical application node returned by recursive search, plus the list-relative
 * paths needed by the address-bar resolver. `path` on the node remains the normal
 * backend path (for SharePoint, its server-relative URL).
 */
export type DocumentSearchResult = FileSystemNode & {
    /** Canonical list-relative path to the matched item. */
    listRelativePath: string;
    /** Canonical list-relative path to the matched item's containing folder. */
    parentListRelativePath: string;
};

export interface DocumentSearchResponse {
    results: DocumentSearchResult[];
    totalMatches: number;
    truncated: boolean;
}
