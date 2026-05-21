import type { FileNode, FileSystemNode, FolderNode } from '../models/file-system-node.model';
import { ROOT_PATH } from '../utils/path.utils';

interface SeedFolderSpec {
  name: string;
  folders?: SeedFolderSpec[];
  files?: SeedFileSpec[];
}

interface SeedFileSpec {
  name: string;
  sizeBytes: number;
  contentType: string;
}

export interface SeedResult {
  rootId: string;
  nodes: Map<string, FileSystemNode>;
}

const NOW = '2026-04-01T09:00:00.000Z';
const EARLIER = '2026-01-15T14:30:00.000Z';

const SEED: SeedFolderSpec[] = [
  {
    name: 'Documents',
    folders: [
      {
        name: 'Reports',
        files: [
          { name: 'Q1-2026.pdf', sizeBytes: 482_300, contentType: 'application/pdf' },
          { name: 'Q2-2026.pdf', sizeBytes: 511_244, contentType: 'application/pdf' },
          {
            name: 'annual-summary.docx',
            sizeBytes: 124_500,
            contentType:
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          },
        ],
      },
      {
        name: 'Drafts',
        files: [
          {
            name: 'proposal.docx',
            sizeBytes: 88_120,
            contentType:
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          },
          { name: 'notes.txt', sizeBytes: 4_210, contentType: 'text/plain' },
        ],
      },
    ],
    files: [
      {
        name: 'budget.xlsx',
        sizeBytes: 65_540,
        contentType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      },
      { name: 'team-photo.png', sizeBytes: 1_840_220, contentType: 'image/png' },
    ],
  },
  {
    name: 'Shared',
    folders: [
      {
        name: 'Templates',
        files: [
          {
            name: 'invoice.docx',
            sizeBytes: 23_440,
            contentType:
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          },
          { name: 'contract.pdf', sizeBytes: 312_900, contentType: 'application/pdf' },
        ],
      },
      {
        name: 'Public',
        files: [
          { name: 'readme.txt', sizeBytes: 1_120, contentType: 'text/plain' },
          { name: 'logo.png', sizeBytes: 92_330, contentType: 'image/png' },
        ],
      },
    ],
    files: [
      { name: 'handover.pdf', sizeBytes: 245_000, contentType: 'application/pdf' },
    ],
  },
  {
    name: 'Archive',
    folders: [
      {
        name: '2024',
        files: [
          { name: 'old-report.pdf', sizeBytes: 720_100, contentType: 'application/pdf' },
          {
            name: 'data.xlsx',
            sizeBytes: 132_500,
            contentType:
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          },
        ],
      },
      {
        name: '2025',
        files: [
          { name: 'final-report.pdf', sizeBytes: 990_400, contentType: 'application/pdf' },
          {
            name: 'presentation.pdf',
            sizeBytes: 2_410_000,
            contentType: 'application/pdf',
          },
        ],
      },
    ],
    files: [
      { name: 'archive-index.txt', sizeBytes: 8_900, contentType: 'text/plain' },
    ],
  },
];

export function buildSeed(): SeedResult {
  const nodes = new Map<string, FileSystemNode>();
  const rootId = crypto.randomUUID();
  const root: FolderNode = {
    kind: 'folder',
    id: rootId,
    path: ROOT_PATH,
    name: '',
    parentId: null,
    itemCount: SEED.length,
    createdAt: EARLIER,
    modifiedAt: NOW,
  };
  nodes.set(root.id, root);
  for (const spec of SEED) {
    addFolder(nodes, spec, rootId, ROOT_PATH);
  }
  return { rootId, nodes };
}

function addFolder(
  nodes: Map<string, FileSystemNode>,
  spec: SeedFolderSpec,
  parentId: string,
  parentPath: string,
): void {
  const path = parentPath === ROOT_PATH ? `/${spec.name}` : `${parentPath}/${spec.name}`;
  const itemCount = (spec.folders?.length ?? 0) + (spec.files?.length ?? 0);
  const folder: FolderNode = {
    kind: 'folder',
    id: crypto.randomUUID(),
    path,
    name: spec.name,
    parentId,
    itemCount,
    createdAt: EARLIER,
    modifiedAt: NOW,
  };
  nodes.set(folder.id, folder);
  for (const sub of spec.folders ?? []) {
    addFolder(nodes, sub, folder.id, path);
  }
  for (const fileSpec of spec.files ?? []) {
    addFile(nodes, fileSpec, folder.id, path);
  }
}

function addFile(
  nodes: Map<string, FileSystemNode>,
  spec: SeedFileSpec,
  parentId: string,
  parentPath: string,
): void {
  const path = parentPath === ROOT_PATH ? `/${spec.name}` : `${parentPath}/${spec.name}`;
  const file: FileNode = {
    kind: 'file',
    id: crypto.randomUUID(),
    path,
    name: spec.name,
    parentId,
    sizeBytes: spec.sizeBytes,
    createdAt: EARLIER,
    modifiedAt: NOW,
    contentType: spec.contentType,
  };
  nodes.set(file.id, file);
}
