import { resolveSelection, type SelectionContext } from './selection.utils';

/** Shared by both tables, so the rules are pinned here rather than in either one. */
describe('resolveSelection', () => {
    const rendered = ['a', 'b', 'c', 'd'];

    function context(
        selectedIds: string[] = [],
        anchorId: string | null = null,
        renderedIds: readonly string[] = rendered
    ): SelectionContext {
        return { selectedIds: new Set(selectedIds), anchorId, renderedIds };
    }

    function click(
        keys: Partial<Pick<MouseEvent, 'shiftKey' | 'ctrlKey' | 'metaKey'>> = {}
    ): Pick<MouseEvent, 'shiftKey' | 'ctrlKey' | 'metaKey'> {
        return { shiftKey: false, ctrlKey: false, metaKey: false, ...keys };
    }

    it('replaces the selection on a plain click', () => {
        expect(resolveSelection(click(), 'c', context(['a', 'b'], 'a')))
            .toEqual({ ids: ['c'], anchorId: 'c' });
    });

    it('toggles one row and moves the anchor on Ctrl or Cmd', () => {
        const added = resolveSelection(click({ ctrlKey: true }), 'c', context(['a'], 'a'));
        expect([...added.ids].sort()).toEqual(['a', 'c']);
        expect(added.anchorId).toBe('c');

        const removed = resolveSelection(click({ metaKey: true }), 'a', context(['a', 'c'], 'c'));
        expect(removed.ids).toEqual(['c']);
        expect(removed.anchorId).toBe('a');
    });

    it('extends across the rendered order and leaves the anchor where it is', () => {
        // Sorting changes the rendered order, so the range follows that and not the ids:
        // anchored on 'b', clicking 'd' must take 'c' with it.
        expect(resolveSelection(click({ shiftKey: true }), 'd', context(['b'], 'b')))
            .toEqual({ ids: ['b', 'c', 'd'], anchorId: 'b' });

        // Backwards, and the anchor still does not move, so a further Shift-click
        // re-extends from the same row rather than from the last one touched.
        expect(resolveSelection(click({ shiftKey: true }), 'a', context(['b', 'c'], 'c')))
            .toEqual({ ids: ['a', 'b', 'c'], anchorId: 'c' });
    });

    it('falls back to a plain click when a Shift-range cannot be resolved', () => {
        // No anchor yet.
        expect(resolveSelection(click({ shiftKey: true }), 'c', context(['c'], null)))
            .toEqual({ ids: ['c'], anchorId: 'c' });

        // The anchor is no longer rendered — a filter or a re-query dropped its row.
        expect(resolveSelection(click({ shiftKey: true }), 'c', context(['c'], 'gone')))
            .toEqual({ ids: ['c'], anchorId: 'c' });
    });
});
