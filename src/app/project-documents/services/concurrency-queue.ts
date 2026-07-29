interface PendingJob<T> {
    run: () => Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: unknown) => void;
}

export class ConcurrencyQueue {
    private readonly pending: PendingJob<unknown>[] = [];
    private active = 0;

    constructor(private readonly limit: number) {
        if (!Number.isInteger(limit) || limit < 1) {
            throw new Error('Concurrency limit must be a positive integer');
        }
    }

    public enqueue<T>(run: () => Promise<T>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            this.pending.push({
                run,
                resolve: resolve as PendingJob<unknown>['resolve'],
                reject
            });
            this.drain();
        });
    }

    private drain(): void {
        while (this.active < this.limit) {
            const job = this.pending.shift();
            if (!job) { return; }
            this.active += 1;
            void job.run()
                .then(job.resolve, job.reject)
                .finally(() => {
                    this.active -= 1;
                    this.drain();
                });
        }
    }
}
