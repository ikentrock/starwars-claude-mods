export type PaceConfig = { workdays: number[]; workWeight: number }

export type Pace = {
  used: number
  budget: number
  isWork: boolean
  weekUsed: number
  expected: number
  daysLeft: number
  perDay: number
}

export type PlanRow = { label: string; isWork: boolean; isToday: boolean; budget: number; used: number }

const DAY = 86_400_000
const NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

export const parseWorkdays = (text: string): number[] =>
  text
    .toLowerCase()
    .split(/[\s,]+/)
    .map(name => NAMES.indexOf(name.slice(0, 3)))
    .filter(index => index >= 0)

export const startOfDay = (time: number) => {
  const d = new Date(time)

  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

export const nextDay = (time: number) => {
  const d = new Date(time)

  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime()
}

export const dayKey = (time: number) => {
  const d = new Date(time)

  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

export const dayLabel = (time: number) => {
  const d = new Date(time)

  return `${NAMES[d.getDay()]} ${d.getDate()}`
}

const isWorkday = (time: number, cfg: PaceConfig) => cfg.workdays.includes(new Date(time).getDay())

// Weight of the stretch from..to: each local day counts its share of the day times its day weight.
const weightBetween = (from: number, to: number, cfg: PaceConfig) => {
  let total = 0
  let cursor = from

  while (cursor < to) {
    const dayEnd = nextDay(cursor)
    const end = Math.min(dayEnd, to)
    total += ((end - cursor) / (dayEnd - startOfDay(cursor))) * (isWorkday(cursor, cfg) ? cfg.workWeight : 1)
    cursor = end
  }

  return total
}

// Where today's counting starts: this local midnight, or the window's start when it opened today.
export const baselineFor = (now: number, windowEnd: number, percentUsed: number) =>
  windowEnd - 7 * DAY >= startOfDay(now) ? 0 : percentUsed

export const computePace = (
  now: number,
  week: { windowEnd: number; baseline: number; percentUsed: number },
  cfg: PaceConfig,
): Pace | null => {
  const windowStart = week.windowEnd - 7 * DAY

  if (week.windowEnd <= now) return null

  const from = Math.max(startOfDay(now), windowStart)
  const todayWeight = weightBetween(from, Math.min(nextDay(now), week.windowEnd), cfg)
  const restWeight = weightBetween(from, week.windowEnd, cfg)
  const budget = restWeight > 0 ? ((100 - week.baseline) * todayWeight) / restWeight : 0
  const total = weightBetween(windowStart, week.windowEnd, cfg)
  const daysLeft = (week.windowEnd - now) / DAY

  return {
    used: Math.max(0, week.percentUsed - week.baseline),
    budget,
    isWork: isWorkday(now, cfg),
    weekUsed: week.percentUsed,
    expected: total > 0 ? (100 * weightBetween(windowStart, now, cfg)) / total : 0,
    daysLeft,
    perDay: Math.max(0, 100 - week.percentUsed) / Math.max(daysLeft, 0.01),
  }
}

// Today's ration, then each later day's share of what is left if today is spent exactly on budget.
export const planRows = (
  now: number,
  week: { windowEnd: number; baseline: number; percentUsed: number },
  cfg: PaceConfig,
): PlanRow[] => {
  const pace = computePace(now, week, cfg)

  if (!pace) return []

  const rows: PlanRow[] = [
    { label: dayLabel(now), isWork: pace.isWork, isToday: true, budget: pace.budget, used: pace.used },
  ]
  const left = Math.max(0, 100 - week.baseline - Math.max(pace.used, pace.budget))
  const days: number[] = []

  for (let day = nextDay(now); day < week.windowEnd; day = nextDay(day)) days.push(day)

  const weights = days.map(day => weightBetween(day, Math.min(nextDay(day), week.windowEnd), cfg))
  const sum = weights.reduce((a, b) => a + b, 0)

  days.forEach((day, i) =>
    rows.push({
      label: dayLabel(day),
      isWork: isWorkday(day, cfg),
      isToday: false,
      budget: sum > 0 ? (left * (weights[i] ?? 0)) / sum : 0,
      used: 0,
    }),
  )

  return rows
}
