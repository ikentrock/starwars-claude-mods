import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { DeskAgent, DeskTodo } from '../types'

const PANE = 'helper-desk'
const PURPLE = '#a855f7'
const PALETTE = ['#38bdf8', '#f59e0b', '#34d399', '#f472b6', '#f87171', '#a3e635', '#22d3ee']

const todos = atom({ plugin: 'helper-desk', key: 'todos' } as const, [], {
  shape: 'todos-1',
})
const agents = atom({ plugin: 'helper-desk', key: 'agents' } as const, [], {
  shape: 'agents-1',
})

const bar = (fraction: number, width: number) => {
  const full = Math.round(Math.max(0, Math.min(1, fraction)) * width)

  return '█'.repeat(full) + '░'.repeat(width - full)
}

const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'helper-desk',
      description: 'Open the Helper Desk panel of sub-agents',
    })

    return next(e)
  })

  on('command.run', { command: 'helper-desk' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Helper Desk' })

    return { text: 'Helper Desk opened.' }
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, todos, () => [])
      await update($, agents, () => [])
    }

    return next(e)
  })

  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const list: DeskTodo[] = e.todos.map(t => ({
      content: t.content,
      status: t.status,
      activeForm: t.activeForm,
    }))
    await update($, todos, () => list)

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const id = e.agentId
    if (id !== undefined) {
      await update($, agents, list =>
        list.map(a => (a.id === id ? { ...a, tools: a.tools + 1 } : a)),
      )
    }

    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const started = await next(e)
    const agent: DeskAgent = {
      id: started.agentId ?? '',
      name: e.description ?? e.subagentType ?? 'helper',
      color: '',
      tools: 0,
      tokens: 0,
      isDone: false,
    }
    await update($, agents, list => {
      const color = PALETTE[list.length % PALETTE.length] ?? PURPLE

      return [...list, { ...agent, color }].slice(-30)
    })
    void $.ui.open({ id: PANE, title: 'Helper Desk' })

    return started
  })

  on('turn.complete', async ($, e, next) => {
    const id = e.agentId
    if (id !== undefined) {
      const used = e.usage
      const tokens = used ? used.input_tokens + used.output_tokens : 0
      await update($, agents, list =>
        list.map(a => (a.id === id ? { ...a, tokens: a.tokens + tokens, isDone: true } : a)),
      )
    }

    return next(e)
  })

  // The purple taskbar right above the prompt box.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, todos)
    const helpers = await read($, agents)
    if (e.props.hasSurvey || (list.length === 0 && helpers.length === 0)) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const total = list.length > 0 ? list.length : helpers.length
    const done =
      list.length > 0
        ? list.filter(t => t.status === 'completed').length
        : helpers.filter(a => a.isDone).length
    const current = list.find(t => t.status === 'in_progress')
    const step = current?.activeForm ?? (done === total ? 'All done' : 'Working…')
    const room = Math.max(10, (e.props.bodyColumns ?? 80) - 30)

    return (
      <Box>
        <Text color={PURPLE}>{bar(done / total, Math.min(24, room))} </Text>
        <Text color={PURPLE} bold>
          {done}/{total}{' '}
        </Text>
        <Text dimColor>{step.slice(0, room)}</Text>
      </Box>
    )
  })

  // The side panel: one colored row per sub-agent.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const helpers = await read($, agents)
    const width = Math.max(8, Math.min(20, (e.props.bodyColumns ?? 40) - 14))

    if (helpers.length === 0) return <Text dimColor>No sub-agents yet.</Text>

    return (
      <Box flexDirection="column">
        {helpers.map(a => (
          <Box flexDirection="column" key={a.id}>
            <Text color={a.color} bold>
              {a.name.slice(0, width + 10)}
            </Text>
            <Text color={a.color}>
              {bar(a.isDone ? 1 : a.tools / (a.tools + 6), width)}{' '}
              {a.isDone ? 'done' : `${a.tools} calls`}
            </Text>
            <Text dimColor>{compact(a.tokens)} tokens</Text>
          </Box>
        ))}
      </Box>
    )
  })
}
