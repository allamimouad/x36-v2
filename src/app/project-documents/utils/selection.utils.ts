import type { SelectionRequest } from '../models/selection-request.model';

export interface SelectionContext {
    selectedIds: ReadonlySet<string>;
    anchorId: string | null;
    /**
     * Row ids in the order they are currently rendered, which column sorting changes.
     * A Shift-range follows this rather than any underlying order, so each surface
     * reads it from its own table.
     */
    renderedIds: readonly string[];
}

/**
 * The selection a click resolves to, shared by every surface that has one.
 *
 * Lives outside the components because both tables need identical behaviour and the
 * rules are worth stating once: plain replaces, Ctrl/Cmd toggles, and Shift extends
 * from the anchor across the rendered order.
 */
export function resolveSelection(
    event: Pick<MouseEvent, 'shiftKey' | 'ctrlKey' | 'metaKey'>,
    id: string,
    context: SelectionContext
): SelectionRequest {
    if (event.shiftKey) {
        const range = rangeTo(id, context);
        // The anchor stays put, so a further Shift-click re-extends from the same row
        // rather than from the last one touched.
        if (range !== null) { return { ids: range, anchorId: context.anchorId }; }
    }
    if (event.ctrlKey || event.metaKey) {
        const next = new Set(context.selectedIds);
        if (!next.delete(id)) { next.add(id); }

        return { ids: [...next], anchorId: id };
    }

    return { ids: [id], anchorId: id };
}

/**
 * Ids from the anchor to `id` in rendered order. Null when there is no anchor yet or
 * either row is not rendered, leaving the caller to treat the click as an ordinary one.
 */
function rangeTo(id: string, context: SelectionContext): string[] | null {
    const { anchorId, renderedIds } = context;
    if (anchorId === null) { return null; }
    const from = renderedIds.indexOf(anchorId);
    const to = renderedIds.indexOf(id);
    if (from === -1 || to === -1) { return null; }
    const [start, end] = from <= to ? [from, to] : [to, from];

    return [...renderedIds.slice(start, end + 1)];
}
