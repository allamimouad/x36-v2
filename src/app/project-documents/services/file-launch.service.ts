import { DOCUMENT } from '@angular/common';
import { inject, Injectable } from '@angular/core';
import type { FileNode } from '../models/file-system-node.model';

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

    public canOpenOnline(file: FileNode): boolean {
        return this.safeWebUrl(file.onlineUrl) !== null;
    }

    public canOpenDesktop(file: FileNode): boolean {
        return this.safeDesktopUrl(file.desktopUrl) !== null;
    }

    public canDownload(file: FileNode): boolean {
        return this.safeWebUrl(file.downloadUrl) !== null;
    }

    public openOnline(file: FileNode): boolean {
        const url = this.safeWebUrl(file.onlineUrl);
        const view = this.document.defaultView;
        if (!url || !view) { return false; }
        try {
            view.open(url, '_blank', 'noopener');

            return true;
        } catch {
            return false;
        }
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

    private safeDesktopUrl(value: string | undefined): string | null {
        if (!value || /[\r\n]/.test(value)) { return null; }
        const match = DESKTOP_URL_PATTERN.exec(value);
        if (!match || !this.safeWebUrl(match[1])) { return null; }

        return value;
    }
}
