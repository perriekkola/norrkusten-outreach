export type ActivityPoint = { day: string; sent: number; opened: number; replied: number }

// Colors come from the shadcn theme vars, which carry their own light and dark steps.
const SERIES = [
  { key: 'sent', label: 'Sent', color: 'var(--chart-1)' },
  { key: 'opened', label: 'Opened', color: 'var(--chart-2)' },
  { key: 'replied', label: 'Replied', color: 'var(--chart-3)' },
] as const

const W = 720
const H = 200
const PAD = { top: 12, right: 44, bottom: 24, left: 32 }

/** 30-day activity. Three nested series, so lines (not bars) — opened ⊆ sent ⊆ enrolled. */
export function ActivityChart({ data }: { data: ActivityPoint[] }) {
  if (data.length === 0) return null

  const max = Math.max(4, ...data.flatMap((d) => [d.sent, d.opened, d.replied]))
  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const x = (i: number) => PAD.left + (i / Math.max(1, data.length - 1)) * plotW
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH

  const ticks = [0, Math.round(max / 2), max]
  const label = (day: string) => day.slice(5).replace('-', '/')

  return (
    <figure className="m-0">
      <div className="mb-3 flex flex-wrap gap-4">
        {SERIES.map((series) => (
          <span key={series.key} className="text-muted-foreground flex items-center gap-2 text-xs">
            <span
              className="inline-block h-0.5 w-4 rounded-full"
              style={{ background: series.color }}
            />
            {series.label}
          </span>
        ))}
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Daily email activity">
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(tick)}
              y2={y(tick)}
              stroke="var(--border)"
              strokeWidth={1}
            />
            <text x={PAD.left - 8} y={y(tick) + 4} textAnchor="end" fontSize={10} fill="var(--muted-foreground)">
              {tick}
            </text>
          </g>
        ))}

        {SERIES.map((series) => {
          const path = data
            .map((point, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(point[series.key])}`)
            .join(' ')
          const last = data[data.length - 1][series.key]
          return (
            <g key={series.key}>
              <path d={path} fill="none" stroke={series.color} strokeWidth={2} strokeLinejoin="round" />
              <text
                x={W - PAD.right + 6}
                y={y(last) + 4}
                fontSize={11}
                fill={series.color}
                fontWeight={600}
              >
                {last}
              </text>
            </g>
          )
        })}

        {/* One hit target per day — native tooltip, no client JS. */}
        {data.map((point, i) => (
          <rect
            key={point.day}
            x={x(i) - plotW / data.length / 2}
            y={PAD.top}
            width={plotW / data.length}
            height={plotH}
            fill="transparent"
          >
            <title>{`${point.day} — sent ${point.sent}, opened ${point.opened}, replied ${point.replied}`}</title>
          </rect>
        ))}

        {[0, Math.floor(data.length / 2), data.length - 1].map((i) => (
          <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize={10} fill="var(--muted-foreground)">
            {label(data[i].day)}
          </text>
        ))}
      </svg>
    </figure>
  )
}
