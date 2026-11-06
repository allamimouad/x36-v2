import { provideHttpClient, withInterceptorsFromDi } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { DialogService } from 'primeng/dynamicdialog';
import { Subject } from 'rxjs';
import type { FileSystemNode, FolderNode } from './models/file-system-node.model';
import { isFolder } from './models/file-system-node.model';
import { ProjectDocuments } from './project-documents';
import { FileSystemApi } from './services/file-system/file-system-api';
import { DragDropService } from './services/interaction/drag-drop.service';
import { UploadService } from './services/upload/upload.service';
import { MOCK_CONFIG } from './services/mock/mock-config.token';
import { FileSystemStore } from './stores/file-system.store';
import { NavigationStore } from './stores/navigation.store';
import { ProjectOverviewService } from '../../services/project-overview.service';

describe('ProjectDocuments internal drag wiring', () => {
    let fixture: ComponentFixture<ProjectDocuments>;
    let store: InstanceType<typeof FileSystemStore>;
    let navigation: InstanceType<typeof NavigationStore>;
    let drag: DragDropService;
    let api: FileSystemApi;

    beforeEach(async () => {
        await TestBed.configureTestingModule({ imports: [ProjectDocuments], providers: [
            provideRouter([]), provideNoopAnimations(), DialogService, ProjectOverviewService,
            provideHttpClient(withInterceptorsFromDi()), provideHttpClientTesting(),
            { provide: MOCK_CONFIG, useValue: {
                minLatencyMs: 0, maxLatencyMs: 0, errorRate: 0, enableErrors: false
            } }
        ] }).compileComponents();
        fixture = TestBed.createComponent(ProjectDocuments);
        fixture.componentRef.setInput('id', 'project');
        const injector = fixture.debugElement.injector;
        store = injector.get(FileSystemStore);
        navigation = injector.get(NavigationStore);
        drag = injector.get(DragDropService);
        api = injector.get(FileSystemApi);
        await render();
    });

    async function render(): Promise<void> {
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
    }

    function element(selector: string): HTMLElement {
        const host = fixture.nativeElement as HTMLElement;
        const found = host.querySelector<HTMLElement>(selector);
        if (!found) { throw new Error(`Missing element: ${selector}`); }

        return found;
    }

    function folder(name: string): FolderNode {
        const node = store.entities().find((candidate) => candidate.name === name &&
            isFolder(candidate) && !candidate.isRecycleBin);
        if (!node || !isFolder(node)) { throw new Error(`Missing folder ${name}`); }

        return node;
    }

    function root(listKey: 'EXECUTION' | 'MARKETING'): FolderNode {
        const state = store.initializedRoots()?.[listKey];
        if (state?.status !== 'loaded') { throw new Error('Missing root'); }

        return state.root;
    }

    function dispatch(
        target: HTMLElement, type: string, dataTransfer: DataTransfer, ctrlKey = false
    ): DragEvent {
        const event = new DragEvent(type, { dataTransfer, ctrlKey,
            bubbles: true, cancelable: true });
        target.dispatchEvent(event);

        return event;
    }

    /** Where each target surface drops: the tree's other root, a table row, or the view. */
    function targetFolder(targetSurface: 'tree' | 'table' | 'current-folder'): FolderNode {
        switch (targetSurface) {
            case 'tree': return root('MARKETING');
            case 'table': return folder('Schedules');
            default: return root('EXECUTION');
        }
    }

    function nodeSelector(surface: 'tree' | 'table', id: string): string {
        return surface === 'tree'
            ? `[data-testid="pd-tree-node-${id}"]`
            : `[data-testid="pd-row-${id}"]`;
    }

    /**
     * Built outside the loops below on purpose. Declaring the test body inside them
     * closes over `api`, `drag`, `navigation` and `store`, which `beforeEach` reassigns
     * for every test — safe here only because the body runs after that assignment, which
     * is precisely the reasoning `no-loop-func` cannot do. A factory keeps the closure
     * out of the loop and the surfaces explicit.
     */
    function connectsCase(
        sourceSurface: 'tree' | 'table',
        targetSurface: 'tree' | 'table' | 'current-folder'
    ): () => Promise<void> {
        return async (): Promise<void> => {
            const source = folder('Contracts');
            const target = targetFolder(targetSurface);
            const sourceSelector = sourceSurface === 'tree'
                ? `[data-testid="pd-tree-node-${source.id}"]`
                : `[data-testid="pd-row-${source.id}"]`;
            const targetSelector = targetSurface === 'current-folder'
                ? '.pd-current-folder-space'
                : nodeSelector(targetSurface, target.id);
            const copying = targetSurface === 'current-folder';
            const mutation = spyOn(api, copying ? 'copy' : 'move').and.callThrough();
            const data = new DataTransfer();
            expect(element(sourceSelector).draggable).toBeTrue();
            const started = dispatch(element(sourceSelector), 'dragstart', data);
            expect(started.defaultPrevented).toBeFalse();
            await render();
            const over = dispatch(element(targetSelector), 'dragover', data, copying);
            expect(over.defaultPrevented).toBeTrue();
            expect(drag.target()).toEqual({ id: target.id, surface: targetSurface });
            dispatch(element(targetSelector), 'drop', data, copying);
            await render();
            expect(mutation).toHaveBeenCalledTimes(1);
            expect(drag.state()).toBeNull();
            expect(drag.target()).toBeNull();
            expect(navigation.currentFolderId()).toBe(root('EXECUTION').id);
            if (!copying) {
                expect(store.entityMap()[source.id].parentId).toBe(target.id);
            }
        };
    }

    for (const sourceSurface of ['tree', 'table'] as const) {
        for (const targetSurface of ['tree', 'table', 'current-folder'] as const) {
            it(
                `connects ${sourceSurface} to ${targetSurface}`,
                connectsCase(sourceSurface, targetSurface)
            );
        }
    }

    it('moves a file from the table into a tree folder', async () => {
        const contracts = folder('Contracts');
        navigation.navigateTo(contracts.id);
        await render();
        const file = navigation.currentFolderChildren().files[0];
        if (!file) { throw new Error('Expected a file'); }
        const target = folder('Schedules');
        const data = new DataTransfer();
        dispatch(element(`[data-testid="pd-row-${file.id}"]`), 'dragstart', data);
        const targetElement = element(`[data-testid="pd-tree-node-${target.id}"]`);
        dispatch(targetElement, 'dragover', data);
        dispatch(targetElement, 'drop', data);
        await render();
        expect(store.entityMap()[file.id].parentId).toBe(target.id);
        expect(navigation.currentFolderId()).toBe(contracts.id);
    });

    it('cancels with Escape and clears the source and target highlights', async () => {
        const source = folder('Contracts');
        const target = root('MARKETING');
        const move = spyOn(api, 'move').and.callThrough();
        const data = new DataTransfer();
        dispatch(element(`[data-testid="pd-row-${source.id}"]`), 'dragstart', data);
        dispatch(element(`[data-testid="pd-tree-node-${target.id}"]`), 'dragover', data);
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await render();
        expect(drag.state()).toBeNull();
        expect(drag.target()).toBeNull();
        dispatch(element(`[data-testid="pd-tree-node-${target.id}"]`), 'drop', data);
        await render();
        expect(move).not.toHaveBeenCalled();
    });

    it('never turns an internal drag carrying Files into an external upload', async () => {
        const source = folder('Contracts');
        const target = folder('Schedules');
        const uploads = fixture.debugElement.injector.get(UploadService);
        const enqueue = spyOn(uploads, 'enqueueFiles').and.callThrough();
        const data = new DataTransfer();
        data.items.add(new File(['contents'], 'unexpected.txt'));
        dispatch(element(`[data-testid="pd-row-${source.id}"]`), 'dragstart', data);
        dispatch(element(`[data-testid="pd-row-${target.id}"]`), 'dragover', data);
        dispatch(element(`[data-testid="pd-row-${target.id}"]`), 'drop', data);
        await render();
        expect(store.entityMap()[source.id].parentId).toBe(target.id);
        expect(enqueue).not.toHaveBeenCalled();
    });

    function recycleBin(listKey: string): FolderNode {
        const bin = store.entities().find((node): node is FolderNode =>
            isFolder(node) && node.isRecycleBin && node.listKey === listKey);
        if (!bin) { throw new Error(`Missing bin for ${listKey}`); }

        return bin;
    }

    it('deletes an item dropped on its own list bin', async () => {
        const source = folder('Contracts');
        const remove = spyOn(api, 'delete').and.callThrough();
        const move = spyOn(api, 'move').and.callThrough();
        const data = new DataTransfer();
        dispatch(element(`[data-testid="pd-row-${source.id}"]`), 'dragstart', data);
        const binElement = element(
            `[data-testid="pd-tree-node-${recycleBin(source.listKey).id}"]`
        );

        dispatch(binElement, 'dragover', data);
        expect(drag.target()?.id).toBe(recycleBin(source.listKey).id);
        dispatch(binElement, 'drop', data);
        await render();

        expect(remove).toHaveBeenCalled();
        // The drop target is only an affordance: the backend routes the item itself.
        expect(move).not.toHaveBeenCalled();
        expect(store.entityMap()[source.id]).toBeUndefined();
    });

    it('rejects a recycle bin belonging to another list', async () => {
        const source = folder('Contracts');
        const other = source.listKey === 'EXECUTION' ? 'MARKETING' : 'EXECUTION';
        const remove = spyOn(api, 'delete').and.callThrough();
        const data = new DataTransfer();
        dispatch(element(`[data-testid="pd-row-${source.id}"]`), 'dragstart', data);
        const binElement = element(`[data-testid="pd-tree-node-${recycleBin(other).id}"]`);

        dispatch(binElement, 'dragover', data);
        expect(drag.target()).toBeNull();
        dispatch(binElement, 'drop', data);
        await render();

        expect(remove).not.toHaveBeenCalled();
        expect(store.entityMap()[source.id]).toBeDefined();
    });

    it('retains drag source elements when hover expansion loads more nodes', async () => {
        const source = folder('Schedules');
        const rowSelector = `[data-testid="pd-row-${source.id}"]`;
        const treeSelector = `[data-testid="pd-tree-node-${source.id}"]`;
        const originalRow = element(rowSelector);
        const originalTreeNode = element(treeSelector);
        const data = new DataTransfer();
        dispatch(originalRow, 'dragstart', data);
        navigation.expand(folder('Contracts').id);
        await render();
        expect(element(rowSelector)).toBe(originalRow);
        expect(element(treeSelector)).toBe(originalTreeNode);
        dispatch(originalRow, 'dragend', data);
        expect(drag.state()).toBeNull();
    });

    it('cleans up an active drag when the project changes', async () => {
        const source = folder('Contracts');
        dispatch(element(`[data-testid="pd-row-${source.id}"]`), 'dragstart', new DataTransfer());
        fixture.componentRef.setInput('id', 'next-project');
        await render();
        expect(drag.state()).toBeNull();
        expect(drag.target()).toBeNull();
    });

    it('suppresses completion UI after component destruction', async () => {
        const source = folder('Contracts');
        const target = root('MARKETING');
        const response = new Subject<FileSystemNode>();
        spyOn(api, 'move').and.returnValue(response);
        const data = new DataTransfer();
        dispatch(element(`[data-testid="pd-row-${source.id}"]`), 'dragstart', data);
        const pending = drag.drop(new DragEvent('drop', { dataTransfer: data }), target.id);
        const navigate = spyOn(navigation, 'navigateTo').and.callThrough();
        fixture.destroy();
        response.next({ ...source, parentId: target.id });
        response.complete();
        await pending;
        expect(navigate).not.toHaveBeenCalled();
        expect(drag.state()).toBeNull();
    });
});
