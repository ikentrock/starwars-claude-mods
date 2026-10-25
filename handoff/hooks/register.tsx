import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

const PANE = 'handoff'
const TOKEN_LIMIT = 250_000
const COLD_MS = 5 * 60 * 1000
const MODEL = 'sonnet'
const DIGEST_CHARS = 90_000

const text = atom({ plugin: 'handoff', key: 'text' } as const, '', { shape: 'text-1' })
const why = atom({ plugin: 'handoff', key: 'why' } as const, '', { shape: 'why-1' })
const isOffered = atom({ plugin: 'handoff', key: 'isOffered' } as const, false, {
  shape: 'offered-1',
})

const unique = (items: string[]) => [...new Set(items)]
const list = (items: string[]) => (items.length ? items.map(i => `- ${i}`).join('\n') : '- none')

async function build($: EngineInterface, reason: string) {
  const messages = await $.session.messages()
  const read_: string[] = []
  const made: string[] = []
  const skills: string[] = []
  const tools: string[] = []
  const links: string[] = []
  const lines: string[] = []

  for (const m of messages) {
    lines.push(`${m.role.toUpperCase()}: ${m.text}`)
    links.push(...(m.text.match(/https?:\/\/[^\s)>\]"']+/g) ?? []))
    for (const use of m.toolUses) {
      tools.push(use.tool)
      const path = typeof use.input.file_path === 'string' ? use.input.file_path : undefined
      if (use.tool === 'Read' && path) read_.push(path)
      if ((use.tool === 'Write' || use.tool === 'Edit') && path) made.push(`${use.tool}: ${path}`)
      if (use.tool === 'Skill') skills.push(String(use.input.skill ?? 'unknown'))
      for (const value of Object.values(use.input)) {
        if (typeof value === 'string') links.push(...(value.match(/https?:\/\/[^\s)>\]"']+/g) ?? []))
      }
    }
  }

  const whole = lines.join('\n\n')
  const digest =
    whole.length > DIGEST_CHARS
      ? `${whole.slice(0, DIGEST_CHARS / 3)}\n\n[… middle omitted …]\n\n${whole.slice(-DIGEST_CHARS * 2 / 3)}`
      : whole

  const written = await $.model.complete({
    model: MODEL,
    maxTokens: 4000,
    prompt: `Below is a coding-assistant conversation. Write a HANDOFF PROMPT that a fresh session can start from with no other context. Use these sections: Goal; Current state (what is done, what is half-done); Key decisions and why; Constraints and user preferences; Open problems; Next steps (numbered, concrete). Write it as instructions to the next assistant. Do not list files, tools, skills or links: they are appended separately.\n\n<conversation>\n${digest}\n</conversation>`,
  })
  const body = written.isAnswered ? written.text.trim() : '(The summary model failed; see the inventory below.)'

  const handoff = `# Handoff\n\n${body}\n\n## Files read\n${list(unique(read_))}\n\n## Files created or edited\n${list(unique(made))}\n\n## Skills used\n${list(unique(skills))}\n\n## Tools used\n${list(unique(tools))}\n\n## Links\n${list(unique(links).slice(0, 60))}\n\nContinue from "Next steps". Re-read the files above as needed before acting.`

  await update($, text, () => handoff)
  await update($, why, () => reason)
  await $.ui.open({ id: PANE, title: 'Handoff', focus: true })
}

export const register: Register = on => {
  let coldTimer: { cancel: () => void } | undefined

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'handoff',
      description: 'Write a handoff prompt for a fresh chat',
    })

    return next(e)
  })

  on('command.run', { command: 'handoff' }, async $ => {
    await build($, 'You asked for it.')

    return { text: 'Handoff ready in the Handoff pane.' }
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, isOffered, () => false)
    }

    return next(e)
  })

  on('prompt.submit', ($, e, next) => {
    if (!e.isMeta) {
      coldTimer?.cancel()
      coldTimer = undefined
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId !== undefined || !e.usage) return next(e)

    const u = e.usage
    const context = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
    if (context >= TOKEN_LIMIT && !(await read($, isOffered))) {
      await update($, isOffered, () => true)
      $.ui.toast('Handoff: 250,000 tokens, the context has grown. Preparing a handoff.')
      void build($, `The conversation reached ${context.toLocaleString()} tokens.`)
    }

    coldTimer?.cancel()
    coldTimer = $.clock.after(COLD_MS, async () => {
      if (await read($, isOffered)) return
      await update($, isOffered, () => true)
      void build($, 'The prompt cache went cold.')
    })

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Markdown, Text } = $.ui.resolve(e)
    const handoff = await read($, text)
    const reason = await read($, why)

    if (handoff === '') return <Text dimColor>Nothing yet. Type /handoff.</Text>

    const room = Math.max(8, (e.viewport?.rows ?? 30) - 8)
    const shown = handoff.split('\n').slice(0, room * 2).join('\n')

    return (
      <Box flexDirection="column">
        <Text dimColor>{reason}</Text>
        <Box>
          <Button
            key="fresh"
            variant="primary"
            label="Start fresh chat"
            onPress={async () => {
              await $.command.run({ command: 'clear' })
              await $.prompt.fill({ text: handoff, mode: 'replace' })
              await update($, isOffered, () => false)
              $.ui.toast('Handoff placed in your prompt box. Press Enter to begin.')
            }}
          />
          <Button
            key="copy"
            label="Copy"
            onPress={() => $.ui.copy({ text: handoff, surface: e.surface })}
          />
        </Box>
        <Markdown key="preview" text={shown} />
      </Box>
    )
  })
}
