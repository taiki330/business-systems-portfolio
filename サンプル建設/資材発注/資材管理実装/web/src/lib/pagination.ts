export const HISTORY_PAGE_SIZE = 50;

export function parsePage(raw: string | undefined): number {
  const page = Number(raw);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

export function getPagination(page: number, totalCount: number, pageSize = HISTORY_PAGE_SIZE) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const currentPage = Math.min(Math.max(page, 1), totalPages);
  return {
    currentPage,
    totalPages,
    from: (currentPage - 1) * pageSize,
    to: currentPage * pageSize - 1,
  };
}
