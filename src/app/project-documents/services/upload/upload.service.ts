import {
    DestroyRef,
    Injectable,
    computed,
    inject,
    signal,
    type Signal
} from '@angular/core';
import type { FileSystemErrorCode } from '../../models/file-system-error.model';
import { FileSystemError } from '../../models/file-system-error.model';
import type { FolderNode } from '../../models/file-system-node.model';
import type { UploadBatch, UploadTask } from '../../models/upload-task.model';
import { FILE_MANAGER_CONFIG } from '../../tokens/file-manager-config.token';
import { validateName } from '../../utils/naming.utils';
import { FileSystemStore } from '../../stores/file-system.store';
import { ConcurrencyQueue } from './concurrency-queue';
import {
    buildDirectoryManifest,
    type DirectoryManifest,
    type LocalDirectoryEntry,
    type LocalFileEntry
} from './directory-manifest';
import {
    directoryCancellationMessage,
    formatBytes,
    isActiveTask,
    isCancellation,
    isRetryableTask,
    uploadErrorCode,
    uploadErrorMessage
} from './upload.utils';

interface DirectoryUploadContext {
    batchId: string;
    controller: AbortController;
    rootHandle: FileSystemDirectoryHandle;
    target: FolderNode;
    preparationStarted: boolean;
}

@Injectable()
export class UploadService {
    public readonly tasks: Signal<readonly UploadTask[]>;
    public readonly batches: Signal<readonly UploadBatch[]>;
    public readonly hasUploads: Signal<boolean>;

    private readonly fileSystem = inject(FileSystemStore);
    private readonly config = inject(FILE_MANAGER_CONFIG);
    private readonly destroyRef = inject(DestroyRef);
    private readonly fileUploadQueue = new ConcurrencyQueue(this.config.uploadConcurrency);
    private readonly directoryPreparationQueue = new ConcurrencyQueue(1);
    private readonly taskControllers = new Map<string, AbortController>();
    private readonly batchControllers = new Map<string, AbortController>();
    private readonly _tasks = signal<UploadTask[]>([]);
    private readonly _batches = signal<UploadBatch[]>([]);
    private destroyed = false;

    constructor() {
        this.tasks = this._tasks.asReadonly();
        this.batches = this._batches.asReadonly();
        this.hasUploads = computed(
            () => this._tasks().length > 0 || this._batches().length > 0
        );
        this.destroyRef.onDestroy(() => {
            this.destroyed = true;
            for (const controller of this.taskControllers.values()) {
                controller.abort();
            }
            for (const controller of this.batchControllers.values()) {
                controller.abort();
            }
        });
    }

    public enqueueFiles(files: readonly File[], target: FolderNode): void {
        for (const file of files) {
            this.addFileTask(file, target.id, file.name);
        }
    }

    public async enqueueDirectory(
        rootHandle: FileSystemDirectoryHandle,
        target: FolderNode
    ): Promise<void> {
        const context = this.startDirectoryBatch(rootHandle, target);
        try {
            await this.directoryPreparationQueue.enqueue(() =>
                this.prepareDirectoryBatch(context)
            );
        } catch (error) {
            this.failDirectoryBatch(context, error);
        } finally {
            this.batchControllers.delete(context.batchId);
        }
    }

    public cancelTask(id: string): void {
        const task = this.task(id);
        if (!task || !isActiveTask(task)) { return; }
        this.updateTask(id, {
            status: 'cancelled',
            error: undefined,
            errorCode: 'cancelled'
        });
        this.taskControllers.get(id)?.abort();
        if (task.batchId) { this.refreshBatch(task.batchId); }
    }

    public cancelBatch(id: string): void {
        const batch = this.batch(id);
        if (!batch || batch.status !== 'queued' && batch.status !== 'preparing') {
            return;
        }
        this.batchControllers.get(id)?.abort();
        if (batch.status === 'queued') {
            this.updateBatch(id, {
                status: 'cancelled',
                error: 'Folder preparation was cancelled.'
            });
        }
    }

    public retryTask(id: string): void {
        const task = this.task(id);
        if (!task || !isRetryableTask(task)) { return; }
        this.updateTask(id, {
            status: 'queued',
            progress: 0,
            error: undefined,
            errorCode: undefined
        });
        if (task.batchId) {
            this.updateBatch(task.batchId, { status: 'uploading', error: undefined });
        }
        this.scheduleTask(id);
    }

    public clearCompleted(): void {
        this._tasks.update((tasks) => tasks.filter(isActiveTask));
        const remainingBatchIds = new Set(
            this._tasks()
                .map((task) => task.batchId)
                .filter((id): id is string => id !== undefined)
        );
        this._batches.update((batches) =>
            batches.filter(
                (batch) =>
                    batch.status === 'queued' ||
                    batch.status === 'preparing' ||
                    batch.status === 'uploading' ||
                    remainingBatchIds.has(batch.id)
            )
        );
    }

