import { DOCUMENT } from '@angular/common';
import { inject, Injectable } from '@angular/core';
import type { FileNode, FolderNode } from '../../models/file-system-node.model';

const DESKTOP_PROTOCOLS = [
    'ms-word',
    'ms-excel',
    'ms-powerpoint',
    'ms-visio',
    'ms-access',
    'ms-project',
    'ms-publisher'
].join('|');
const DESKTOP_URL_PATTERN = new RegExp(
    `^(?:${DESKTOP_PROTOCOLS}):of[ev]\\|u\\|(https?:\\/\\/.+)$`,
    'i'
);

@Injectable()
export class FileLaunchService {
    private readonly document = inject(DOCUMENT);

    public canOpenSharePointWeb(folder: FolderNode): boolean {
        return this.safeWebUrl(folder.webUrl) !== null;
    }

    public canOpenOnline(file: FileNode): boolean {
        return this.safeWebUrl(file.onlineUrl) !== null;
    }

    public canOpenDesktop(file: FileNode): boolean {
        return this.safeDesktopUrl(file.desktopUrl) !== null;
    }

    public canDownload(file: FileNode): boolean {
        return this.safeWebUrl(file.downloadUrl) !== null;
    }

    public openSharePointWeb(folder: FolderNode): boolean {
        return this.openWebUrl(folder.webUrl);
    }

    public openOnline(file: FileNode): boolean {
        return this.openWebUrl(file.onlineUrl);
    }

    public openDesktop(file: FileNode): boolean {
        const url = this.safeDesktopUrl(file.desktopUrl);
        const view = this.document.defaultView;
        if (!url || !view) { return false; }
        try {
            view.location.assign(url);

            return true;
        } catch {
            return false;
        }
    }

    public download(file: FileNode): boolean {
        const url = this.safeWebUrl(file.downloadUrl);
        if (!url) { return false; }
        try {
            const anchor = this.document.createElement('a');
            anchor.href = url;
            anchor.rel = 'noopener';
            anchor.target = '_blank';
            anchor.style.display = 'none';
            this.document.body.append(anchor);
            anchor.click();
            anchor.remove();

            return true;
        } catch {
            return false;
        }
    }

    private safeWebUrl(value: string | undefined): string | null {
        if (!value) { return null; }
        try {
            const url = new URL(value);
            const safeProtocol = url.protocol === 'http:' || url.protocol === 'https:';

            return safeProtocol && !url.username && !url.password ? url.href : null;
        } catch {
            return null;
        }
    }

    private openWebUrl(value: string | undefined): boolean {
        const url = this.safeWebUrl(value);
        const view = this.document.defaultView;
        if (!url || !view) { return false; }
        try {
            view.open(url, '_blank', 'noopener');

            return true;
        } catch {
            return false;
        }
    }

    private safeDesktopUrl(value: string | undefined): string | null {
        if (!value || /[\r\n]/.test(value)) { return null; }
        const match = DESKTOP_URL_PATTERN.exec(value);
        if (!match || !this.safeWebUrl(match[1])) { return null; }

        return value;
    }
}
