import { FolderNodeResponseAccessLevelEnum } from '@api/model/folderNodeResponse';
import { isFolder, type FileSystemNode } from '../../models/file-system-node.model';
import type { MockConfig } from './mock-config.token';
import { normalizeMockPath } from './mock-node-utils';

export function applyMockAccess(nodes: Map<string, FileSystemNode>, config: MockConfig): void {
    const protectedPaths = new Set((config.protectedFolderPaths ?? []).map(normalizeMockPath));
    const readonlyPaths = new Set((config.readonlyFolderPaths ?? []).map(normalizeMockPath));
    for (const node of nodes.values()) {
        if (!isFolder(node)) { continue; }
        const path = normalizeMockPath(node.path);
        if (protectedPaths.has(path)) {
            node.accessLevel = FolderNodeResponseAccessLevelEnum.Protected;
        }
        if (readonlyPaths.has(path)) {
            node.accessLevel = FolderNodeResponseAccessLevelEnum.Readonly;
        }
    }
}
