import { ConcurrencyQueue } from './concurrency-queue';

describe('ConcurrencyQueue', () => {
    it('never starts more jobs than its configured limit', async () => {
        const queue = new ConcurrencyQueue(2);
        const started: number[] = [];
        let active = 0;
        let maximumActive = 0;
        const jobs = Array.from({ length: 5 }, (_, index) =>
            queue.enqueue(async () => {
                active += 1;
                maximumActive = Math.max(maximumActive, active);
                started.push(index);
                await new Promise((resolve) => setTimeout(resolve, 10));
                active -= 1;

                return index;
            })
        );

        await expectAsync(Promise.all(jobs)).toBeResolvedTo([0, 1, 2, 3, 4]);
        expect(maximumActive).toBe(2);
        expect(started).toEqual([0, 1, 2, 3, 4]);
    });
});
