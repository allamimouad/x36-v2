import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type FileSystemPrimeIconName =
    | 'docx'
    | 'folder'
    | 'pdf'
    | 'photo'
    | 'pptx'
    | 'txt'
    | 'video'
    | 'xlsx';

type FileExtensionPrimeIconName = Exclude<FileSystemPrimeIconName, 'folder'>;

const DEFAULT_FILE_ICON: FileExtensionPrimeIconName = 'txt';

const FILE_EXTENSION_ICONS: Readonly<Record<string, FileExtensionPrimeIconName>> = {
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

const PRIME_ICON_CLASSES: Readonly<Record<FileSystemPrimeIconName, string>> = {
    docx: 'pi pi-file-word',
    folder: 'pi pi-folder',
    pdf: 'pi pi-file-pdf',
    photo: 'pi pi-image',
    pptx: 'pi pi-file',
    txt: 'pi pi-file-edit',
    video: 'pi pi-video',
    xlsx: 'pi pi-file-excel'
};

@Component({
    selector: 'pr-file-system-prime-icon',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './file-system-prime-icon.component.html',
    styleUrl: './file-system-prime-icon.component.scss'
})
export class FileSystemPrimeIconComponent {
    public readonly name = input<FileSystemPrimeIconName>(DEFAULT_FILE_ICON);
    public readonly fileName = input<string | null>(null);

    protected readonly iconName = computed<FileSystemPrimeIconName>(() => {
        const fileName = this.fileName();

        return fileName ? this.iconNameForFileName(fileName) : this.name();
    });

    protected readonly iconClass = computed(() => PRIME_ICON_CLASSES[this.iconName()]);

    private iconNameForFileName(fileName: string): FileExtensionPrimeIconName {
        const ext = fileName.toLowerCase().split('.').pop() ?? '';

        return FILE_EXTENSION_ICONS[ext] ?? DEFAULT_FILE_ICON;
    }
}
