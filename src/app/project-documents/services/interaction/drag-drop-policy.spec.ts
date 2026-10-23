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

    it('uses source-parent and source-list readonly flags for move restrictions', () => {
        root.accessLevel = Access.Readonly;
        expect(canDropItem(source, target, 'move', policy)).toBeFalse();
        expect(canDropItem(source, target, 'copy', policy)).toBeTrue();
        policy.readonlyLists = new Map([['EXECUTION', true]]);
        target.listKey = 'MARKETING';
        expect(canDropItem(source, target, 'move', policy)).toBeFalse();
        expect(canDropItem(source, target, 'copy', policy)).toBeTrue();
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
