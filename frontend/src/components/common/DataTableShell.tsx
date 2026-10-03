import React from 'react';
import { ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Inbox, Loader2 } from 'lucide-react';

export interface DataTableColumn<T> {
  key: string;
  header: React.ReactNode;
  width?: string;
  align?: 'left' | 'center' | 'right';
  sortable?: boolean;
  render?: (item: T, index: number) => React.ReactNode;
  className?: string;
}

export interface DataTableShellProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  keyExtractor: (item: T, index: number) => string | number;
  isLoading?: boolean;
  emptyMessage?: React.ReactNode;
  emptyIcon?: React.ReactNode;
  sortKey?: string;
  sortDirection?: 'asc' | 'desc';
  onSort?: (key: string) => void;
  onRowClick?: (item: T, index: number) => void;
  rowClassName?: (item: T, index: number) => string;
  page?: number;
  totalPages?: number;
  pageSize?: number;
  totalItems?: number;
  onPageChange?: (newPage: number) => void;
  maxHeight?: string;
  className?: string;
}

export function DataTableShell<T>({
  columns,
  data,
  keyExtractor,
  isLoading = false,
  emptyMessage = 'No records found',
  emptyIcon = <Inbox size={32} className="text-muted/60" />,
  sortKey,
  sortDirection,
  onSort,
  onRowClick,
  rowClassName,
  page,
  totalPages,
  pageSize,
  totalItems,
  onPageChange,
  maxHeight = 'max-h-[600px]',
  className = '',
}: DataTableShellProps<T>): React.ReactElement {
  const getAlignClass = (align?: 'left' | 'center' | 'right') => {
    if (align === 'center') return 'text-center';
    if (align === 'right') return 'text-right';
    return 'text-left';
  };

  return (
    <div className={`flex flex-col bg-bg2 border border-border rounded-xl overflow-hidden shadow-sm ${className}`}>
      {/* Scrollable Table Viewport */}
      <div className={`overflow-x-auto overflow-y-auto dropdown-scroll ${maxHeight} w-full`}>
        <table className="w-full text-xs text-text border-collapse">
          {/* Sticky Header */}
          <thead className="sticky top-0 z-10 bg-bg3/95 backdrop-blur-none border-b border-border text-muted uppercase tracking-wider font-semibold text-[11px]">
            <tr>
              {columns.map((col) => {
                const isSorted = sortKey === col.key;
                return (
                  <th
                    key={col.key}
                    style={col.width ? { width: col.width } : undefined}
                    className={`px-3.5 py-2.5 select-none ${getAlignClass(col.align)} ${
                      col.sortable ? 'cursor-pointer hover:text-text transition-colors' : ''
                    } ${col.className || ''}`}
                    onClick={() => {
                      if (col.sortable && onSort) {
                        onSort(col.key);
                      }
                    }}
                  >
                    <div
                      className={`flex items-center gap-1.5 ${
                        col.align === 'right'
                          ? 'justify-end'
                          : col.align === 'center'
                          ? 'justify-center'
                          : 'justify-start'
                      }`}
                    >
                      <span>{col.header}</span>
                      {col.sortable && isSorted && (
                        <span className="text-primary">
                          {sortDirection === 'desc' ? <ChevronDown size={13} /> : <ChevronUp size={13} />}
                        </span>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>

          {/* Table Body */}
          <tbody className="divide-y divide-border/60">
            {isLoading ? (
              <tr>
                <td colSpan={columns.length} className="py-12 text-center text-muted">
                  <div className="flex flex-col items-center justify-center gap-2">
                    <Loader2 size={24} className="animate-spin text-primary" />
                    <span className="text-xs">Loading data...</span>
                  </div>
                </td>
              </tr>
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="py-14 text-center text-muted">
                  <div className="flex flex-col items-center justify-center gap-2">
                    {emptyIcon}
                    <span className="text-xs font-medium">{emptyMessage}</span>
                  </div>
                </td>
              </tr>
            ) : (
              data.map((item, index) => {
                const key = keyExtractor(item, index);
                const customCls = rowClassName ? rowClassName(item, index) : '';
                return (
                  <tr
                    key={key}
                    onClick={() => onRowClick && onRowClick(item, index)}
                    className={`hover:bg-bg3/50 transition-colors ${
                      onRowClick ? 'cursor-pointer' : ''
                    } ${customCls}`}
                  >
                    {columns.map((col) => {
                      const value = (item as any)[col.key];
                      return (
                        <td
                          key={col.key}
                          className={`px-3.5 py-2.5 align-middle ${getAlignClass(col.align)} ${
                            col.className || ''
                          }`}
                        >
                          {col.render ? col.render(item, index) : value ?? '-'}
                        </td>
                      );
                    })}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      {(totalPages !== undefined || totalItems !== undefined) && (
        <div className="px-4 py-2.5 bg-bg3/40 border-t border-border flex items-center justify-between text-xs text-muted shrink-0">
          <div>
            {totalItems !== undefined ? (
              <span>
                Total <strong className="text-text font-semibold">{totalItems}</strong> records
                {page !== undefined && pageSize !== undefined && totalItems > 0 && (
                  <span className="ml-1">
                    (Showing {Math.min((page - 1) * pageSize + 1, totalItems)}–
                    {Math.min(page * pageSize, totalItems)})
                  </span>
                )}
              </span>
            ) : null}
          </div>

          {totalPages !== undefined && totalPages > 1 && onPageChange && page !== undefined && (
            <div className="flex items-center gap-2">
              <span className="text-[11px]">
                Page <strong className="text-text font-semibold">{page}</strong> of {totalPages}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => onPageChange(page - 1)}
                  className="p-1 rounded border border-border bg-bg hover:bg-bg3 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-text"
                  title="Previous page"
                >
                  <ChevronLeft size={14} />
                </button>
                <button
                  type="button"
                  disabled={page >= totalPages}
                  onClick={() => onPageChange(page + 1)}
                  className="p-1 rounded border border-border bg-bg hover:bg-bg3 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-text"
                  title="Next page"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
