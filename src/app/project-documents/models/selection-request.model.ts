/**
 * The selection a table interaction resolves to.
 *
 * A Shift-range depends on the order rows are currently rendered in, which column
 * sorting changes, so the table resolves it and reports the complete result rather
 * than asking the store to work it out.
 */
export interface SelectionRequest {
    /** The complete next selection. */
    ids: string[];
    /** Row a following Shift-range extends from. */
    anchorId: string | null;
}
