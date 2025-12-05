import type { FC } from 'hono/jsx';
import { formatNumber } from '../utils/date.js';

interface StatsCardProps {
  title: string;
  value: number;
  subtitle?: string;
}

export const StatsCard: FC<StatsCardProps> = ({ title, value, subtitle }) => {
  return (
    <div class="stat-card">
      <div class="stat-value">{formatNumber(value)}</div>
      <div class="stat-label">{title}</div>
      {subtitle && <div class="text-muted text-sm mt-4">{subtitle}</div>}
    </div>
  );
};
