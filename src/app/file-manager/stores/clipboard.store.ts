import { signalStore, withMethods, withState } from '@ngrx/signals';

export type ClipboardMode = 'cut' | 'copy';

interface ClipboardState {
  ids: string[];
  mode: ClipboardMode | null;
}

const initialState: ClipboardState = {
  ids: [],
  mode: null,
};

export const ClipboardStore = signalStore(
  withState(initialState),
  withMethods(() => ({
    // Full implementation in Phase 3.
    cut(_ids: string[]): void {
      /* Phase 3 */
    },
    copy(_ids: string[]): void {
      /* Phase 3 */
    },
    clear(): void {
      /* Phase 3 */
    },
    paste(_targetParentId: string): Promise<void> {
      return Promise.reject(new Error('ClipboardStore.paste is not implemented in Phase 1'));
    },
  })),
);

export type ClipboardStoreInstance = InstanceType<typeof ClipboardStore>;
