import type { FileSystemNode } from './file-system-node.model';

export const INTERNAL_DRAG_TYPE = 'application/x-project-documents-item';

export type DragSurface = 'tree' | 'table' | 'current-folder';
export type DragEffect = 'move' | 'copy';

export interface ItemDragRequest {
    event: DragEvent;
    node: FileSystemNode;
}

export interface DragContext {
    writingIds: ReadonlySet<string>;
    editingIds: ReadonlySet<string>;
    blocked: boolean;
}

export interface DragState {
    token: string;
    projectId: string;
    sourceId: string;
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
