// Keyset paging of the request list (#48). The cursor is the id of the last row of the previous page;
// the repository resolves its (created_at, id) position in the database, so the full microsecond
// precision of created_at is kept and a foreign or unknown id simply yields the first page.

/** Fixed page size of the request list. */
export const REQUEST_PAGE_SIZE = 50;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A cursor from the query string, or null (first page) for anything that is not a single UUID. */
export function parseCursor(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null;
}
