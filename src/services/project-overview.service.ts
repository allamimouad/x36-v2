import { Injectable, signal } from '@angular/core';

@Injectable()
export class ProjectOverviewService {
    public readonly projectDTO = signal<{ name?: string | null } | null>(null);
}
