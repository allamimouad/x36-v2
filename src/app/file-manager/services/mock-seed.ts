import {
  DOCUMENT_LIST_KEYS,
  type DocumentListKey,
} from '../models/document-list.model';
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
  rootIdByList: Record<DocumentListKey, string>;
  nodes: Map<string, FileSystemNode>;
}

const NOW = '2026-04-01T09:00:00.000Z';
const EARLIER = '2026-01-15T14:30:00.000Z';

const EDITORS = [
  'Olivier Bernard',
  'Daniel Renault',
  'Mira Furlan',
  'Steve Trent',
  'Maria Lopez',
];

/** Deterministic editor per node name, so the demo data is stable across reloads. */
function editorFor(name: string): string {
  let sum = 0;
  for (let i = 0; i < name.length; i++) sum += name.charCodeAt(i);
  return EDITORS[sum % EDITORS.length];
}

const PDF = 'application/pdf';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const PNG = 'image/png';
const TXT = 'text/plain';

/** Execution-phase documents (contracts, schedules, on-site reporting). */
const EXECUTION_SEED: SeedFolderSpec[] = [
  {
    name: 'Contracts',
    folders: [
      {
        name: 'Vendors',
        files: [
          { name: 'vendor-msa.pdf', sizeBytes: 412_000, contentType: PDF },
          { name: 'vendor-list.xlsx', sizeBytes: 112_300, contentType: XLSX },
        ],
      },
      {
        name: 'Subcontractors',
        files: [
          { name: 'sub-agreement.pdf', sizeBytes: 256_400, contentType: PDF },
          { name: 'insurance-cert.pdf', sizeBytes: 98_700, contentType: PDF },
        ],
      },
    ],
    files: [
      { name: 'main-contract.pdf', sizeBytes: 512_900, contentType: PDF },
      { name: 'change-order-1.docx', sizeBytes: 48_200, contentType: DOCX },
    ],
  },
  {
    name: 'Schedules',
    folders: [
      {
        name: 'Phase 1',
        files: [
          { name: 'gantt-phase1.xlsx', sizeBytes: 184_500, contentType: XLSX },
          { name: 'milestones.docx', sizeBytes: 41_200, contentType: DOCX },
        ],
      },
      {
        name: 'Phase 2',
        files: [{ name: 'gantt-phase2.xlsx', sizeBytes: 176_900, contentType: XLSX }],
      },
    ],
    files: [{ name: 'master-schedule.xlsx', sizeBytes: 221_300, contentType: XLSX }],
  },
  {
    name: 'Site Reports',
    folders: [
      {
        name: 'Week 1',
        files: [
          { name: 'daily-log-mon.pdf', sizeBytes: 88_400, contentType: PDF },
          { name: 'site-photo-1.png', sizeBytes: 1_240_000, contentType: PNG },
        ],
      },
      {
        name: 'Week 2',
        files: [{ name: 'daily-log-mon.pdf', sizeBytes: 90_100, contentType: PDF }],
      },
    ],
    files: [{ name: 'inspection-summary.pdf', sizeBytes: 142_000, contentType: PDF }],
  },
];

/** Marketing-phase documents (brand assets, campaigns, press). */
const MARKETING_SEED: SeedFolderSpec[] = [
  {
    name: 'Brand Assets',
    folders: [
      {
        name: 'Logos',
        files: [
          { name: 'logo-primary.png', sizeBytes: 92_330, contentType: PNG },
          { name: 'logo-mono.png', sizeBytes: 64_120, contentType: PNG },
        ],
      },
      {
        name: 'Photography',
        files: [{ name: 'hero-shot.png', sizeBytes: 2_410_000, contentType: PNG }],
      },
    ],
    files: [{ name: 'brand-guidelines.pdf', sizeBytes: 488_900, contentType: PDF }],
  },
  {
    name: 'Campaigns',
    folders: [
      {
        name: 'Launch 2026',
        folders: [
          {
            name: 'Email',
            files: [{ name: 'announcement.docx', sizeBytes: 54_300, contentType: DOCX }],
          },
        ],
        files: [
          { name: 'campaign-brief.docx', sizeBytes: 76_400, contentType: DOCX },
          { name: 'budget.xlsx', sizeBytes: 65_540, contentType: XLSX },
        ],
      },
    ],
    files: [{ name: 'calendar-2026.xlsx', sizeBytes: 132_500, contentType: XLSX }],
  },
  {
    name: 'Press',
    files: [
      { name: 'press-release.pdf', sizeBytes: 120_300, contentType: PDF },
      { name: 'media-list.xlsx', sizeBytes: 87_600, contentType: XLSX },
    ],
  },
];

const SEED_BY_LIST: Record<DocumentListKey, SeedFolderSpec[]> = {
  execution: EXECUTION_SEED,
  marketing: MARKETING_SEED,
};

export function buildSeed(): SeedResult {
  const nodes = new Map<string, FileSystemNode>();
  const rootIdByList = {} as Record<DocumentListKey, string>;
  // One root per document list, each with its own seed content and path namespace
  // (e.g. /execution) so node paths stay unique across lists; nodes attach via parentId.
  for (const listKey of DOCUMENT_LIST_KEYS) {
    const seed = SEED_BY_LIST[listKey];
    const rootId = crypto.randomUUID();
    const rootPath = `${ROOT_PATH}${listKey}`;
    const root: FolderNode = {
      kind: 'folder',
      id: rootId,
      path: rootPath,
      name: '',
      parentId: null,
      itemCount: seed.length,
      createdAt: EARLIER,
      modifiedAt: NOW,
      modifiedBy: EDITORS[0],
    };
    nodes.set(root.id, root);
    for (const spec of seed) {
      addFolder(nodes, spec, rootId, rootPath);
    }
    rootIdByList[listKey] = rootId;
  }
  return { rootIdByList, nodes };
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
    modifiedBy: editorFor(spec.name),
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
    modifiedBy: editorFor(spec.name),
    contentType: spec.contentType,
  };
  nodes.set(file.id, file);
}
