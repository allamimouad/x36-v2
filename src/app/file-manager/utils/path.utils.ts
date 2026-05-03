import type { FolderNode } from '../models/file-system-node.model';

export const ROOT_PATH = '/';

export function joinPath(parentPath: string, name: string): string {
  if (parentPath === ROOT_PATH) return `/${name}`;
  return `${parentPath}/${name}`;
}

export function parentOf(path: string): string {
  if (path === ROOT_PATH || !path.includes('/')) return ROOT_PATH;
  const idx = path.lastIndexOf('/');
  if (idx <= 0) return ROOT_PATH;
  return path.slice(0, idx);
}

export function basename(path: string): string {
  if (path === ROOT_PATH) return '';
  const idx = path.lastIndexOf('/');
  return idx < 0 ? path : path.slice(idx + 1);
}

export function isAncestorOrSelf(
  ancestorId: string,
  candidateId: string,
  allFolders: ReadonlyMap<string, FolderNode>,
): boolean {
  let current: string | null = candidateId;
  while (current !== null) {
    if (current === ancestorId) return true;
    const node = allFolders.get(current);
    if (!node) return false;
    current = node.parentId;
  }
  return false;
}
