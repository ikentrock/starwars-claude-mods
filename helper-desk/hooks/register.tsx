import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { DeskAgent, DeskTodo } from '../types'
import { SIDES, followSide, saber, say, spaced } from './side'
import type { Side, SideName } from './side'

const PANE = 'helper-desk'

const todos = atom({ plugin: 'helper-desk', key: 'todos' } as const, [], {
  shape: 'todos-1',
})
const agents = atom({ plugin: 'helper-desk', key: 'agents' } as const, [], {
  shape: 'agents-2',
})
const side = atom({ plugin: 'helper-desk', key: 'side' } as const, 'sith', { shape: 'side-1' })

// The pane is named for the side's sub-agents, as Herdr's sidebar names its agents.
const title = (s: SideName) => SIDES[s].agents

const colorOf = (s: Side, slot: number) => s.palette[slot % s.palette.length] ?? s.blade

const compact = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n))

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await followSide($, s => update($, side, () => s))
    await $.command.register({
      name: 'helper-desk',
      description: 'Open the Helper Desk: your sub-agents as padawans (Jedi) or apprentices (Sith)',
    })

    return next(e)
  })

  on('command.run', { command: 'helper-desk' }, async $ => {
    const s = await read($, side)
    await $.ui.open({ id: PANE, title: title(s) })

    return { text: say(s, 'Your padawans, here they are.', 'Your apprentices, assembled, my lord.') }
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
      slot: 0,
      tools: 0,
      tokens: 0,
      isDone: false,
    }
    await update($, agents, list => [...list, { ...agent, slot: list.length }].slice(-30))
    void $.ui.open({ id: PANE, title: title(await read($, side)) })

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

  // The progress saber right above the prompt box, in the side's blade color.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const list = await read($, todos)
    const helpers = await read($, agents)
    if (e.props.hasSurvey || (list.length === 0 && helpers.length === 0)) return next(e)

    const { Box, Text } = $.ui.resolve(e)
    const s = SIDES[await read($, side)]
    const total = list.length > 0 ? list.length : helpers.length
    const done =
      list.length > 0
        ? list.filter(t => t.status === 'completed').length
        : helpers.filter(a => a.isDone).length
    const current = list.find(t => t.status === 'in_progress')
    const step =
      current?.activeForm ??
      (done === total ? say(s.name, 'Complete, the trials are.', 'All orders executed.') : `${s.words.working}…`)
    const room = Math.max(10, (e.props.bodyColumns ?? 80) - 30)
    const g = saber(done / total, Math.min(24, room))

    return (
      <Box>
        <Text color={s.hilt}>{g.hilt}</Text>
        <Text color={done === total ? s.done : s.blade}>{g.blade}</Text>
        <Text dimColor>{g.rest} </Text>
        <Text color={s.blade} bold>
          {done}/{total}{' '}
        </Text>
        <Text dimColor>{step.slice(0, room)}</Text>
      </Box>
    )
  })

  // The side panel: one row per sub-agent, each with its own saber.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const helpers = await read($, agents)
    const s = SIDES[await read($, side)]
    const width = Math.max(8, Math.min(20, (e.props.bodyColumns ?? 40) - 14))
    const heading = (
      <Text color={s.blade} bold>
        {spaced(s.agents.toUpperCase())}  {helpers.length}
      </Text>
    )

    if (helpers.length === 0) {
      return (
        <Box flexDirection="column">
          {heading}
          <Text dimColor italic>
            {say(s.name, 'No padawans yet. Send one out, you must.', 'No apprentices. The Citadel is silent.')}
          </Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        {heading}
        {helpers.map(a => {
          const color = colorOf(s, a.slot)
          const g = saber(a.isDone ? 1 : a.tools / (a.tools + 6), width)

          return (
            <Box flexDirection="column" key={a.id} marginTop={1}>
              <Text color={color} bold>
                {a.name.slice(0, width + 10)}
              </Text>
              <Text>
                <Text color={s.hilt}>{g.hilt}</Text>
                <Text color={color}>{g.blade}</Text>
                <Text dimColor>{g.rest} </Text>
                <Text color={a.isDone ? s.done : color}>
                  {a.isDone ? s.words.done : `${s.words.working} · ${a.tools} calls`}
                </Text>
              </Text>
              <Text dimColor>{compact(a.tokens)} tokens</Text>
            </Box>
          )
        })}
      </Box>
    )
  })
}
