import { Observable, type Subscriber } from 'rxjs';
import { FileSystemError } from '../../models/file-system-error.model';
import type { FileNode } from '../../models/file-system-node.model';

export interface MockUploadOptions {
    fileSize: number;
    maxUploadSizeBytes: number;
    onProgress: (percent: number) => void;
    signal?: AbortSignal;
    complete: () => FileNode;
}

export function simulateMockUpload(options: MockUploadOptions): Observable<FileNode> {
    return new Observable((subscriber) =>
        new MockUploadSimulation(options, subscriber).start()
    );
}

class MockUploadSimulation {
    private intervalId: ReturnType<typeof setInterval> | undefined;
    private settled = false;
    private progress = 0;
    private readonly abortListener: () => void;

    constructor(
        private readonly options: MockUploadOptions,
        private readonly subscriber: Subscriber<FileNode>
    ) {
        this.abortListener = (): void => this.abort();
    }

    public start(): () => void {
        if (this.options.signal?.aborted) {
            this.abort();

            return () => this.cleanup();
        }
        this.options.signal?.addEventListener('abort', this.abortListener, { once: true });
        const sizeRatio = Math.min(
            1,
            this.options.fileSize / Math.max(1, this.options.maxUploadSizeBytes)
        );
        const totalLatencyMs = 300 + sizeRatio * 1_200;
        this.intervalId = setInterval(
            () => this.tick(),
            Math.max(30, totalLatencyMs / 10)
        );

        return () => this.cleanup();
    }

    private abort(): void {
        this.fail(new FileSystemError('cancelled', 'Upload was cancelled'));
    }

    private tick(): void {
        if (this.settled) { return; }
        this.progress = Math.min(100, this.progress + 10);
        if (this.progress < 100) {
            this.options.onProgress(this.progress);

            return;
        }
        try {
            const created = this.options.complete();
            this.options.onProgress(100);
            this.settled = true;
            this.cleanup();
            this.subscriber.next(created);
            this.subscriber.complete();
        } catch (error) {
            this.fail(error);
        }
    }

    private fail(error: unknown): void {
        if (this.settled) { return; }
        this.settled = true;
        this.cleanup();
        this.subscriber.error(error);
    }

    private cleanup(): void {
        if (this.intervalId !== undefined) {
            clearInterval(this.intervalId);
            this.intervalId = undefined;
        }
        this.options.signal?.removeEventListener('abort', this.abortListener);
    }
}
