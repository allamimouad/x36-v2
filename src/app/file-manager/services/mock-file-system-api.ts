import { Injectable, inject } from '@angular/core';
import { FileSystemError } from '../models/file-system-error.model';
import {
  isFolder,
  type FileNode,
  type FileSystemNode,
  type FolderNode,
} from '../models/file-system-node.model';
import { MOCK_CONFIG, type MockConfig } from '../tokens/mock-config.token';
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

  override createFolder(_parentId: string, _name: string): Promise<FolderNode> {
    return notImplemented('createFolder');
  }

  override rename(_id: string, _newName: string): Promise<FileSystemNode> {
    return notImplemented('rename');
  }

  override move(_id: string, _newParentId: string): Promise<FileSystemNode> {
    return notImplemented('move');
  }

  override copy(_id: string, _newParentId: string): Promise<FileSystemNode> {
    return notImplemented('copy');
  }

  override delete(_id: string): Promise<void> {
    return notImplemented('delete');
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
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function notImplemented(method: string): Promise<never> {
  return Promise.reject(
    new FileSystemError('unknown', `MockFileSystemApi.${method} is not implemented in Phase 1`),
  );
}
