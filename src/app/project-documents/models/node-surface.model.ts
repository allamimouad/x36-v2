import type { FileSystemNode } from './file-system-node.model';

/**
 * Which list a row was acted on from. The two tables carry a selection and the tree does
 * not, so several actions read differently depending on where the click came from.
 */
export type NodeSurface = 'tree' | 'table' | 'search';

/** A delete awaiting its inline confirmation, and the surface showing that confirmation. */
export interface PendingDelete {
    node: FileSystemNode;
    surface: NodeSurface;
}