    public reset(): void {
        for (const controller of this.taskControllers.values()) {
            controller.abort();
        }
        for (const controller of this.batchControllers.values()) {
            controller.abort();
        }
        this.taskControllers.clear();
        this.batchControllers.clear();
        this._tasks.set([]);
        this._batches.set([]);
    }

    private startDirectoryBatch(
        rootHandle: FileSystemDirectoryHandle,
        target: FolderNode
    ): DirectoryUploadContext {
        const context: DirectoryUploadContext = {
            batchId: crypto.randomUUID(),
            controller: new AbortController(),
            rootHandle,
            target,
            preparationStarted: false
        };
        this.batchControllers.set(context.batchId, context.controller);
        this._batches.update((batches) => [
            ...batches,
            {
                id: context.batchId,
                rootName: rootHandle.name,
                targetParentId: target.id,
                status: 'queued',
                directoryCount: 0,
                createdDirectoryCount: 0,
                fileCount: 0
            }
        ]);

        return context;
    }

    private async prepareDirectoryBatch(context: DirectoryUploadContext): Promise<void> {
        const { batchId, controller, rootHandle } = context;
        this.throwIfCancelled(controller.signal);
        context.preparationStarted = true;
        this.updateBatch(batchId, { status: 'preparing' });
        const manifest = await buildDirectoryManifest(rootHandle, controller.signal);
        this.assertValidDirectories(manifest.directories);
        this.updateBatch(batchId, {
            directoryCount: manifest.directories.length,
            fileCount: manifest.files.length
        });
        const remoteFolders = await this.createManifestFolders(context, manifest);
        this.throwIfCancelled(controller.signal);
        this.enqueueManifestFiles(context, manifest, remoteFolders);
        this.updateBatch(batchId, {
            status: manifest.files.length === 0 ? 'done' : 'uploading'
        });
        this.refreshBatch(batchId);
    }

    private async createManifestFolders(
        context: DirectoryUploadContext,
        manifest: DirectoryManifest
    ): Promise<Map<string, FolderNode>> {
        const remoteFolders = new Map<string, FolderNode>();
        for (const localDirectory of manifest.directories) {
            this.throwIfCancelled(context.controller.signal);
            const parentId = this.manifestParentId(
                localDirectory,
                context.target.id,
                remoteFolders
            );
            const created = await this.fileSystem.createFolder(
                parentId,
                localDirectory.name
            );
            remoteFolders.set(localDirectory.relativePath, created);
            this.recordCreatedDirectory(context, localDirectory, created);
        }

        return remoteFolders;
    }

    private manifestParentId(
        directory: LocalDirectoryEntry,
        targetId: string,
        remoteFolders: ReadonlyMap<string, FolderNode>
    ): string {
        if (directory.parentRelativePath === null) { return targetId; }
        const parentId = remoteFolders.get(directory.parentRelativePath)?.id;
        if (parentId) { return parentId; }
        throw new FileSystemError(
            'not-found',
            `Parent folder was not created for ${directory.relativePath}`
        );
    }

    private recordCreatedDirectory(
        context: DirectoryUploadContext,
        directory: LocalDirectoryEntry,
        created: FolderNode
    ): void {
        const current = this.batch(context.batchId);
        const rootName = directory.parentRelativePath === null
            ? created.name
            : current?.rootName ?? context.rootHandle.name;
        this.updateBatch(context.batchId, {
            rootName,
            createdDirectoryCount: (current?.createdDirectoryCount ?? 0) + 1
        });
    }

    private enqueueManifestFiles(
        context: DirectoryUploadContext,
        manifest: DirectoryManifest,
        remoteFolders: ReadonlyMap<string, FolderNode>
    ): void {
        const remoteRootName = remoteFolders.get(manifest.root.relativePath)?.name
            ?? manifest.root.name;
        for (const localFile of manifest.files) {
            const remoteParent = remoteFolders.get(localFile.parentRelativePath);
            if (!remoteParent) {
                throw new FileSystemError(
                    'not-found',
                    `Destination folder was not created for ${localFile.relativePath}`
                );
            }
            this.addManifestFileTask(
                localFile,
                remoteParent,
                context.batchId,
                manifest.root.name,
                remoteRootName
            );
        }
    }

    private failDirectoryBatch(context: DirectoryUploadContext, error: unknown): void {
        const cancelled = context.controller.signal.aborted || isCancellation(error);
        this.updateBatch(context.batchId, {
            status: cancelled ? 'cancelled' : 'error',
            error: cancelled
                ? directoryCancellationMessage(context.preparationStarted)
                : uploadErrorMessage(error)
        });
    }

    private addManifestFileTask(
        entry: LocalFileEntry,
        parent: FolderNode,
        batchId: string,
        localRootName: string,
        remoteRootName: string
    ): void {
        const suffix = entry.relativePath.slice(localRootName.length);
        this.addFileTask(
            entry.file,
            parent.id,
            `${remoteRootName}${suffix}`,
            batchId
        );
    }

