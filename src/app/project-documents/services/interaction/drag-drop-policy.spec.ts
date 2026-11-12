import { FolderNodeResponseAccessLevelEnum as Access } from '@api/model/folderNodeResponse';
import type { FileSystemNode, FolderNode } from '../../models/file-system-node.model';
import { containsNode } from '../../utils/node-containment.utils';
import { canDropItem, canStartDrag, type DragPolicy } from './drag-drop-policy';

describe('internal drag policy', () => {
    let root: FolderNode;
    let source: FolderNode;
    let target: FolderNode;
    let policy: DragPolicy;

    function folder(id: string, parentId: string | null, path: string): FolderNode {
        return { kind: 'folder', id, parentId, path, name: id, listKey: 'EXECUTION',
            modifiedAt: '', isRecycleBin: false };
    }

    beforeEach(() => {
        root = folder('root', null, '/execution');
        source = folder('source', root.id, '/execution/source');
        target = folder('target', root.id, '/execution/target');
        policy = { entities: { root, source, target }, recycleBins: [], readonlyLists: new Map(),
            writingIds: new Set(), editingIds: new Set(), unavailableIds: new Set(),
            blocked: false };
    });

    it('allows files and folders across lists and into protected folders', () => {
        target.listKey = 'MARKETING';
        target.path = '/marketing/target';
        target.accessLevel = Access.Protected;
        const file: FileSystemNode = { ...source, kind: 'file', parentId: root.id,
            accessLevel: undefined };
        for (const item of [source, file]) {
            expect(canDropItem(item, target, 'move', policy)).toBeTrue();
            expect(canDropItem(item, target, 'copy', policy)).toBeTrue();
        }
    });

    it('rejects roots, bins and deleted records as sources and targets', () => {
        const bin = folder('bin', root.id, '/bin');
        bin.isRecycleBin = true;
        const deleted = folder('deleted', bin.id, '/execution/former-location');
        Object.assign(policy.entities, { bin, deleted });
        policy.recycleBins = [bin];
        expect(canStartDrag(root, policy)).toBeFalse();
        expect(canStartDrag(bin, policy)).toBeFalse();
        expect(canStartDrag(deleted, policy)).toBeFalse();
        expect(canDropItem(source, bin, 'move', policy)).toBeFalse();
        expect(canDropItem(source, deleted, 'copy', policy)).toBeFalse();
    });

    it('accepts a delete only on the bin of the source own list', () => {
        const bin = folder('bin', root.id, '/execution/bin');
        bin.isRecycleBin = true;
        const otherBin = folder('other-bin', root.id, '/marketing/bin');
        otherBin.isRecycleBin = true;
        otherBin.listKey = 'MARKETING';
        const deleted = folder('deleted', bin.id, '/execution/bin/former');
        Object.assign(policy.entities, { bin, otherBin, deleted });
        policy.recycleBins = [bin, otherBin];

        expect(canDropItem(source, bin, 'delete', policy)).toBeTrue();
        // The backend routes a deleted item to its own list bin whichever was aimed at.
        expect(canDropItem(source, otherBin, 'delete', policy)).toBeFalse();
        // A record inside a bin is not itself a bin.
        expect(canDropItem(source, deleted, 'delete', policy)).toBeFalse();
        // An ordinary folder cannot absorb a delete either.
        expect(canDropItem(source, target, 'delete', policy)).toBeFalse();
    });

    it('refuses to delete exactly what it refuses to move', () => {
        const bin = folder('bin', root.id, '/execution/bin');
        bin.isRecycleBin = true;
        Object.assign(policy.entities, { bin });
        policy.recycleBins = [bin];

        source.accessLevel = Access.Protected;
        expect(canDropItem(source, bin, 'delete', policy)).toBeFalse();

        source.accessLevel = Access.Readonly;
        expect(canDropItem(source, bin, 'delete', policy)).toBeFalse();

        // A read-only list blocks it even when the item carries no flag.
        source.accessLevel = undefined;
        policy.readonlyLists = new Map([['EXECUTION', true]]);
        expect(canDropItem(source, bin, 'delete', policy)).toBeFalse();

        policy.readonlyLists = new Map();
        expect(canDropItem(source, bin, 'delete', policy)).toBeTrue();
    });

    it('blocks self, cached descendants and unresolved path descendants', () => {
        const child = folder('child', source.id, '/execution/source/child');
        const resolved = folder('resolved', 'uncached', '/execution/source/a/b');
        Object.assign(policy.entities, { child, resolved });
        for (const destination of [source, child, resolved]) {
            expect(canDropItem(source, destination, 'move', policy)).toBeFalse();
            expect(canDropItem(source, destination, 'copy', policy)).toBeFalse();
        }
        expect(containsNode(source,
            folder('sibling', root.id, '/execution/source-two'), policy.entities)).toBeFalse();
    });

    it('rejects same-parent moves while allowing same-parent copies', () => {
        expect(canDropItem(source, root, 'move', policy)).toBeFalse();
        expect(canDropItem(source, root, 'copy', policy)).toBeTrue();
    });

    it('permits copying protected or readonly sources, but prevents moving them', () => {
        for (const access of [Access.Protected, Access.Readonly]) {
            source.accessLevel = access;
            expect(canStartDrag(source, policy)).toBeTrue();
            expect(canDropItem(source, target, 'move', policy)).toBeFalse();
            expect(canDropItem(source, target, 'copy', policy)).toBeTrue();
        }
    });

    it('restricts a move by the item and its list, not by its parent', () => {
        // The parent's own access is deliberately not consulted: permissions are
        // item-level everywhere else in the app, so the drag matches them.
        root.accessLevel = Access.Readonly;
        expect(canDropItem(source, target, 'move', policy)).toBeTrue();

        source.accessLevel = Access.Readonly;
        expect(canDropItem(source, target, 'move', policy)).toBeFalse();
        expect(canDropItem(source, target, 'copy', policy)).toBeTrue();

        source.accessLevel = undefined;
        policy.readonlyLists = new Map([['EXECUTION', true]]);
        target.listKey = 'MARKETING';
        expect(canDropItem(source, target, 'move', policy)).toBeFalse();
        expect(canDropItem(source, target, 'copy', policy)).toBeTrue();
    });

    it('drags an item whose parent is not cached', () => {
        // A search result: the node is known, the folder it lives in is not.
        const orphan = folder('orphan', 'never-loaded', '/execution/Archive/2024/orphan');
        Object.assign(policy.entities, { orphan });

        expect(canStartDrag(orphan, policy)).toBeTrue();
        expect(canDropItem(orphan, target, 'move', policy)).toBeTrue();
        expect(canDropItem(orphan, target, 'copy', policy)).toBeTrue();
    });

    it('rejects readonly destinations and readonly destination lists', () => {
        target.accessLevel = Access.Readonly;
        expect(canDropItem(source, target, 'copy', policy)).toBeFalse();
        delete target.accessLevel;
        policy.readonlyLists = new Map([['EXECUTION', true]]);
        expect(canDropItem(source, target, 'copy', policy)).toBeFalse();
    });

    it('blocks unavailable, editing and writing items including related subtrees', () => {
        const child = folder('child', source.id, '/execution/source/child');
        policy.entities[child.id] = child;
        for (const key of ['writingIds', 'editingIds'] as const) {
            policy[key] = new Set([child.id]);
            expect(canStartDrag(source, policy)).toBeFalse();
            policy[key] = new Set([target.id]);
            expect(canDropItem(source, target, 'copy', policy)).toBeFalse();
            policy[key] = new Set();
        }
        policy.unavailableIds = new Set([source.id]);
        expect(canStartDrag(source, policy)).toBeFalse();
        policy.unavailableIds = new Set([target.id]);
        expect(canDropItem(source, target, 'copy', policy)).toBeFalse();
        policy.unavailableIds = new Set([child.id]);
        expect(canStartDrag(source, policy)).toBeTrue();
        policy.blocked = true;
        expect(canStartDrag(source, policy)).toBeFalse();
    });
});
