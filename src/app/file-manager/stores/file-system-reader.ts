import type { Signal } from '@angular/core';
import type { FileSystemNode } from '../models/file-system-node.model';

export abstract class FileSystemReader {
  abstract readonly entityMap: Signal<Record<string, FileSystemNode>>;
  abstract readonly entities: Signal<FileSystemNode[]>;
}
