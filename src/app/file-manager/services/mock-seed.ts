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

const SEED: SeedFolderSpec[] = [
  {
    name: 'Documents',
    folders: [
      {
        name: 'Reports',
        folders: [
          {
            name: '2025 Fiscal Year',
            folders: [
              {
                name: 'Q3 - July to September',
                files: [
                  { name: 'q3-summary.pdf', sizeBytes: 482_300, contentType: PDF },
                  { name: 'q3-data.xlsx', sizeBytes: 132_500, contentType: XLSX },
                ],
              },
              {
                name: 'Q4 - October to December',
                folders: [
                  {
                    name: 'Drafts',
                    files: [
                      { name: 'q4-draft-v1.docx', sizeBytes: 88_120, contentType: DOCX },
                      { name: 'q4-draft-v2.docx', sizeBytes: 91_540, contentType: DOCX },
                    ],
                  },
                  {
                    name: 'Final',
                    files: [
                      { name: 'q4-final.pdf', sizeBytes: 511_244, contentType: PDF },
                    ],
                  },
                ],
                files: [{ name: 'q4-notes.txt', sizeBytes: 4_210, contentType: TXT }],
              },
            ],
          },
          {
            name: '2026 Fiscal Year',
            folders: [
              {
                name: 'Q1 - January to March',
                files: [
                  { name: 'q1-2026.pdf', sizeBytes: 488_900, contentType: PDF },
                  { name: 'annual-summary.docx', sizeBytes: 124_500, contentType: DOCX },
                ],
              },
            ],
          },
        ],
        files: [{ name: 'reports-index.txt', sizeBytes: 2_300, contentType: TXT }],
      },
      {
        name: 'Drafts',
        files: [
          { name: 'proposal.docx', sizeBytes: 88_120, contentType: DOCX },
          { name: 'notes.txt', sizeBytes: 4_210, contentType: TXT },
        ],
      },
    ],
    files: [
      { name: 'budget.xlsx', sizeBytes: 65_540, contentType: XLSX },
      { name: 'team-photo.png', sizeBytes: 1_840_220, contentType: PNG },
    ],
  },
  {
    name: 'Projects',
    folders: [
      {
        name: 'Apollo',
        folders: [
          {
            name: 'Design',
            folders: [
              {
                name: 'Mockups',
                files: [
                  { name: 'home-v1.png', sizeBytes: 642_100, contentType: PNG },
                  { name: 'home-v2.png', sizeBytes: 651_900, contentType: PNG },
                ],
              },
              {
                name: 'Specs',
                files: [{ name: 'design-spec.pdf', sizeBytes: 305_000, contentType: PDF }],
              },
            ],
          },
          {
            name: 'Engineering',
            folders: [
              {
                name: 'Backend',
                folders: [
                  {
                    name: 'Services',
                    folders: [
                      {
                        name: 'Authentication Service',
                        folders: [
                          {
                            name: 'Version 2.0 Release',
                            files: [
                              { name: 'auth-spec.docx', sizeBytes: 71_200, contentType: DOCX },
                              { name: 'token-flow.png', sizeBytes: 254_800, contentType: PNG },
                            ],
                          },
                        ],
                        files: [{ name: 'auth-readme.txt', sizeBytes: 1_900, contentType: TXT }],
                      },
                      {
                        name: 'Billing',
                        files: [{ name: 'billing-spec.docx', sizeBytes: 64_500, contentType: DOCX }],
                      },
                    ],
                  },
                ],
                files: [{ name: 'api-design.docx', sizeBytes: 142_000, contentType: DOCX }],
              },
              {
                name: 'Frontend',
                files: [{ name: 'ui-guidelines.pdf', sizeBytes: 210_400, contentType: PDF }],
              },
            ],
          },
        ],
        files: [{ name: 'charter.pdf', sizeBytes: 98_700, contentType: PDF }],
      },
      {
        name: 'Zephyr',
        folders: [
          {
            name: 'Research',
            files: [
              { name: 'market-study.xlsx', sizeBytes: 221_300, contentType: XLSX },
              { name: 'findings.docx', sizeBytes: 76_400, contentType: DOCX },
            ],
          },
        ],
        files: [{ name: 'kickoff.pptx-notes.txt', sizeBytes: 3_100, contentType: TXT }],
      },
    ],
  },
  {
    name: 'Finance',
    folders: [
      {
        name: 'Invoices',
        folders: [
          {
            name: '2025 Fiscal Year',
            files: [
              { name: 'inv-2025-001.pdf', sizeBytes: 41_200, contentType: PDF },
              { name: 'inv-2025-002.pdf', sizeBytes: 39_800, contentType: PDF },
            ],
          },
          {
            name: '2026 Fiscal Year',
            folders: [
              {
                name: 'Q1 - January to March',
                folders: [
                  {
                    name: 'EMEA Region Invoices',
                    files: [{ name: 'inv-2026-emea-001.pdf', sizeBytes: 44_100, contentType: PDF }],
                  },
                  {
                    name: 'APAC Region Invoices',
                    files: [{ name: 'inv-2026-apac-001.pdf', sizeBytes: 43_700, contentType: PDF }],
                  },
                ],
              },
            ],
            files: [{ name: 'inv-2026-001.pdf', sizeBytes: 42_900, contentType: PDF }],
          },
        ],
      },
      {
        name: 'Budgets',
        files: [
          { name: 'budget-2025.xlsx', sizeBytes: 158_200, contentType: XLSX },
          { name: 'budget-2026.xlsx', sizeBytes: 161_700, contentType: XLSX },
        ],
      },
      {
        name: 'ConsolidatedQuarterlyFinancialStatementsAndReconciliationReportsForGlobalSubsidiaries2024Through2026',
        files: [
          { name: 'consolidated-q4.xlsx', sizeBytes: 274_500, contentType: XLSX },
        ],
      },
    ],
  },
  {
    name: 'Legal',
    folders: [
      {
        name: 'Contracts',
        folders: [
          {
            name: 'Vendors',
            files: [{ name: 'vendor-msa.pdf', sizeBytes: 412_000, contentType: PDF }],
          },
          {
            name: 'Clients',
            files: [{ name: 'client-sow.pdf', sizeBytes: 298_500, contentType: PDF }],
          },
        ],
      },
      {
        name: 'Policies',
        files: [{ name: 'privacy-policy.pdf', sizeBytes: 120_300, contentType: PDF }],
      },
      {
        name: 'International Regulatory Compliance and Cross-Border Data Transfer Agreements (EMEA, APAC & Americas, 2024-2026)',
        files: [
          { name: 'gdpr-cross-border-framework.pdf', sizeBytes: 184_300, contentType: PDF },
          { name: 'standard-contractual-clauses.docx', sizeBytes: 66_700, contentType: DOCX },
        ],
      },
    ],
    files: [
      { name: 'nda-acme.pdf', sizeBytes: 84_200, contentType: PDF },
      { name: 'nda-globex.pdf', sizeBytes: 81_900, contentType: PDF },
      { name: 'msa-initech.pdf', sizeBytes: 412_300, contentType: PDF },
      { name: 'sow-umbrella.docx', sizeBytes: 64_500, contentType: DOCX },
      { name: 'amendment-1.docx', sizeBytes: 38_120, contentType: DOCX },
      { name: 'amendment-2.docx', sizeBytes: 41_640, contentType: DOCX },
      { name: 'termination-notice.pdf', sizeBytes: 52_700, contentType: PDF },
      { name: 'ip-assignment.pdf', sizeBytes: 133_800, contentType: PDF },
      { name: 'data-processing-agreement.pdf', sizeBytes: 198_400, contentType: PDF },
      { name: 'confidentiality-addendum.docx', sizeBytes: 29_900, contentType: DOCX },
      { name: 'vendor-list.xlsx', sizeBytes: 112_300, contentType: XLSX },
      { name: 'compliance-checklist.xlsx', sizeBytes: 87_600, contentType: XLSX },
      { name: 'gdpr-summary.pdf', sizeBytes: 145_200, contentType: PDF },
      { name: 'litigation-hold.txt', sizeBytes: 6_400, contentType: TXT },
      { name: 'board-resolution.pdf', sizeBytes: 73_100, contentType: PDF },
      { name: 'power-of-attorney.pdf', sizeBytes: 91_500, contentType: PDF },
      { name: 'trademark-filing.pdf', sizeBytes: 256_700, contentType: PDF },
      { name: 'patent-application.pdf', sizeBytes: 488_900, contentType: PDF },
      { name: 'license-agreement.docx', sizeBytes: 55_300, contentType: DOCX },
      { name: 'settlement-draft.docx', sizeBytes: 47_800, contentType: DOCX },
    ],
  },
  {
    name: 'Shared',
    folders: [
      {
        name: 'Templates',
        folders: [
          {
            name: 'Legal',
            files: [{ name: 'nda-template.docx', sizeBytes: 28_900, contentType: DOCX }],
          },
          {
            name: 'Marketing',
            files: [{ name: 'deck-template.pptx-notes.txt', sizeBytes: 2_400, contentType: TXT }],
          },
        ],
        files: [
          { name: 'invoice.docx', sizeBytes: 23_440, contentType: DOCX },
          { name: 'contract.pdf', sizeBytes: 312_900, contentType: PDF },
        ],
      },
      {
        name: 'Public',
        files: [
          { name: 'readme.txt', sizeBytes: 1_120, contentType: TXT },
          { name: 'logo.png', sizeBytes: 92_330, contentType: PNG },
        ],
      },
    ],
    files: [{ name: 'handover.pdf', sizeBytes: 245_000, contentType: PDF }],
  },
  {
    name: 'Archive',
    folders: [
      {
        name: '2024 Fiscal Year',
        folders: [
          {
            name: 'Reports',
            files: [{ name: 'old-report.pdf', sizeBytes: 720_100, contentType: PDF }],
          },
        ],
        files: [{ name: 'data.xlsx', sizeBytes: 132_500, contentType: XLSX }],
      },
      {
        name: '2025 Fiscal Year',
        files: [
          { name: 'final-report.pdf', sizeBytes: 990_400, contentType: PDF },
          { name: 'presentation.pdf', sizeBytes: 2_410_000, contentType: PDF },
        ],
      },
    ],
    files: [{ name: 'archive-index.txt', sizeBytes: 8_900, contentType: TXT }],
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
    modifiedBy: EDITORS[0],
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
