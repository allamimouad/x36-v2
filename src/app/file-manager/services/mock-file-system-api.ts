import { Injectable, inject } from '@angular/core';
import { FileSystemError } from '../models/file-system-error.model';
import {
  isFolder,
  type FileNode,
  type FileSystemNode,
  type FolderNode,
} from '../models/file-system-node.model';
import { MOCK_CONFIG, type MockConfig } from '../tokens/mock-config.token';
import { joinPath } from '../utils/path.utils';
import { validateName } from '../utils/naming.utils';
import { FileSystemApi } from './file-system-api';
import { ROOT_ID, buildSeed } from './mock-seed';

@Injectable()
export class MockFileSystemApi extends FileSystemApi {
  private readonly config: MockConfig = inject(MOCK_CONFIG);
  private readonly nodes: Map<string, FileSystemNode> = buildSeed();

  override async getRoot(): Promise<FolderNode> {
    await this.delay('read');
    const root = this.nodes.get(ROOT_ID);
    if (!root || !isFolder(root)) {
      throw new FileSystemError('not-found', 'Root folder is missing');
    }
    return clone(root);
  }

  override async listChildren(folderId: string): Promise<{
    folders: FolderNode[];
    files: FileNode[];
  }> {
    await this.delay('read');
    const parent = this.nodes.get(folderId);
    if (!parent) {
      throw new FileSystemError('not-found', `Folder not found: ${folderId}`);
    }
    if (!isFolder(parent)) {
      throw new FileSystemError('not-found', `Not a folder: ${folderId}`);
    }
    const folders: FolderNode[] = [];
    const files: FileNode[] = [];
    for (const node of this.nodes.values()) {
      if (node.parentId !== folderId) continue;
      if (isFolder(node)) folders.push(clone(node));
      else files.push(clone(node));
    }
    folders.sort((a, b) => a.name.localeCompare(b.name));
    files.sort((a, b) => a.name.localeCompare(b.name));
    return { folders, files };
  }

  override async createFolder(parentId: string, name: string): Promise<FolderNode> {
    await this.delay('write');
    this.maybeFail();
    const parent = this.requireFolder(parentId);
    this.assertValidName(name);
    this.assertNameAvailable(parent.id, name);

    const now = nowIso();
    const folder: FolderNode = {
      kind: 'folder',
      id: joinPath(parent.path, name.trim()),
      path: joinPath(parent.path, name.trim()),
      name: name.trim(),
      parentId: parent.id,
      itemCount: 0,
      createdAt: now,
      modifiedAt: now,
    };
    this.nodes.set(folder.id, folder);
    this.touchParentCounts(parent.id);
    return clone(folder);
  }

  override async rename(id: string, newName: string): Promise<FileSystemNode> {
    await this.delay('write');
    this.maybeFail();
    const node = this.requireNode(id);
    if (node.parentId === null) {
      throw new FileSystemError('invalid-name', 'Root folder cannot be renamed');
    }
    this.assertValidName(newName);
    this.assertNameAvailable(node.parentId, newName, id);
    const parent = this.requireFolder(node.parentId);
    return this.repathNode(
      id,
      node.parentId,
      joinPath(parent.path, newName.trim()),
      newName.trim(),
    );
  }

  override async move(id: string, newParentId: string): Promise<FileSystemNode> {
    await this.delay('write');
    this.maybeFail();
    const node = this.requireNode(id);
    const newParent = this.requireFolder(newParentId);
    if (node.parentId === null) {
      throw new FileSystemError('invalid-name', 'Root folder cannot be moved');
    }
    if (node.parentId === newParentId) return clone(node);
    if (isFolder(node) && this.isAncestorOrSelf(node.id, newParentId)) {
      throw new FileSystemError(
        'descendant-move',
        'Cannot move a folder into itself or a descendant',
      );
    }
    this.assertNameAvailable(newParent.id, node.name, id);
    const oldParentId = node.parentId;
    const moved = this.repathNode(id, newParent.id, joinPath(newParent.path, node.name), node.name);
    this.touchParentCounts(oldParentId);
    this.touchParentCounts(newParent.id);
    return moved;
  }

  override async copy(id: string, newParentId: string): Promise<FileSystemNode> {
    await this.delay('write');
    this.maybeFail();
    const node = this.requireNode(id);
    const newParent = this.requireFolder(newParentId);
    this.assertNameAvailable(newParent.id, node.name);
    const copied = this.copyRecursive(node, newParent.id, newParent.path, node.name);
    this.touchParentCounts(newParent.id);
    return clone(copied);
  }

  override async delete(id: string): Promise<void> {
    await this.delay('write');
    this.maybeFail();
    const node = this.requireNode(id);
    if (node.parentId === null) {
      throw new FileSystemError('permission-denied', 'Root folder cannot be deleted');
    }
    const parentId = node.parentId;
    const ids = isFolder(node) ? this.collectDescendantIds(id) : [id];
    for (const nodeId of ids) {
      this.nodes.delete(nodeId);
    }
    this.touchParentCounts(parentId);
  }

  override upload(
    _parentId: string,
    _file: File,
    _onProgress: (percent: number) => void,
    _signal?: AbortSignal,
  ): Promise<FileNode> {
    return notImplemented('upload');
  }

