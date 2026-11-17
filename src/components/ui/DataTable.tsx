'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { EmptyState } from './States';
import { useNarrowScreen } from '@/hooks/useNarrowScreen';

export interface Column<T> {
  readonly key: string;
  readonly header: string;
  readonly render: (row: T) => ReactNode;
  readonly align?: 'left' | 'right' | 'center';
  readonly className?: string;
  /**
   * Below the `lg` breakpoint this column folds into the first one: its value
   * is shown, labelled with its header, under the row's first cell. A portrait
   * tablet keeps every piece of information the desktop shows, without a table
   * that scrolls sideways — the column used to simply disappear there.
   */
  readonly secondary?: boolean;
  readonly width?: string;
  /**
   * MOBILE-TABLES-1: a column of controls with no heading (Accept): on a phone card it is drawn as the
   * card's action row instead of being left out with the other headingless columns (the chevron).
   */
  readonly phoneAction?: boolean;
}

export interface DataTableProps<T> {
  readonly columns: readonly Column<T>[];
  readonly rows: readonly T[];
  readonly rowKey: (row: T) => string;
  readonly onRowClick?: (row: T) => void;
  readonly emptyTitle?: string;
  readonly emptyDescription?: string;
  readonly className?: string;
  /**
   * MOBILE-TABLES-1: on a phone (below `sm`) draw each row as a card — the first column on top, every
   * other column under it with its heading — instead of a table that scrolls sideways. Opt-in, per list.
   */
  readonly phoneCards?: boolean;
}

const ALIGN = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
} as const;

export const DataTable = <T,>({
  columns,
  rows,
  rowKey,
  onRowClick,
  emptyTitle = 'Nothing to show',
  emptyDescription = 'There are no records matching the current filters.',
  className,
  phoneCards = false,
}: DataTableProps<T>) => {
  const narrow = useNarrowScreen();
  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }
  if (phoneCards && narrow) {
    return <DataCards columns={columns} rows={rows} rowKey={rowKey} onRowClick={onRowClick} className={className} />;
  }

  const folded = columns.filter((column, index) => index > 0 && column.secondary === true);

  return (
    <div
      className={cn(
        'eje-scrollbar overflow-x-auto rounded-[var(--radius-card)] border border-steel-200 bg-surface shadow-[var(--shadow-card)]',
        className,
      )}
    >
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-steel-200 bg-steel-50">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                style={column.width !== undefined ? { width: column.width } : undefined}
                className={cn(
                  'px-4 py-3 text-xs font-semibold tracking-wide text-steel-500 uppercase whitespace-nowrap',
                  ALIGN[column.align ?? 'left'],
                  column.secondary === true && 'hidden lg:table-cell',
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick === undefined ? undefined : () => onRowClick(row)}
              className={cn(
                'border-b border-steel-100 last:border-b-0',
                onRowClick !== undefined && 'cursor-pointer transition-colors hover:bg-eje-50/50',
              )}
            >
              {columns.map((column, index) => (
                <td
                  key={column.key}
                  className={cn(
                    'px-4 py-3.5 align-middle text-steel-700',
                    ALIGN[column.align ?? 'left'],
                    column.secondary === true && 'hidden lg:table-cell',
                    column.className,
                  )}
                >
                  {column.render(row)}
                  {index === 0 && folded.length > 0 && (
                    <dl className="mt-2 space-y-1.5 text-left lg:hidden" data-folded-columns>
                      {folded.map((secondary) => (
                        <div key={secondary.key} className="min-w-0">
                          <dt className="text-xs font-semibold tracking-wide text-steel-500 uppercase">
                            {secondary.header}
                          </dt>
                          {/* A narrow first column: the value wraps rather than
                              being cut short with an ellipsis. */}
                          <dd className="min-w-0 text-steel-700 [&_.truncate]:overflow-visible [&_.truncate]:break-words [&_.truncate]:whitespace-normal [&_.whitespace-nowrap]:whitespace-normal">
                            {secondary.render(row)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

/**
 * THE SAME ROWS AS CARDS, FOR A PHONE. MOBILE-TABLES-1 (17 November 2026).
 *
 * Nothing is dropped: the first column heads the card and every other column with a heading follows
 * it, labelled, two to a line where the phone is wide enough. Long values wrap rather than being cut
 * short, and the whole card is the target the row was — a finger-sized one.
 */
const DataCards = <T,>({
  columns,
  rows,
  rowKey,
  onRowClick,
  className,
}: Pick<DataTableProps<T>, 'columns' | 'rows' | 'rowKey' | 'onRowClick' | 'className'>) => {
  const [first, ...rest] = columns;
  const labelled = rest.filter((column) => column.header.length > 0 && column.phoneAction !== true);
  const actions = rest.filter((column) => column.phoneAction === true);
  return (
    <ul
      data-testid="data-cards"
      className={cn(
        'divide-y divide-steel-100 overflow-hidden rounded-[var(--radius-card)] border border-steel-200 bg-surface shadow-[var(--shadow-card)]',
        className,
      )}
    >
      {rows.map((row) => (
        <li
          key={rowKey(row)}
          data-testid="data-card"
          {...(onRowClick === undefined
            ? {}
            : {
                role: 'link',
                tabIndex: 0,
                onClick: () => onRowClick(row),
                onKeyDown: (event: React.KeyboardEvent) => {
                  // Only the card itself: Enter on a button inside it is that button's.
                  if (event.key === 'Enter' && event.target === event.currentTarget) onRowClick(row);
                },
              })}
          className={cn(
            'min-h-11 px-4 py-3.5 text-sm text-steel-700',
            onRowClick !== undefined && 'cursor-pointer transition-colors active:bg-eje-50/60',
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">{first?.render(row)}</div>
            {onRowClick !== undefined && (
              <svg aria-hidden="true" viewBox="0 0 20 20" className="mt-0.5 size-4 shrink-0 text-steel-300" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M7.5 5l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </div>
          {labelled.length > 0 && (
            <dl className="mt-2.5 grid grid-cols-1 gap-x-4 gap-y-2 min-[380px]:grid-cols-2">
              {labelled.map((column) => (
                <div key={column.key} className="min-w-0">
                  <dt className="text-xs font-semibold tracking-wide text-steel-500 uppercase">{column.header}</dt>
                  <dd className="mt-0.5 min-w-0 break-words text-steel-700 [&_.truncate]:overflow-visible [&_.truncate]:break-words [&_.truncate]:whitespace-normal [&_.whitespace-nowrap]:whitespace-normal">
                    {column.render(row)}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {actions.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 empty:hidden" data-testid="data-card-actions">
              {actions.map((column) => (
                <div key={column.key}>{column.render(row)}</div>
              ))}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
};
