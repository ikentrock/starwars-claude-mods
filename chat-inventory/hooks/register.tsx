import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { InventoryFile } from '../types'

const PANE = 'in-this-chat'
const goal = atom({ plugin: 'chat-inventory', key: 'goal' } as const, '', { shape: 'goal-1' })
const todos = atom({ plugin: 'chat-inventory', key: 'todos' } as const, [], { shape: 'todos-1' })
const connectors = atom({ plugin: 'chat-inventory', key: 'connectors' } as const, {}, { shape: 'connectors-1' })
const skills = atom({ plugin: 'chat-inventory', key: 'skills' } as const, {}, { shape: 'skills-1' })
const files = atom({ plugin: 'chat-inventory', key: 'files' } as const, [], { shape: 'files-1' })

const bump = (counts: Record<string, number>, name: string) => ({
  ...counts,
  [name]: (counts[name] ?? 0) + 1,
})

async function note($: EngineInterface, path: string, kind: InventoryFile['kind']) {
  await update($, files, list =>
    list.some(f => f.path === path && f.kind === kind)
      ? list
      : [...list, { path, kind }].slice(-300),
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'inventory',
      description: 'Open the In This Chat panel',
    })
    void $.ui.open({ id: PANE, title: 'In This Chat' })

    return next(e)
  })

  on('command.run', { command: 'inventory' }, async $ => {
    await $.ui.open({ id: PANE, title: 'In This Chat' })

    return { text: 'In This Chat opened.' }
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, goal, () => '')
      await update($, todos, () => [])
      await update($, connectors, () => ({}))
      await update($, skills, () => ({}))
      await update($, files, () => [])
    }

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    if (!e.command && !e.isMeta) {
      await update($, goal, current => (current === '' ? e.text.trim().slice(0, 160) : current))
    }

    return next(e)
  })

  // Pure bookkeeping: no model call, so the panel costs no tokens.
  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const input = e as unknown as Record<string, unknown>

    if (tool === 'TodoWrite') {
      const list = (input.todos ?? []) as { content: string; status: string; activeForm: string }[]
      await update($, todos, () => list.map(t => ({ ...t })))
    } else if (tool.startsWith('mcp__')) {
      const server = tool.split('__')[1] ?? tool
      await update($, connectors, counts => bump(counts, server))
    } else if (tool === 'Skill') {
      await update($, skills, counts => bump(counts, String(input.skill ?? 'unknown')))
    } else if (tool === 'Read' && typeof input.file_path === 'string') {
      await note($, input.file_path, 'read')
    } else if (tool === 'Write' && typeof input.file_path === 'string') {
      await note($, input.file_path, 'created')
    } else if (tool === 'Edit' && typeof input.file_path === 'string') {
      await note($, input.file_path, 'edited')
    }

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const [g, list, conn, sk, fl] = [
      await read($, goal),
      await read($, todos),
      await read($, connectors),
      await read($, skills),
      await read($, files),
    ]
    const width = Math.max(16, (e.props.bodyColumns ?? 40) - 4)
    const cut = (text: string) => (text.length > width ? `${text.slice(0, width - 1)}…` : text)
    const mark = { completed: '✔', in_progress: '▸', pending: '·' } as Record<string, string>

    return (
      <Box flexDirection="column">
        <Text bold>Goal</Text>
        <Text dimColor={g === ''}>{g === '' ? 'Not set yet' : cut(g)}</Text>
        <Text bold>To-do</Text>
        {list.length === 0 && <Text dimColor>None</Text>}
        {list.map(t => (
          <Text dimColor={t.status === 'completed'}>
            {mark[t.status] ?? '·'} {cut(t.status === 'in_progress' ? t.activeForm : t.content)}
          </Text>
        ))}
        <Text bold>Connectors</Text>
        {Object.keys(conn).length === 0 && <Text dimColor>None called</Text>}
        {Object.entries(conn).map(([name, n]) => (
          <Text>
            {cut(name)} <Text dimColor>×{n}</Text>
          </Text>
        ))}
        <Text bold>Skills</Text>
        {Object.keys(sk).length === 0 && <Text dimColor>None active</Text>}
        {Object.entries(sk).map(([name, n]) => (
          <Text>
            {cut(name)} <Text dimColor>×{n}</Text>
          </Text>
        ))}
        <Text bold>Files</Text>
        {fl.length === 0 && <Text dimColor>None touched</Text>}
        {fl.slice(-40).map(f => (
          <Text>
            <Text dimColor>{f.kind} </Text>
            {cut(f.path.split('/').slice(-3).join('/'))}
          </Text>
        ))}
      </Box>
    )
  })
}
