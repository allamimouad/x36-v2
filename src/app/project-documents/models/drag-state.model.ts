import type { FileSystemNode } from './file-system-node.model';

export const INTERNAL_DRAG_TYPE = 'application/x-project-documents-item';

export type DragSurface = 'tree' | 'table' | 'current-folder';
/** Assigned straight to `dataTransfer.dropEffect`, which accepts no other values. */
export type DragEffect = 'move' | 'copy';

/**
 * What a drop will actually do. Resolved from the target, not the keyboard: a recycle
 * bin means delete. Kept apart from `DragEffect` because the native drop effect has no
 * `delete` — a delete still shows `move`, since the item leaves either way.
 */
export type DropIntent = DragEffect | 'delete';

export interface ItemDragRequest {
    event: DragEvent;
    node: FileSystemNode;
    /**
     * Rows selected when the gesture began. Dragging a row inside the selection drags
     * the whole selection; dragging one outside it drags that row alone. Empty for
     * surfaces without selection, such as the tree.
     */
    selectedIds?: ReadonlySet<string>;
    /**
     * The selected rows themselves, for surfaces whose rows are not in the cache —
     * every search result is one. Without them a multi-item drag from such a surface
     * cannot resolve its own selection and is refused outright.
     */
    selectedNodes?: readonly FileSystemNode[];
}

export interface DragContext {
    writingIds: ReadonlySet<string>;
    editingIds: ReadonlySet<string>;
    blocked: boolean;
}

export interface DragState {
    token: string;
    projectId: string;
    /**
     * The nodes being dragged, already collapsed to top-most ancestors: a selection
     * holding a folder and something inside it drags the folder only, or the
     * descendant's path would change underneath its own queued request.
     */
    sourceIds: readonly string[];
    effect: DragEffect;
}

export interface DragTarget {
    id: string;
    surface: DragSurface;
}

export interface ItemDropRequest {
    event: DragEvent;
    targetId: string | null;
}

export function hasInternalDragType(event: DragEvent): boolean {
    return Array.from(event.dataTransfer?.types ?? []).includes(INTERNAL_DRAG_TYPE);
}
