import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit, SessionContextUsage } from 'claude-code'

import type { PowerCell, WeekWindow } from '../types'
import { baselineFor, computePace, dayKey, parseWorkdays, planRows } from './pace'
import type { PaceConfig } from './pace'
import { SIDES, followSide, saber, say } from './side'
import type { Side, SideName } from './side'

const cells = atom({ plugin: 'power-cells', key: 'cells' } as const, [], { shape: 'cells-2' })
const isHidden = atom({ plugin: 'power-cells', key: 'isHidden' } as const, false, {
  shape: 'hidden-1',
})

const week = atom({ plugin: 'power-cells', key: 'week' } as const, null, { shape: 'week-1' })
const side = atom({ plugin: 'power-cells', key: 'side' } as const, 'sith', { shape: 'side-1' })

type DayRecord = { date: string; windowEnd: number; baseline: number; toasts: number[] }

const WARN_AT = [20, 10, 5]
const RATION_WARN_AT = [80, 100]
// Each gauge's name on each side of the Force.
const NAMES: Record<SideName, Record<string, string>> = {
  jedi: { context: 'Holocron (context)', five_hour: 'Focus (5h)', seven_day: 'Kyber (7d)', spend_limit: 'Credits' },
  sith: { context: 'Datacore (context)', five_hour: 'Shields (5h)', seven_day: 'Reactor (7d)', spend_limit: 'Credits' },
}
const nameOf = (s: SideName, kind: string) => NAMES[s][kind] ?? kind

const compact = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)

const colorFor = (s: Side, percentLeft: number) =>
  percentLeft > 40 ? s.done : percentLeft > 15 ? s.blocked : s.alert

const until = (iso: string | undefined) => {
  if (!iso) return ''
  const mins = Math.max(0, Math.round((Date.parse(iso) - Date.now()) / 60000))
  if (mins >= 1440) return ` · resets ${Math.round(mins / 1440)}d`
  if (mins >= 60) return ` · resets ${Math.floor(mins / 60)}h${mins % 60}m`

  return ` · resets ${mins}m`
}

const measure = (context: SessionContextUsage, limits: SessionRateLimit[]): PowerCell[] => {
  const out: PowerCell[] = []
  if (context.percent !== undefined && context.tokens !== undefined) {
    out.push({
      kind: 'context',
      percentLeft: 100 - context.percent,
      detail: `${compact(Math.max(0, context.window - context.tokens))} tokens left`,
    })
  }
  for (const limit of limits) {
    out.push({
      kind: limit.kind,
      percentLeft: Math.max(0, 100 - limit.percentUsed),
      detail: `${Math.max(0, 100 - limit.percentUsed).toFixed(0)}% left${until(limit.resetsAt)}`,
    })
  }

  return out
}

// Tracks where today's counting starts (kept across sessions) and speaks up at the day's milestones.
async function trackDay($: EngineInterface, limits: SessionRateLimit[], cfg: PaceConfig) {
  const s = await read($, side)
  const limit = limits.find(one => one.kind === 'seven_day')
  const windowEnd = limit?.resetsAt ? Date.parse(limit.resetsAt) : NaN

  if (!limit || Number.isNaN(windowEnd)) {
    await update($, week, () => null)

    return
  }

  const now = Date.now()
  const today = dayKey(now)
  const saved = (await $.store.get('day-1')) as DayRecord | undefined
  const isSameDay =
    saved !== undefined && saved.date === today && Math.abs(saved.windowEnd - windowEnd) < 3_600_000
  const record: DayRecord = isSameDay
    ? saved
    : { date: today, windowEnd, baseline: baselineFor(now, windowEnd, limit.percentUsed), toasts: [] }
  const window: WeekWindow = { windowEnd, baseline: record.baseline, percentUsed: limit.percentUsed }
  const pace = computePace(now, window, cfg)
  await update($, week, () => window)

  if (!pace) return

  if (!isSameDay) {
    const day = pace.isWork ? 'work day' : 'off day'
    const left = `${(100 - limit.percentUsed).toFixed(0)}%`
    $.ui.toast(
      say(
        s,
        `Today's ration, ${pace.budget.toFixed(1)}% it is (${day}). ${left} left for ${pace.daysLeft.toFixed(1)} days, there is.`,
        `Report: today's ration is ${pace.budget.toFixed(1)}% (${day}). ${left} remains for ${pace.daysLeft.toFixed(1)} days.`,
      ),
    )
  }

  const crossed = RATION_WARN_AT.filter(
    t => pace.budget > 0 && (pace.used / pace.budget) * 100 >= t && !record.toasts.includes(t),
  )

  for (const t of crossed) {
    const budget = `${pace.budget.toFixed(1)}%`
    $.ui.toast(
      t >= 100
        ? say(s, `Spent, today's ${budget} is. Borrowing from tomorrow, you are.`, `Report: today's ${budget} is spent. Tomorrow's reserves are being seized, my lord.`)
        : say(s, `Of today's ${budget}, ${t}% used you have. Mindful, be.`, `Report: ${t}% of today's ${budget} ration consumed.`),
    )
  }

  if (!isSameDay || crossed.length > 0) {
    await $.store.set('day-1', { ...record, toasts: [...record.toasts, ...crossed] })
  }
}

