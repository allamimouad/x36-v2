import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type FileSystemIconName =
    | 'docx'
    | 'folder'
    | 'pdf'
    | 'photo'
    | 'pptx'
    | 'txt'
    | 'video'
    | 'xlsx';

type FileExtensionIconName = Exclude<FileSystemIconName, 'folder'>;

const DEFAULT_FILE_ICON: FileExtensionIconName = 'txt';

const FILE_EXTENSION_ICONS: Readonly<Record<string, FileExtensionIconName>> = {
    avi: 'video',
    csv: 'xlsx',
    doc: 'docx',
    docx: 'docx',
    gif: 'photo',
    jpeg: 'photo',
    jpg: 'photo',
    m4v: 'video',
    md: 'txt',
    mov: 'video',
    mp4: 'video',
    mpeg: 'video',
    mpg: 'video',
    pdf: 'pdf',
    png: 'photo',
    ppt: 'pptx',
    pptx: 'pptx',
    svg: 'photo',
    txt: 'txt',
    webm: 'video',
    xls: 'xlsx',
    xlsx: 'xlsx'
};

@Component({
    selector: 'pr-file-system-icon',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './file-system-icon.html',
    styleUrl: './file-system-icon.scss'
})
export class FileSystemIcon {
    private static readonly iconBasePath = 'assets/file-manager/icons';

    public readonly name = input<FileSystemIconName>(DEFAULT_FILE_ICON);
    public readonly fileName = input<string | null>(null);

    protected readonly src = computed(() => {
        const fileName = this.fileName();
        const iconName = fileName ? this.iconNameForFileName(fileName) : this.name();

        return `${FileSystemIcon.iconBasePath}/${iconName}.svg`;
    });

    private iconNameForFileName(fileName: string): FileExtensionIconName {
        const ext = fileName.toLowerCase().split('.').pop() ?? '';

        return FILE_EXTENSION_ICONS[ext] ?? DEFAULT_FILE_ICON;
    }
}
