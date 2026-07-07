import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type FileSystemSymbolIconName =
    | 'docx'
    | 'folder'
    | 'pdf'
    | 'photo'
    | 'pptx'
    | 'txt'
    | 'video'
    | 'xlsx';

type FileExtensionSymbolIconName = Exclude<FileSystemSymbolIconName, 'folder'>;

const DEFAULT_FILE_ICON: FileExtensionSymbolIconName = 'txt';

const FILE_EXTENSION_ICONS: Readonly<Record<string, FileExtensionSymbolIconName>> = {
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

/** Material Symbols ligature per logical icon name. */
const SYMBOL_GLYPHS: Readonly<Record<FileSystemSymbolIconName, string>> = {
    docx: 'description',
    folder: 'folder',
    pdf: 'picture_as_pdf',
    photo: 'image',
    pptx: 'slideshow',
    txt: 'text_snippet',
    video: 'movie',
    xlsx: 'table'
};

@Component({
    selector: 'pr-file-system-symbol-icon',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './file-system-symbol-icon.html',
    styleUrl: './file-system-symbol-icon.scss'
})
export class FileSystemSymbolIcon {
    public readonly name = input<FileSystemSymbolIconName>(DEFAULT_FILE_ICON);
    public readonly fileName = input<string | null>(null);

    protected readonly iconName = computed<FileSystemSymbolIconName>(() => {
        const fileName = this.fileName();

        return fileName ? this.iconNameForFileName(fileName) : this.name();
    });

    protected readonly glyph = computed(() => SYMBOL_GLYPHS[this.iconName()]);

    private iconNameForFileName(fileName: string): FileExtensionSymbolIconName {
        const ext = fileName.toLowerCase().split('.').pop() ?? '';

        return FILE_EXTENSION_ICONS[ext] ?? DEFAULT_FILE_ICON;
    }
}
