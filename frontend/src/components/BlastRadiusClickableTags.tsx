import { mutedText } from './ui';

interface Props {
  items: string[];
  color?: 'red' | 'yellow' | 'blue';
  selectedId?: string | null;
  labelFor?: (id: string) => string;
  onSelect: (id: string) => void;
}

const COLOR_CLS = {
  red: {
    base: 'bg-red-100 dark:bg-red-500/20 text-red-800 dark:text-red-300 border-red-200 dark:border-red-800/50',
    selected: 'ring-2 ring-red-500 ring-offset-1 dark:ring-offset-slate-900',
  },
  yellow: {
    base: 'bg-amber-100 dark:bg-yellow-500/20 text-amber-900 dark:text-yellow-300 border-amber-200 dark:border-yellow-800/50',
    selected: 'ring-2 ring-amber-500 ring-offset-1 dark:ring-offset-slate-900',
  },
  blue: {
    base: 'bg-blue-100 dark:bg-blue-500/20 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-800/50',
    selected: 'ring-2 ring-blue-500 ring-offset-1 dark:ring-offset-slate-900',
  },
};

export default function BlastRadiusClickableTags({
  items,
  color = 'blue',
  selectedId,
  labelFor,
  onSelect,
}: Props) {
  if (items.length === 0) {
    return <p className={`text-xs ${mutedText}`}>None</p>;
  }

  const cls = COLOR_CLS[color];

  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => {
        const isSelected = selectedId === item;
        const label = labelFor ? labelFor(item) : item;
        return (
          <button
            key={item}
            type="button"
            onClick={() => onSelect(item)}
            title={item}
            className={`text-xs px-2 py-1 rounded border transition-all hover:opacity-90 ${cls.base} ${
              isSelected ? cls.selected : ''
            }`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}
