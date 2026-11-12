import type { MenuItem } from 'primeng/api';
import { FileNodeResponseAccessLevelEnum } from '@api/model/fileNodeResponse';
import { FolderNodeResponseAccessLevelEnum } from '@api/model/folderNodeResponse';
import type { DocumentListKey } from '../../models/document-list.model';
import type { FileNode, FileSystemNode, FolderNode } from '../../models/file-system-node.model';
import type { NodeSurface } from '../../models/node-surface.model';

/** Rendering data PrimeNG carries through untouched; the menu template reads it back. */
export interface ProjectDocumentsMenuData {
    symbol: string;
    testId: string;
}

/**
 * What the menus are allowed to offer. Plain values wherever possible, so the caller
 * reads its signals once and this module stays free of the store.
 */
export interface ContextMenuCapabilities {
    writingIds: ReadonlySet<string>;
    selectedIds: ReadonlySet<string>;
    readonlyByList: ReadonlyMap<DocumentListKey, boolean>;
    isCurrentFolderReadonly: boolean;
    isListReadonly: boolean;
    currentFolder: FolderNode | null;
    canCreateFolder: boolean;
    canPasteInto: (target: FolderNode) => boolean;
    canOpenDesktop: (file: FileNode) => boolean;
    canOpenOnline: (file: FileNode) => boolean;
    canDownload: (file: FileNode) => boolean;
}

/** What each entry does when chosen. The caller owns every one of these. */
export interface ContextMenuActions {
    openFolder: (folder: FolderNode) => void;
    rename: (node: FileSystemNode, source: NodeSurface) => void;
    copy: (node: FileSystemNode, source: NodeSurface) => void;
    cut: (node: FileSystemNode, source: NodeSurface) => void;
    paste: (target: FolderNode) => void;
    remove: (node: FileSystemNode, source: NodeSurface) => void;
    createFolder: () => void;
    uploadFolder: (target: FolderNode) => void;
    uploadFile: (target: FolderNode) => void;
    openFile: (file: FileNode) => void;
    openDesktop: (file: FileNode) => void;
    openOnline: (file: FileNode) => void;
    download: (file: FileNode) => void;
    restore: (node: FileSystemNode) => void;
    deletePermanently: (node: FileSystemNode) => void;
    openSearchResultLocation: (result: FileSystemNode) => void;
    activateSearchResult: (result: FolderNode) => void;
}

export interface ContextMenuDeps {
    can: ContextMenuCapabilities;
    on: ContextMenuActions;
}

export function menuItem(
    label: string,
    symbol: string,
    testId: string,
    action?: () => void,
    disabled = false,
    items?: MenuItem[]
): MenuItem {
    return {
        label,
        disabled,
        items,
        data: { symbol, testId } satisfies ProjectDocumentsMenuData,
        command: action ? (): void => action() : undefined
    };
}

export function folderContextMenu(
    folder: FolderNode,
    source: NodeSurface,
    deps: ContextMenuDeps
): MenuItem[] {
    const { can, on } = deps;
    const { locked, isReadonly, multi, mutateBlocked, copyBlocked } =
        folderMenuFlags(folder, source, deps.can);

    return [
        menuItem('Open Folder', 'folder_open', 'pd-menu-open-folder', () => {
            on.openFolder(folder);
        }),
        { separator: true },
        menuItem('Rename Folder', 'edit', 'pd-menu-rename-folder', () => {
            on.rename(folder, source);
        }, mutateBlocked || multi),
        menuItem('Copy Folder', 'content_copy', 'pd-menu-copy-folder', () => {
            on.copy(folder, source);
        }, copyBlocked),
        menuItem('Cut Folder', 'content_cut', 'pd-menu-cut-folder', () => {
            on.cut(folder, source);
        }, mutateBlocked),
        menuItem('Paste', 'content_paste', 'pd-menu-paste', () => {
            on.paste(folder);
        }, locked || !can.canPasteInto(folder)),
        menuItem('Delete Folder', 'delete', 'pd-menu-delete-folder', () => {
            on.remove(folder, source);
        }, mutateBlocked),
        { separator: true },
        menuItem(
            'Upload within folder',
            'upload',
            'pd-menu-upload-within-folder',
            undefined,
            isReadonly,
            uploadMenuItems(folder, deps)
        )
    ];
}

