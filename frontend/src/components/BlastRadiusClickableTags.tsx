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
    base: 'bg-red-50/60 dark:bg-red-950/25 text-red-700 dark:text-red-400 border-red-200 dark:border-red-900/50 hover:bg-red-100/80 dark:hover:bg-red-900/40',
    selected: 'ring-2 ring-red-500 ring-offset-1 dark:ring-offset-slate-900 scale-105',
  },
  yellow: {
    base: 'bg-amber-50/60 dark:bg-amber-955/25 text-amber-800 dark:text-amber-400 border-amber-200 dark:border-amber-900/50 hover:bg-amber-100/80 dark:hover:bg-amber-900/40',
    selected: 'ring-2 ring-amber-500 ring-offset-1 dark:ring-offset-slate-900 scale-105',
  },
  blue: {
    base: 'bg-blue-50/60 dark:bg-blue-955/25 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-900/50 hover:bg-blue-100/80 dark:hover:bg-blue-900/40',
    selected: 'ring-2 ring-blue-500 ring-offset-1 dark:ring-offset-slate-900 scale-105',
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
    return <p className={`text-[10px] ${mutedText} italic`}>None</p>;
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
            className={`text-[10px] px-2.5 py-0.5 rounded-full border transition-all duration-150 hover:scale-105 active:scale-95 cursor-pointer font-medium ${cls.base} ${
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
