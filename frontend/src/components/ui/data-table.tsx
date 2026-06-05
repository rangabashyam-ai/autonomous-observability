import { cn } from '../../lib/cn';
import { HealthBadge } from './badge';

interface Column<T> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  onRowClick?: (row: T) => void;
  className?: string;
  compact?: boolean;
}

export function DataTable<T>({ columns, data, onRowClick, className, compact }: DataTableProps<T>) {
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-border">
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  'text-[11px] font-medium text-text-secondary uppercase tracking-wider',
                  compact ? 'py-2 pr-3' : 'py-3 pr-4',
                  col.className
                )}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr
              key={i}
              onClick={() => onRowClick?.(row)}
              className={cn(
                'border-b border-border/60 transition-colors duration-150',
                onRowClick && 'cursor-pointer hover:bg-card-hover'
              )}
            >
              {columns.map((col) => (
                <td
                  key={col.key}
                  className={cn(
                    'text-sm text-text-primary',
                    compact ? 'py-2 pr-3' : 'py-3 pr-4',
                    col.className
                  )}
                >
                  {col.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export { HealthBadge };
