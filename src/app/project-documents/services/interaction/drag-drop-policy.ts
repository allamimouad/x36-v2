import { FolderNodeResponseAccessLevelEnum } from '@api/model/folderNodeResponse';
import type { DocumentListKey } from '../../models/document-list.model';
import type { DragContext, DropIntent } from '../../models/drag-state.model';
import type { FileSystemNode, FolderNode } from '../../models/file-system-node.model';
import { containsNode } from '../../utils/node-containment.utils';

export interface DragPolicy extends DragContext {
    entities: Record<string, FileSystemNode>;
    recycleBins: readonly FolderNode[];
    readonlyLists: ReadonlyMap<DocumentListKey, boolean>;
    unavailableIds: ReadonlySet<string>;
}

export function isInRecycleBin(node: FileSystemNode, policy: DragPolicy): boolean {
    return policy.recycleBins.some((bin) => containsNode(bin, node, policy.entities));
}

function isBusy(node: FileSystemNode, policy: DragPolicy): boolean {
    return [...policy.writingIds, ...policy.editingIds]
        .some((id) => {
            const other = policy.entities[id];

            return other !== undefined &&
                (containsNode(other, node, policy.entities) ||
                    containsNode(node, other, policy.entities));
        });
}

function isUnavailable(node: FileSystemNode, policy: DragPolicy): boolean {
    return [...policy.unavailableIds].some((id) => {
        const unavailable = policy.entities[id];

        return unavailable !== undefined && containsNode(unavailable, node, policy.entities);
    });
}

export function canStartDrag(node: FileSystemNode, policy: DragPolicy): boolean {
    return !policy.blocked && node.parentId !== null &&
        policy.entities[node.parentId] !== undefined &&
        !isInRecycleBin(node, policy) && !isBusy(node, policy) && !isUnavailable(node, policy);
}

function isReadonly(node: FileSystemNode, policy: DragPolicy): boolean {
    return node.accessLevel === FolderNodeResponseAccessLevelEnum.Readonly ||
        policy.readonlyLists.get(node.listKey) === true;
}

export function canDropItem(
    source: FileSystemNode,
    target: FolderNode,
    intent: DropIntent,
    policy: DragPolicy
): boolean {
    if (!canStartDrag(source, policy) || isReadonly(target, policy) ||
        isBusy(target, policy) || isUnavailable(target, policy)) {
        return false;
    }
    if (intent === 'delete') { return canDeleteItem(source, target, policy); }
    if (isInRecycleBin(target, policy)) { return false; }
    if (containsNode(source, target, policy.entities)) { return false; }
    if (intent === 'copy') { return true; }

    return canMoveItem(source, target, policy);
}

/**
 * Dropping on a bin deletes. Only the bin of the source's own list may accept it: the
 * backend routes a deleted item to its own list's bin whichever one was aimed at, so
 * any other bin would show the item going somewhere it will not go. Records already
 * inside a bin are not bins themselves, so they still reject drops.
 */
function canDeleteItem(
    source: FileSystemNode,
    target: FolderNode,
    policy: DragPolicy
): boolean {
    return target.isRecycleBin && target.listKey === source.listKey &&
        canLeaveParent(source, policy);
}

function canMoveItem(source: FileSystemNode, target: FolderNode, policy: DragPolicy): boolean {
    return source.parentId !== target.id && canLeaveParent(source, policy);
}

/** Source-side rules shared by move and delete: may this item leave where it is? */
function canLeaveParent(source: FileSystemNode, policy: DragPolicy): boolean {
    const parent = source.parentId === null ? undefined : policy.entities[source.parentId];

    return parent !== undefined &&
        source.accessLevel !== FolderNodeResponseAccessLevelEnum.Protected &&
        !isReadonly(source, policy) && !isReadonly(parent, policy);
}