export function fileContextMenu(
    file: FileNode,
    source: NodeSurface,
    deps: ContextMenuDeps
): MenuItem[] {
    const { can, on } = deps;
    const locked = can.writingIds.has(file.id);
    const isReadonly = file.accessLevel === FileNodeResponseAccessLevelEnum.Readonly
        || can.isCurrentFolderReadonly;
    const multi = isMultiSelected(file, source, can.selectedIds);

    return [
        fileOpenMenuItem(file, locked, deps),
        { separator: true },
        menuItem('Rename File', 'edit', 'pd-menu-rename-file', () => {
            on.rename(file, source);
        }, locked || isReadonly || multi),
        menuItem('Copy File', 'content_copy', 'pd-menu-copy-file', () => {
            on.copy(file, source);
        }, locked),
        menuItem('Cut File', 'content_cut', 'pd-menu-cut-file', () => {
            on.cut(file, source);
        }, locked || isReadonly),
        menuItem('Delete File', 'delete', 'pd-menu-delete-file', () => {
            on.remove(file, source);
        }, locked || isReadonly),
        { separator: true },
        menuItem('Download File', 'download', 'pd-menu-download-file', () => {
            on.download(file);
        }, locked || !can.canDownload(file))
    ];
}

export function recycleBinContextMenu(
    node: FileSystemNode,
    deps: ContextMenuDeps
): MenuItem[] {
    const { can, on } = deps;

    return [
        menuItem('Restore', 'undo', 'pd-menu-restore', () => {
            on.restore(node);
        }, can.isListReadonly),
        menuItem('Delete', 'delete', 'pd-menu-permanently-delete', () => {
            on.deletePermanently(node);
        }, can.isListReadonly)
    ];
}

export function emptyContextMenu(deps: ContextMenuDeps): MenuItem[] {
    const { can, on } = deps;
    const currentFolder = can.currentFolder;
    const canUpload = currentFolder !== null && !can.isCurrentFolderReadonly;

    return [
        menuItem('Create new Folder', 'create_new_folder', 'pd-menu-create-folder', () => {
            on.createFolder();
        }, !can.canCreateFolder),
        { separator: true },
        menuItem('Paste', 'content_paste', 'pd-menu-paste', () => {
            if (currentFolder) { on.paste(currentFolder); }
        }, currentFolder === null || !can.canPasteInto(currentFolder)),
        menuItem(
            'Upload',
            'upload',
            'pd-menu-upload',
            undefined,
            !canUpload,
            currentFolder ? uploadMenuItems(currentFolder, deps) : undefined
        )
    ];
}

/** A search hit's own row: open its location, then everything the table would offer. */
export function searchResultFileMenu(file: FileNode, deps: ContextMenuDeps): MenuItem[] {
    return [
        menuItem(
            'Open File Location',
            'drive_file_move',
            'pd-menu-open-search-result',
            () => { deps.on.openSearchResultLocation(file); }
        ),
        { separator: true },
        ...fileContextMenu(file, 'search', deps)
    ];
}

/**
 * A folder hit offers no Paste or Upload: the search list is not a place, so there is no
 * destination for either.
 */
export function searchResultFolderMenu(folder: FolderNode, deps: ContextMenuDeps): MenuItem[] {
    const { can, on } = deps;
    const locked = can.writingIds.has(folder.id) ||
        folder.accessLevel === FolderNodeResponseAccessLevelEnum.Readonly ||
        can.isListReadonly;
    // Renaming many at once means nothing, so it is the one action a multi-selection
    // disables — the same rule the right-pane table applies.
    const multi = isMultiSelected(folder, 'search', can.selectedIds);

    return [
        menuItem('Open Folder', 'folder_open', 'pd-menu-open-folder', () => {
            on.activateSearchResult(folder);
        }),
        { separator: true },
        menuItem('Rename Folder', 'edit', 'pd-menu-rename-folder', () => {
            on.rename(folder, 'search');
        }, locked || multi),
        menuItem('Copy Folder', 'content_copy', 'pd-menu-copy-folder', () => {
            on.copy(folder, 'search');
        }, locked),
        menuItem('Cut Folder', 'content_cut', 'pd-menu-cut-folder', () => {
            on.cut(folder, 'search');
        }, locked),
        menuItem('Delete Folder', 'delete', 'pd-menu-delete-folder', () => {
            on.remove(folder, 'search');
        }, locked)
    ];
}

