import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { cn } from '../../lib/cn';

interface ChartProps {
  data: { name: string; value: number; value2?: number }[];
  className?: string;
  color?: string;
  color2?: string;
  height?: number;
}

const tooltipStyle = {
  contentStyle: {
    background: 'var(--color-card)',
    border: '1px solid var(--color-border)',
    borderRadius: '8px',
    fontSize: '11px',
    color: 'var(--color-text-primary)',
  },
};

export function MiniAreaChart({ data, className, color = '#3B82F6', height = 80 }: ChartProps) {
  return (
    <div className={cn('w-full', className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={`grad-${color}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.25} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={1.5}
            fill={`url(#grad-${color})`}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TrendChart({ data, className, color = '#3B82F6', color2 = '#10B981', height = 160 }: ChartProps) {
  return (
    <div className={cn('w-full', className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 10, fill: 'var(--color-text-secondary)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: 'var(--color-text-secondary)' }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip {...tooltipStyle} />
          <Area type="monotone" dataKey="value" stroke={color} fill={color} fillOpacity={0.1} strokeWidth={2} />
          {data[0]?.value2 !== undefined && (
            <Area type="monotone" dataKey="value2" stroke={color2} fill={color2} fillOpacity={0.08} strokeWidth={2} />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function MiniLineChart({ data, className, color = '#3B82F6', height = 80 }: ChartProps) {
  return (
    <div className={cn('w-full', className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
          <Line type="monotone" dataKey="value" stroke={color} strokeWidth={1.5} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function MiniBarChart({ data, className, color = '#3B82F6', height = 80 }: ChartProps) {
  return (
    <div className={cn('w-full', className)} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
          <Bar dataKey="value" fill={color} radius={[2, 2, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Generate deterministic trend points from a base value */
export function generateTrend(base: number, points = 12, variance = 0.08): { name: string; value: number }[] {
  const labels = ['00', '02', '04', '06', '08', '10', '12', '14', '16', '18', '20', '22'];
  return labels.slice(0, points).map((name, i) => {
    const wave = Math.sin(i * 0.8) * variance * base;
    const drift = (i / points) * variance * base * 0.5;
    return { name, value: Math.max(0, base + wave + drift) };
  });
}

export function generateDualTrend(
  base1: number,
  base2: number,
  points = 12
): { name: string; value: number; value2: number }[] {
  return generateTrend(base1, points).map((d, i) => ({
    ...d,
    value2: generateTrend(base2, points)[i].value,
  }));
}