export const register: Register = (on, options) => {
  const cfg: PaceConfig = {
    workdays: parseWorkdays(String(options.workdays ?? 'mon,tue,wed,thu,fri')),
    workWeight: Math.max(0.1, Number(options.workWeight ?? 2) || 2),
  }

  // Lowest threshold already warned about, per gauge; a recharge re-arms it.
  const warned = new Map<string, number>()

  on('session.start', async ($, e, next) => {
    await followSide($, s => update($, side, () => s))
    const usage = await $.session.usage()
    await update($, cells, () => measure(usage.context, usage.rateLimits))
    await trackDay($, usage.rateLimits, cfg)
    await $.command.register({
      name: 'power',
      description: 'Show or hide the Power Cells gauge; "/power plan" shows the week\'s daily rations',
    })

    return next(e)
  })

  on('command.run', { command: 'power' }, async ($, e) => {
    if (String(e.args ?? '').trim().toLowerCase() === 'plan') {
      const window = await read($, week)
      const rows = window ? planRows(Date.now(), window, cfg) : []

      if (rows.length === 0) {
        return { text: 'No weekly limit reported yet. It appears after the first reply on a subscription account.' }
      }

      const lines = rows.map(
        row =>
          `| ${row.label}${row.isToday ? ' (today)' : ''} | ${row.isWork ? 'work' : 'off'} | ${row.budget.toFixed(1)}% | ${row.isToday ? `${row.used.toFixed(1)}%` : ''} |`,
      )

      return {
        text: ['| Day | Type | Ration | Used |', '|---|---|---|---|', ...lines].join('\n'),
      }
    }

    const hidden = !(await read($, isHidden))
    await update($, isHidden, () => hidden)

    return {
      text: say(await read($, side), hidden ? 'Hidden, the power cells are.' : 'Shown, the power cells are.', hidden ? 'Power cells hidden, my lord.' : 'Power cells displayed, my lord.'),
    }
  })

  on('session.measure', async ($, e, next) => {
    const list = measure(e.context, e.rateLimits)
    await update($, cells, () => list)
    await trackDay($, e.rateLimits, cfg)
    const s = await read($, side)

    for (const cell of list) {
      const last = warned.get(cell.kind) ?? 101
      if (cell.percentLeft > (WARN_AT[0] ?? 20)) {
        warned.delete(cell.kind)
        continue
      }
      const crossed = WARN_AT.filter(t => cell.percentLeft <= t && t < last).sort((a, b) => a - b)[0]
      if (crossed !== undefined) {
        warned.set(cell.kind, crossed)
        const name = nameOf(s, cell.kind)
        const pct = `${cell.percentLeft.toFixed(0)}%`
        $.ui.toast(say(s, `${name} at ${pct}. Low on power, we are.`, `Report: ${name} at ${pct}. Power is failing, my lord.`))
      }
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, cells)
    if (e.props.hasSurvey || list.length === 0 || (await read($, isHidden))) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const sideName = await read($, side)
    const s = SIDES[sideName]
    const gauge = (fraction: number, color: string) => {
      const g = saber(fraction, width)

      return (
        <Text>
          <Text color={s.hilt}>{g.hilt}</Text>
          <Text color={color}>{g.blade}</Text>
          <Text dimColor>{g.rest} </Text>
        </Text>
      )
    }
    const columns = e.props.bodyColumns ?? 80
    const width = columns >= 100 ? 10 : 6
    const window = await read($, week)
    const pace = window ? computePace(Date.now(), window, cfg) : null
    const ratio = pace && pace.budget > 0 ? pace.used / pace.budget : 0
    const delta = pace ? pace.weekUsed - pace.expected : 0

    return (
      <Box flexDirection="column">
        <Box flexWrap="wrap">
          {list.map(cell => (
            <Box key={cell.kind} marginRight={2}>
              <Text dimColor>{columns >= 70 ? nameOf(sideName, cell.kind) : nameOf(sideName, cell.kind).split(' ')[0]} </Text>
              {gauge(cell.percentLeft / 100, colorFor(s, cell.percentLeft))}
              <Text dimColor>{cell.detail}</Text>
            </Box>
          ))}
        </Box>
        {pace && (
          <Box flexWrap="wrap">
            <Box marginRight={2}>
              <Text dimColor>{columns >= 70 ? 'Ration (today)' : 'Today'} </Text>
              {gauge(ratio, ratio >= 1 ? s.alert : ratio >= 0.85 ? s.blocked : s.done)}
              <Text dimColor>
                {pace.used.toFixed(1)} / {pace.budget.toFixed(1)}% · {pace.isWork ? 'work day' : 'off day'}
              </Text>
            </Box>
            <Box marginRight={2}>
              <Text color={delta > 4 ? s.alert : delta < -4 ? s.blade : s.done}>
                {delta > 4
                  ? say(sideName, `${delta.toFixed(0)}% over plan. Ease off, you must`, `${delta.toFixed(0)}% over plan. Conserve power`)
                  : delta < -4
                    ? say(sideName, `${(-delta).toFixed(0)}% under plan. Room to use more, there is`, `${(-delta).toFixed(0)}% under plan. Unleash more power`)
                    : say(sideName, 'on plan, you are', 'on plan, my lord')}
              </Text>
            </Box>
            <Text dimColor>
              {pace.daysLeft.toFixed(1)}d left · {pace.perDay.toFixed(1)}%/day avg
            </Text>
          </Box>
        )}
      </Box>
    )
  })
}
