'use client'

import { Area, AreaChart, CartesianGrid, XAxis } from 'recharts'

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'

export type ActivityPoint = { day: string; sent: number; opened: number; replied: number }

const chartConfig = {
  sent: { label: 'Sent', color: 'var(--chart-1)' },
  opened: { label: 'Opened', color: 'var(--chart-2)' },
  replied: { label: 'Replied', color: 'var(--chart-3)' },
} satisfies ChartConfig

// UTC: `day` is a plain date string, and a local-time render would shift it a day west of Greenwich.
const formatDay = (day: string) =>
  new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })

/**
 * Daily activity. Not stacked — the series are nested (replied ⊆ opened ⊆ sent), so stacking
 * would triple-count. Largest first, so the smaller layers draw on top of it.
 *
 * `monotone`, not shadcn's usual `natural`: a natural spline overshoots, and on a series of
 * mostly-idle days it draws a bump on days that sent nothing.
 */
export function ActivityChart({ data }: { data: ActivityPoint[] }) {
  if (data.length === 0) return null

  return (
    <ChartContainer config={chartConfig} className="aspect-auto h-[250px] w-full">
      <AreaChart data={data} accessibilityLayer margin={{ left: 12, right: 12 }}>
        <defs>
          {Object.keys(chartConfig).map((key) => (
            <linearGradient key={key} id={`fill-${key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={`var(--color-${key})`} stopOpacity={0.8} />
              <stop offset="95%" stopColor={`var(--color-${key})`} stopOpacity={0.1} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey="day"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={32}
          tickFormatter={formatDay}
        />
        <ChartTooltip
          cursor={false}
          content={
            <ChartTooltipContent
              labelFormatter={(value) => formatDay(String(value))}
              indicator="dot"
            />
          }
        />
        {Object.keys(chartConfig).map((key) => (
          <Area
            key={key}
            dataKey={key}
            type="monotone"
            fill={`url(#fill-${key})`}
            stroke={`var(--color-${key})`}
          />
        ))}
        {/* itemSorter null: recharts sorts the legend alphabetically by default, losing funnel order. */}
        <ChartLegend content={<ChartLegendContent />} itemSorter={null} />
      </AreaChart>
    </ChartContainer>
  )
}