/** Search results have no folder context, so every entry is present but inert. */
export function disabledSearchContextMenu(): MenuItem[] {
    return [
        menuItem(
            'Create new Folder',
            'create_new_folder',
            'pd-menu-create-folder',
            undefined,
            true
        ),
        { separator: true },
        menuItem('Paste', 'content_paste', 'pd-menu-paste', undefined, true),
        menuItem('Upload', 'upload', 'pd-menu-upload', undefined, true)
    ];
}

export function uploadMenuItems(target: FolderNode, deps: ContextMenuDeps): MenuItem[] {
    return [
        menuItem('Folder', 'drive_folder_upload', 'pd-menu-upload-folder', () => {
            deps.on.uploadFolder(target);
        }),
        menuItem('File', 'upload_file', 'pd-menu-upload-file', () => {
            deps.on.uploadFile(target);
        })
    ];
}

/**
 * Office files offer a choice between the local and the online application. Any other
 * file type can only be opened online, so it gets a single "Open" entry instead of the
 * submenu.
 */
function fileOpenMenuItem(file: FileNode, locked: boolean, deps: ContextMenuDeps): MenuItem {
    const { can, on } = deps;
    if (!can.canOpenDesktop(file)) {
        return menuItem(
            'Open',
            'file_open',
            'pd-menu-open-file',
            () => {
                on.openFile(file);
            },
            locked || !can.canOpenOnline(file)
        );
    }
    const openItems = fileOpenMenuItems(file, locked, deps);

    return menuItem(
        'Open File in',
        'file_open',
        'pd-menu-open-file-in',
        undefined,
        openItems.every((item) => item.disabled === true),
        openItems
    );
}

function fileOpenMenuItems(file: FileNode, locked: boolean, deps: ContextMenuDeps): MenuItem[] {
    const { can, on } = deps;

    return [
        menuItem(
            'Local application',
            'grid_view',
            'pd-menu-open-local',
            () => { on.openDesktop(file); },
            locked || !can.canOpenDesktop(file)
        ),
        menuItem(
            'Online Application',
            'language',
            'pd-menu-open-online',
            () => { on.openOnline(file); },
            locked || !can.canOpenOnline(file)
        )
    ];
}

interface FolderMenuFlags {
    locked: boolean;
    isReadonly: boolean;
    multi: boolean;
    mutateBlocked: boolean;
    copyBlocked: boolean;
}

/**
 * A root cannot be renamed, moved or deleted, and neither can a protected or read-only
 * folder. Copying one is still fine, which is why the two blocks differ.
 */
function folderMenuFlags(
    folder: FolderNode,
    source: NodeSurface,
    can: ContextMenuCapabilities
): FolderMenuFlags {
    const locked = can.writingIds.has(folder.id);
    const root = folder.parentId === null;
    const isProtected = folder.accessLevel === FolderNodeResponseAccessLevelEnum.Protected;
    const isReadonly = isFolderReadonly(folder, can);

    return {
        locked,
        isReadonly,
        multi: isMultiSelected(folder, source, can.selectedIds),
        mutateBlocked: root || locked || isProtected || isReadonly,
        copyBlocked: root || locked
    };
}

/** A folder's own access level, or its list's, whichever forbids first. */
function isFolderReadonly(folder: FolderNode, can: ContextMenuCapabilities): boolean {
    if (folder.accessLevel === FolderNodeResponseAccessLevelEnum.Readonly) {
        return true;
    }

    return folder.listKey ? can.readonlyByList.get(folder.listKey) ?? false : false;
}

/**
 * Whether this row is part of a multi-selection. Delete and Copy act on the whole
 * selection; Rename stays single-item, since renaming many at once means nothing. The
 * tree is single-item throughout, so a tree row is never part of one.
 */
export function isMultiSelected(
    node: FileSystemNode,
    source: NodeSurface,
    selectedIds: ReadonlySet<string>
): boolean {
    return source !== 'tree' && selectedIds.size > 1 && selectedIds.has(node.id);
}