    private addFileTask(
        file: File,
        parentId: string,
        relativePath: string,
        batchId?: string
    ): void {
        const validationError = this.fileValidationError(file);
        const task: UploadTask = {
            id: crypto.randomUUID(),
            batchId,
            file,
            parentId,
            relativePath,
            status: validationError ? 'error' : 'queued',
            progress: 0,
            error: validationError?.message,
            errorCode: validationError?.code
        };
        this._tasks.update((tasks) => [...tasks, task]);
        if (validationError) {
            if (batchId) { this.refreshBatch(batchId); }

            return;
        }
        this.scheduleTask(task.id);
    }

    private scheduleTask(id: string): void {
        void this.fileUploadQueue.enqueue(() => this.runTask(id))
            .catch((error: unknown) => this.failTask(id, error));
    }

    private async runTask(id: string): Promise<void> {
        const queued = this.task(id);
        if (this.destroyed || queued?.status !== 'queued') { return; }
        const controller = new AbortController();
        this.taskControllers.set(id, controller);
        this.updateTask(id, { status: 'uploading', progress: 0 });
        try {
            await this.uploadTask(id, queued, controller.signal);
            if (this.task(id)?.status !== 'cancelled') {
                this.updateTask(id, { status: 'done', progress: 100 });
            }
        } catch (error) {
            if (controller.signal.aborted || isCancellation(error)) {
                this.cancelRunningTask(id);
            } else {
                this.failTask(id, error);
            }
        } finally {
            this.finishTask(id);
        }
    }

    private async uploadTask(
        id: string,
        task: UploadTask,
        abortSignal: AbortSignal
    ): Promise<void> {
        await this.fileSystem.upload(
            task.parentId,
            task.file,
            (progress) => this.reportTaskProgress(id, progress),
            abortSignal
        );
    }

    private reportTaskProgress(id: string, progress: number): void {
        const current = this.task(id);
        if (!current || current.status === 'cancelled') { return; }
        this.updateTask(id, {
            status: progress >= 100 ? 'finalizing' : 'uploading',
            progress
        });
    }

    private cancelRunningTask(id: string): void {
        this.updateTask(id, {
            status: 'cancelled',
            error: undefined,
            errorCode: 'cancelled'
        });
    }

    private failTask(id: string, error: unknown): void {
        this.updateTask(id, {
            status: 'error',
            error: uploadErrorMessage(error),
            errorCode: uploadErrorCode(error)
        });
    }

    private finishTask(id: string): void {
        this.taskControllers.delete(id);
        const batchId = this.task(id)?.batchId;
        if (batchId) { this.refreshBatch(batchId); }
    }

    private refreshBatch(id: string): void {
        const batchTasks = this._tasks().filter((task) => task.batchId === id);
        if (batchTasks.length === 0) { return; }
        if (batchTasks.some(isActiveTask)) {
            this.updateBatch(id, { status: 'uploading' });

            return;
        }
        if (batchTasks.every((task) => task.status === 'done')) {
            this.updateBatch(id, { status: 'done' });

            return;
        }
        if (batchTasks.some((task) => task.status === 'error')) {
            this.updateBatch(id, { status: 'error' });

            return;
        }
        this.updateBatch(id, { status: 'cancelled' });
    }

    private assertValidDirectories(
        directories: readonly { name: string; relativePath: string }[]
    ): void {
        for (const directory of directories) {
            if (validateName(directory.name).valid) { continue; }
            throw new FileSystemError(
                'invalid-name',
                `Folder name is not supported: ${directory.relativePath}`
            );
        }
    }

    private fileValidationError(
        file: File
    ): { code: FileSystemErrorCode; message: string } | undefined {
        if (!validateName(file.name).valid) {
            return { code: 'invalid-name', message: 'This file name is not supported.' };
        }
        if (file.size > this.config.maxUploadSizeBytes) {
            return {
                code: 'too-large',
                message: `File exceeds the ${formatBytes(this.config.maxUploadSizeBytes)} limit.`
            };
        }

        return undefined;
    }

    private throwIfCancelled(abortSignal: AbortSignal): void {
        if (abortSignal.aborted) {
            throw new FileSystemError('cancelled', 'Folder upload was cancelled');
        }
    }

    private task(id: string): UploadTask | undefined {
        return this._tasks().find((task) => task.id === id);
    }

    private batch(id: string): UploadBatch | undefined {
        return this._batches().find((batch) => batch.id === id);
    }

    private updateTask(id: string, changes: Partial<UploadTask>): void {
        this._tasks.update((tasks) =>
            tasks.map((task) => task.id === id ? { ...task, ...changes } : task)
        );
    }

    private updateBatch(id: string, changes: Partial<UploadBatch>): void {
        this._batches.update((batches) =>
            batches.map((batch) => batch.id === id ? { ...batch, ...changes } : batch)
        );
    }
}
