import type { FileSystemNode } from '../models/file-system-node.model';

/** Chromium's drag type for "save this URL as a file where the drag is dropped". */
export const DOWNLOAD_DRAG_TYPE = 'DownloadURL';

/**
 * `value` as a normalised http(s) URL, or null when it is missing, malformed, uses
 * another scheme, or carries credentials.
 */
export function safeWebUrl(value: string | undefined): string | null {
    if (!value) { return null; }
    try {
        const url = new URL(value);
        const safeProtocol = url.protocol === 'http:' || url.protocol === 'https:';

        return safeProtocol && !url.username && !url.password ? url.href : null;
    } catch {
        return null;
    }
}

/**
 * The `DownloadURL` payload that lets a file be dragged out of the browser onto the
 * desktop or a file manager, or null when `node` cannot be offered that way.
 *
 * The format is `<mime>:<file name>:<url>`, split on the first two colons, so a name
 * containing one would corrupt it. The browser fetches the URL itself after the drop,
 * with its own cookies, exactly as the Download menu entry does.
 */
export function downloadDragData(node: FileSystemNode): string | null {
    if (node.kind !== 'file' || node.name.includes(':')) { return null; }
    const url = safeWebUrl(node.downloadUrl);

    return url ? `application/octet-stream:${node.name}:${url}` : null;
}
