import React from 'react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { Shipment } from '../types';
import { CheckCircle2, Clock, Circle, PieChart as PieChartIcon } from 'lucide-react';
import { motion } from 'motion/react';

interface DateStatusPieChartProps {
  shipments: Shipment[];
  dateLabel: string;
}

const STATUS_CONFIG = [
  { key: 'Completed', label: '完了', color: '#10B981', bgColor: 'bg-emerald-500', textColor: 'text-emerald-700' },
  { key: 'In Progress', label: '進行中', color: '#F59E0B', bgColor: 'bg-amber-500', textColor: 'text-amber-700' },
  { key: 'Todo', label: '未着手', color: '#94A3B8', bgColor: 'bg-slate-400', textColor: 'text-slate-600' },
];

export const DateStatusPieChart: React.FC<DateStatusPieChartProps> = ({ shipments, dateLabel }) => {
  const total = shipments.length;

  const completedCount = shipments.filter(
    (s) => s.status === 'Completed' || (s.tasks.length > 0 && s.tasks.every((t) => t.status === 'Completed'))
  ).length;

  const inProgressCount = shipments.filter(
    (s) => s.status === 'In Progress' || (s.status !== 'Completed' && s.tasks.some((t) => t.status === 'Completed' || t.status === 'In Progress'))
  ).length;

  const todoCount = total - completedCount - inProgressCount;

  const data = [
    { name: '完了', value: completedCount, color: '#10B981' },
    { name: '進行中', value: inProgressCount, color: '#F59E0B' },
    { name: '未着手', value: Math.max(0, todoCount), color: '#94A3B8' },
  ].filter((d) => d.value > 0);

  const completionRate = total > 0 ? Math.round((completedCount / total) * 100) : 0;

  // Empty state if no shipments for the date
  if (total === 0) {
    return (
      <div className="bg-slate-50/80 border-2 border-slate-300 rounded-xl px-2.5 py-1.5 flex items-center justify-between gap-2 h-full min-h-[44px] shadow-sm">
        <div className="flex items-center space-x-2 text-slate-400">
          <PieChartIcon className="w-4 h-4 text-slate-400" />
          <span className="text-xs font-bold">{dateLabel}: 案件なし</span>
        </div>
        <span className="text-[11px] font-mono font-bold text-slate-500 bg-white px-2 py-0.5 rounded-lg border-2 border-slate-200 shadow-2xs">0件</span>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.25 }}
      className="bg-white rounded-xl border-2 border-slate-300 px-2 py-1 sm:px-2.5 sm:py-1 shadow-sm hover:shadow-md transition-shadow flex items-center justify-between gap-2 h-full min-h-[44px]"
    >
      {/* Left: Donut Chart with Center Completion % */}
      <div className="relative w-11 h-11 sm:w-12 sm:h-12 shrink-0 flex items-center justify-center">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const pData = payload[0];
                  const val = pData.value as number;
                  const pct = total > 0 ? Math.round((val / total) * 100) : 0;
                  return (
                    <div className="bg-slate-900 text-white px-2 py-1 rounded text-[10px] font-bold shadow-lg border border-slate-700">
                      <span className="inline-block w-2 h-2 rounded-full mr-1" style={{ backgroundColor: pData.payload.color }} />
                      {pData.name}: {val}件 ({pct}%)
                    </div>
                  );
                }
                return null;
              }}
            />
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={13}
              outerRadius={21}
              paddingAngle={data.length > 1 ? 2 : 0}
              stroke="none"
              animationDuration={600}
            >
              {data.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>

        {/* Center Completion Rate Label */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-[10px] font-black font-mono text-slate-800 leading-none">
            {completionRate}%
          </span>
          <span className="text-[7px] font-bold text-slate-400 leading-none mt-0.5">完了</span>
        </div>
      </div>

      {/* Right: Legend Breakdown */}
      <div className="flex-1 min-w-0 pr-0.5 flex flex-col justify-center space-y-0.5">
        <div className="flex items-center justify-between text-[11px] font-bold text-slate-700 leading-tight">
          <span className="truncate flex items-center gap-1">
            <PieChartIcon className="w-3.5 h-3.5 text-blue-600 shrink-0" />
            <span className="font-mono text-slate-900 text-[11.5px] font-black">{dateLabel}</span>
          </span>
          <span className="font-mono font-black text-blue-700 text-xs">{total}件</span>
        </div>

        {/* Status Mini Chips */}
        <div className="grid grid-cols-3 gap-1">
          {/* Completed */}
          <div className="bg-emerald-50 border border-emerald-300 rounded-md px-1 py-0 flex flex-row items-center justify-between shadow-2xs">
            <div className="flex items-center space-x-0.5 text-[9.5px] text-emerald-800 font-bold leading-none">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
              <span>完了</span>
            </div>
            <span className="text-[11.5px] font-black font-mono text-emerald-700 leading-tight">
              {completedCount}
            </span>
          </div>

          {/* In Progress */}
          <div className="bg-amber-50 border border-amber-300 rounded-md px-1 py-0 flex flex-row items-center justify-between shadow-2xs">
            <div className="flex items-center space-x-0.5 text-[9.5px] text-amber-800 font-bold leading-none">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
              <span>進行</span>
            </div>
            <span className="text-[11.5px] font-black font-mono text-amber-700 leading-tight">
              {inProgressCount}
            </span>
          </div>

          {/* Todo */}
          <div className="bg-slate-100 border border-slate-300 rounded-md px-1 py-0 flex flex-row items-center justify-between shadow-2xs">
            <div className="flex items-center space-x-0.5 text-[9.5px] text-slate-700 font-bold leading-none">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-400 shrink-0" />
              <span>未着</span>
            </div>
            <span className="text-[11.5px] font-black font-mono text-slate-700 leading-tight">
              {Math.max(0, todoCount)}
            </span>
          </div>
        </div>
      </div>
    </motion.div>
  );
};