  private delay(kind: 'read' | 'write'): Promise<void> {
    const min = this.config.minLatencyMs;
    const max = kind === 'read' ? this.config.maxLatencyMs : this.config.maxLatencyMs + 200;
    const ms = min + Math.random() * Math.max(0, max - min);
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private maybeFail(): void {
    if (!this.config.enableErrors) return;
    if (Math.random() < this.config.errorRate) {
      throw new FileSystemError('network', 'Simulated network error');
    }
  }

  private requireNode(id: string): FileSystemNode {
    const node = this.nodes.get(id);
    if (!node) {
      throw new FileSystemError('not-found', `Node not found: ${id}`);
    }
    return node;
  }

  private requireFolder(id: string): FolderNode {
    const node = this.requireNode(id);
    if (!isFolder(node)) {
      throw new FileSystemError('not-found', `Folder not found: ${id}`);
    }
    return node;
  }

  private assertValidName(name: string): void {
    const result = validateName(name);
    if (!result.valid) {
      throw new FileSystemError('invalid-name', `Invalid name: ${result.reason}`);
    }
  }

  private assertNameAvailable(parentId: string, name: string, exceptId?: string): void {
    const normalized = name.trim().toLocaleLowerCase();
    for (const node of this.nodes.values()) {
      if (node.parentId !== parentId || node.id === exceptId) continue;
      if (node.name.toLocaleLowerCase() === normalized) {
        throw new FileSystemError(
          'name-collision',
          `An item named "${name.trim()}" already exists`,
        );
      }
    }
  }

  private isAncestorOrSelf(ancestorId: string, candidateId: string): boolean {
    let current: string | null = candidateId;
    while (current !== null) {
      if (current === ancestorId) return true;
      current = this.requireFolder(current).parentId;
    }
    return false;
  }

  private repathNode(
    id: string,
    newParentId: string,
    newPath: string,
    newName: string,
  ): FileSystemNode {
    const node = this.requireNode(id);
    const oldPath = node.path;
    const now = nowIso();
    const updates = isFolder(node)
      ? this.collectDescendantIds(id).map((nodeId) => this.requireNode(nodeId))
      : [node];

    for (const current of updates) {
      this.nodes.delete(current.id);
    }

    let updatedRoot: FileSystemNode | null = null;
    for (const current of updates) {
      const isRoot = current.id === id;
      const updatedPath = isRoot ? newPath : current.path.replace(`${oldPath}/`, `${newPath}/`);
      const parentId = isRoot ? newParentId : current.parentId?.replace(oldPath, newPath);
      const updated: FileSystemNode = isFolder(current)
        ? {
            ...current,
            id: updatedPath,
            path: updatedPath,
            name: isRoot ? newName : current.name,
            parentId: parentId ?? null,
            modifiedAt: isRoot ? now : current.modifiedAt,
          }
        : {
            ...current,
            id: updatedPath,
            path: updatedPath,
            name: isRoot ? newName : current.name,
            parentId: parentId ?? newParentId,
            modifiedAt: isRoot ? now : current.modifiedAt,
          };
      this.nodes.set(updated.id, updated);
      if (isRoot) updatedRoot = updated;
    }

    if (!updatedRoot) {
      throw new FileSystemError('unknown', `Failed to update node: ${id}`);
    }
    return clone(updatedRoot);
  }

  private copyRecursive(
    source: FileSystemNode,
    targetParentId: string,
    targetParentPath: string,
    name: string,
  ): FileSystemNode {
    const now = nowIso();
    const targetPath = joinPath(targetParentPath, name);
    if (this.nodes.has(targetPath)) {
      throw new FileSystemError('name-collision', `An item named "${name}" already exists`);
    }
    const children = isFolder(source)
      ? Array.from(this.nodes.values()).filter((node) => node.parentId === source.id)
      : [];

    if (!isFolder(source)) {
      const file: FileNode = {
        ...source,
        id: targetPath,
        path: targetPath,
        name,
        parentId: targetParentId,
        createdAt: now,
        modifiedAt: now,
      };
      this.nodes.set(file.id, file);
      return file;
    }

    const folder: FolderNode = {
      ...source,
      id: targetPath,
      path: targetPath,
      name,
      parentId: targetParentId,
      createdAt: now,
      modifiedAt: now,
    };
    this.nodes.set(folder.id, folder);

    for (const child of children) {
      this.copyRecursive(child, folder.id, folder.path, child.name);
    }
    this.touchParentCounts(folder.id);
    return folder;
  }

  private collectDescendantIds(folderId: string): string[] {
    const out = [folderId];
    for (const node of Array.from(this.nodes.values())) {
      if (node.parentId !== folderId) continue;
      if (isFolder(node)) {
        out.push(...this.collectDescendantIds(node.id));
      } else {
        out.push(node.id);
      }
    }
    return out;
  }

  private touchParentCounts(parentId: string): void {
    const parent = this.nodes.get(parentId);
    if (!parent || !isFolder(parent)) return;
    const itemCount = Array.from(this.nodes.values()).filter(
      (node) => node.parentId === parentId,
    ).length;
    this.nodes.set(parent.id, {
      ...parent,
      itemCount,
      modifiedAt: nowIso(),
    });
  }
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function nowIso(): string {
  return new Date().toISOString();
}

function notImplemented(method: string): Promise<never> {
  return Promise.reject(
    new FileSystemError('unknown', `MockFileSystemApi.${method} is not implemented in Phase 1`),
  );
}
