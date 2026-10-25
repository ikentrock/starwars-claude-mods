import { atom, read, update } from 'claude-code'
import type { Register, SessionRateLimit, SessionContextUsage } from 'claude-code'

import type { PowerCell } from '../types'

const cells = atom({ plugin: 'power-cells', key: 'cells' } as const, [], { shape: 'cells-1' })
const isHidden = atom({ plugin: 'power-cells', key: 'isHidden' } as const, false, {
  shape: 'hidden-1',
})

const WARN_AT = [20, 10, 5]
const NAMES: Record<string, string> = {
  five_hour: 'Shields (5h)',
  seven_day: 'Reactor (7d)',
  spend_limit: 'Credits',
}

const compact = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)

const bar = (percent: number, width: number) => {
  const full = Math.round((Math.max(0, Math.min(100, percent)) / 100) * width)

  return '█'.repeat(full) + '░'.repeat(width - full)
}

const colorFor = (percentLeft: number) =>
  percentLeft > 40 ? 'green' : percentLeft > 15 ? 'yellow' : 'red'

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
      label: 'Holocron (context)',
      percentLeft: 100 - context.percent,
      detail: `${compact(Math.max(0, context.window - context.tokens))} tokens left`,
    })
  }
  for (const limit of limits) {
    out.push({
      label: NAMES[limit.kind] ?? limit.kind,
      percentLeft: Math.max(0, 100 - limit.percentUsed),
      detail: `${Math.max(0, 100 - limit.percentUsed).toFixed(0)}% left${until(limit.resetsAt)}`,
    })
  }

  return out
}

export const register: Register = on => {
  // Lowest threshold already warned about, per gauge; a recharge re-arms it.
  const warned = new Map<string, number>()

  on('session.start', async ($, e, next) => {
    const usage = await $.session.usage()
    await update($, cells, () => measure(usage.context, usage.rateLimits))
    await $.command.register({
      name: 'power',
      description: 'Show or hide the Power Cells gauge',
    })

    return next(e)
  })

  on('command.run', { command: 'power' }, async $ => {
    const hidden = !(await read($, isHidden))
    await update($, isHidden, () => hidden)

    return { text: hidden ? 'Power Cells hidden.' : 'Power Cells shown.' }
  })

  on('session.measure', async ($, e, next) => {
    const list = measure(e.context, e.rateLimits)
    await update($, cells, () => list)

    for (const cell of list) {
      const last = warned.get(cell.label) ?? 101
      if (cell.percentLeft > (WARN_AT[0] ?? 20)) {
        warned.delete(cell.label)
        continue
      }
      const crossed = WARN_AT.filter(t => cell.percentLeft <= t && t < last).sort((a, b) => a - b)[0]
      if (crossed !== undefined) {
        warned.set(cell.label, crossed)
        $.ui.toast(`Power Cells: ${cell.label} at ${cell.percentLeft.toFixed(0)}%. Low on power, we are.`)
      }
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, cells)
    if (e.props.hasSurvey || list.length === 0 || (await read($, isHidden))) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const columns = e.props.bodyColumns ?? 80
    const width = columns >= 100 ? 10 : 6

    return (
      <Box flexWrap="wrap">
        {list.map(cell => (
          <Box key={cell.label} marginRight={2}>
            <Text dimColor>{columns >= 70 ? cell.label : cell.label.split(' ')[0]} </Text>
            <Text color={colorFor(cell.percentLeft)}>{bar(cell.percentLeft, width)} </Text>
            <Text dimColor>{cell.detail}</Text>
          </Box>
        ))}
      </Box>
    )
  })
}
