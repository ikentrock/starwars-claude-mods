import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { SwitchMod } from '../types'

const PANE = 'switchboard'
const STORE_KEY = 'off'

const mods = atom({ plugin: 'switchboard', key: 'mods' } as const, [], { shape: 'mods-1' })
const off = atom({ plugin: 'switchboard', key: 'off' } as const, [], { shape: 'off-1' })
const panes = atom({ plugin: 'switchboard', key: 'panes' } as const, [], { shape: 'panes-1' })

const seen = new Map<string, SwitchMod>()

// Mods found on disk (this session's mod folders, and installed plugins) are
// merged with every plugin the engine admits, so a new mod appears by itself.
async function refresh($: EngineInterface) {
  const home = (await $.env.get('HOME')) ?? ''
  const roots = [`${home}/.claude/dev-mods`]
  for (const top of roots) {
    if (!(await $.fs.exists(top))) continue
    for (const session of await $.fs.list(top)) {
      if (session.kind !== 'dir') continue
      for (const mod of await $.fs.list(`${top}/${session.name}`)) {
        if (mod.kind !== 'dir') continue
        const dir = `${top}/${session.name}/${mod.name}`
        const manifest = `${dir}/.claude-plugin/plugin.json`
        if (!(await $.fs.exists(manifest))) continue
        try {
          const json = JSON.parse(await $.fs.read(manifest)) as {
            name?: string
            description?: string
          }
          const name = json.name ?? mod.name
          if (!seen.has(name)) seen.set(name, { name, description: json.description ?? '', root: dir })
        } catch {
          // a manifest still being written
        }
      }
    }
  }
  const installed = `${home}/.claude/plugins/installed_plugins.json`
  if (await $.fs.exists(installed)) {
    try {
      const json = JSON.parse(await $.fs.read(installed)) as { plugins?: Record<string, unknown> }
      for (const key of Object.keys(json.plugins ?? {})) {
        const name = key.split('@')[0] ?? key
        if (!seen.has(name)) seen.set(name, { name, description: `installed (${key})`, root: '' })
      }
    } catch {
      // unreadable registry: skip it
    }
  }
  const sorted = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
  await update($, mods, () => sorted)
  const shown = await $.ui.panes()
  await update($, panes, () => shown.map(p => ({ id: p.id, title: p.title })))
}

async function open($: EngineInterface) {
  await refresh($)
  await $.ui.open({ id: PANE, title: 'Switchboard', focus: true })
}


export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'mods', description: 'Open the Switchboard: toggle your mods' })
    const stored = await $.store.get(STORE_KEY)
    if (typeof stored === 'string') await update($, off, () => JSON.parse(stored) as string[])
    $.clock.every(5000, () => refresh($))
    await refresh($)

    return next(e)
  })

  on('command.run', { command: 'mods' }, async $ => {
    await open($)

    return { text: 'Switchboard open.' }
  })

  // Every plugin the engine admits joins the list; one switched off is refused.
  on('plugin.register', async ($, e, next) => {
    if (e.name !== $.plugin.name && !seen.has(e.name)) {
      seen.set(e.name, { name: e.name, description: e.provenance, root: e.root })
    }
    const stored = await $.store.get(STORE_KEY)
    const list = typeof stored === 'string' ? (JSON.parse(stored) as string[]) : []
    if (e.name !== $.plugin.name && list.includes(e.name)) {
      return { refuse: `Switchboard: ${e.name} is switched off` }
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const list = await read($, mods)
    const disabled = await read($, off)
    const open_ = await read($, panes)
    const width = Math.max(20, (e.props.bodyColumns ?? 50) - 14)

    const toggle = async (name: string) => {
      const next = (await read($, off)).includes(name)
        ? (await read($, off)).filter(n => n !== name)
        : [...(await read($, off)), name]
      await update($, off, () => next)
      await $.store.set(STORE_KEY, JSON.stringify(next))
      $.ui.toast(
        `Switchboard: ${name} ${next.includes(name) ? 'off' : 'on'}. Mod hooks apply on the next reload.`,
      )
    }

    return (
      <Box flexDirection="column">
        <Text bold>Mods</Text>
        {list.length === 0 && <Text dimColor>No mods found yet.</Text>}
        {list.map(m => (
          <Box key={m.name}>
            <Button
              key={`t-${m.name}`}
              plain
              onPress={() => toggle(m.name)}
              label={`${disabled.includes(m.name) ? '[ off ]' : '[ on  ]'} ${m.name}`}
            />
            <Text dimColor> {m.description.slice(0, width)}</Text>
          </Box>
        ))}
        <Text bold>Panels</Text>
        {open_.length === 0 && <Text dimColor>No other panels open.</Text>}
        {open_
          .filter(p => p.id !== PANE)
          .map(p => (
            <Box key={p.id}>
              <Button
                key={`h-${p.id}`}
                label="Hide"
                onPress={async () => {
                  await $.ui.close({ id: p.id })
                  await refresh($)
                }}
              />
              <Text> {p.title}</Text>
            </Box>
          ))}
      </Box>
    )
  })
}
