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

/** Execution documents (contracts, schedules, on-site reporting). */
const EXECUTION_SEED: SeedFolderSpec[] = [
  {
    name: 'Contracts',
    folders: [
      {
        name: 'Vendors',
        folders: [
          {
            name: '2026',
            folders: [
              {
                name: 'Q111111111111111111111111111111',
                folders: [
                  {
                    name: 'Signed',
                    files: [
                      { name: 'acme-msa-signed.pdf', sizeBytes: 318_400, contentType: PDF },
                      { name: 'globex-msa-signed.pdf', sizeBytes: 291_700, contentType: PDF },
                    ],
                  },
                  {
                    name: 'Pending Signature',
                    files: [{ name: 'initech-msa-draft.pdf', sizeBytes: 264_900, contentType: PDF }],
                  },
                ],
                files: [{ name: 'q1-vendor-summary.xlsx', sizeBytes: 74_200, contentType: XLSX }],
              },
              {
                name: 'Q2',
                files: [{ name: 'q2-vendor-summary.xlsx', sizeBytes: 71_800, contentType: XLSX }],
              },
            ],
            files: [{ name: 'vendor-index-2026.txt', sizeBytes: 2_100, contentType: TXT }],
          },
          {
            name: 'Archive',
            folders: [
              {
                name: '2025',
                files: [{ name: 'vendor-msa-2025.pdf', sizeBytes: 402_500, contentType: PDF }],
              },
            ],
            files: [{ name: 'archive-notes.txt', sizeBytes: 1_400, contentType: TXT }],
          },
        ],
        files: [
          { name: 'vendor-msa.pdf', sizeBytes: 412_000, contentType: PDF },
          { name: 'vendor-list.xlsx', sizeBytes: 112_300, contentType: XLSX },
        ],
      },
      {
        name: 'Subcontractors',
        folders: [
          {
            name: 'Electrical',
            folders: [
              {
                name: 'Inspections',
                files: [{ name: 'electrical-inspection.pdf', sizeBytes: 142_800, contentType: PDF }],
              },
            ],
            files: [{ name: 'electrical-agreement.pdf', sizeBytes: 188_300, contentType: PDF }],
          },
          {
            name: 'Plumbing',
            files: [{ name: 'plumbing-agreement.pdf', sizeBytes: 176_100, contentType: PDF }],
          },
        ],
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
        name: 'Stage 1',
        folders: [
          {
            name: 'Weekly',
            folders: [
              {
                name: 'Week 01',
                files: [{ name: 'week-01-plan.xlsx', sizeBytes: 64_200, contentType: XLSX }],
              },
              {
                name: 'Week 02',
                files: [{ name: 'week-02-plan.xlsx', sizeBytes: 65_900, contentType: XLSX }],
              },
            ],
          },
        ],
        files: [
          { name: 'gantt-stage1.xlsx', sizeBytes: 184_500, contentType: XLSX },
          { name: 'milestones.docx', sizeBytes: 41_200, contentType: DOCX },
        ],
      },
      {
        name: 'Stage 2',
        files: [{ name: 'gantt-stage2.xlsx', sizeBytes: 176_900, contentType: XLSX }],
      },
    ],
    files: [{ name: 'master-schedule.xlsx', sizeBytes: 221_300, contentType: XLSX }],
  },
  {
    name: 'Site Reports',
    folders: [
      {
        name: 'Week 1',
        folders: [
          {
            name: 'Photos',
            files: [
              { name: 'site-photo-1.png', sizeBytes: 1_240_000, contentType: PNG },
              { name: 'site-photo-2.png', sizeBytes: 1_310_500, contentType: PNG },
            ],
          },
        ],
        files: [{ name: 'daily-log-mon.pdf', sizeBytes: 88_400, contentType: PDF }],
      },
      {
        name: 'Week 2',
        files: [{ name: 'daily-log-mon.pdf', sizeBytes: 90_100, contentType: PDF }],
      },
    ],
    files: [{ name: 'inspection-summary.pdf', sizeBytes: 142_000, contentType: PDF }],
  },
];

/** Marketing documents (brand assets, campaigns, press). */
const MARKETING_SEED: SeedFolderSpec[] = [
  {
    name: 'Brand Assets',
    folders: [
      {
        name: 'Logos',
        folders: [
          {
            name: 'Primary',
            files: [{ name: 'logo-primary.png', sizeBytes: 92_330, contentType: PNG }],
          },
          {
            name: 'Variations',
            files: [
              { name: 'logo-mono.png', sizeBytes: 64_120, contentType: PNG },
              { name: 'logo-inverse.png', sizeBytes: 67_540, contentType: PNG },
            ],
          },
        ],
        files: [{ name: 'logo-usage.pdf', sizeBytes: 142_900, contentType: PDF }],
      },
      {
        name: 'Photography',
        folders: [
          {
            name: '2026',
            folders: [
              {
                name: 'Campaign Shoots',
                files: [{ name: 'hero-shot.png', sizeBytes: 2_410_000, contentType: PNG }],
              },
            ],
          },
        ],
        files: [{ name: 'photo-index.txt', sizeBytes: 1_900, contentType: TXT }],
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
            folders: [
              {
                name: 'Drafts',
                files: [{ name: 'announcement-draft.docx', sizeBytes: 52_100, contentType: DOCX }],
              },
              {
                name: 'Sent',
                files: [{ name: 'announcement.docx', sizeBytes: 54_300, contentType: DOCX }],
              },
            ],
          },
          {
            name: 'Social',
            folders: [
              {
                name: 'Instagram',
                files: [{ name: 'ig-post-plan.xlsx', sizeBytes: 48_700, contentType: XLSX }],
              },
            ],
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
    folders: [
      {
        name: 'Releases',
        files: [{ name: 'press-release.pdf', sizeBytes: 120_300, contentType: PDF }],
      },
    ],
    files: [{ name: 'media-list.xlsx', sizeBytes: 87_600, contentType: XLSX }],
  },
  // Layout-stress folder: very long, space-free names nested 5 levels deep,
  // for testing tree indentation / breadcrumb / horizontal-overflow behavior.
  {
    name: 'SuperLongMarketingCampaignAssetsFolderNameWithoutAnySpacesForLayoutAndOverflowTesting',
    folders: [
      {
        name: 'NestedLevelOneExtremelyLongUnbrokenFolderNameWithoutSpacesToStressTreeIndentation',
        folders: [
          {
            name: 'NestedLevelTwoAnotherVeryLongContinuousFolderNameWithoutSpacesForBreadcrumbTesting',
            folders: [
              {
                name: 'NestedLevelThreeYetAnotherReallyLongFolderNameWithoutSpacesToCheckWrappingBehavior',
                folders: [
                  {
                    name: 'NestedLevelFourDeepestLongFolderNameWithoutSpacesAtTheBottomOfTheFiveLevelTree',
                    files: [
                      {
                        name: 'deeply-nested-asset-report.pdf',
                        sizeBytes: 156_700,
                        contentType: PDF,
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
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
