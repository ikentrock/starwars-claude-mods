import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { SIDES, followSide, say, spaced } from './side'

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
const side = atom({ plugin: 'handoff', key: 'side' } as const, 'sith', { shape: 'side-1' })

const voice = async ($: EngineInterface, jedi: string, sith: string) => say(await read($, side), jedi, sith)
const paneTitle = async ($: EngineInterface) => voice($, 'Handoff Holocron', 'Handoff Orders')

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
  await $.ui.open({ id: PANE, title: await paneTitle($), focus: true })
}

export const register: Register = on => {
  let coldTimer: { cancel: () => void } | undefined

  on('session.start', async ($, e, next) => {
    await followSide($, s => update($, side, () => s))
    await $.command.register({
      name: 'handoff',
      description: 'Write a handoff prompt for a fresh chat',
    })

    return next(e)
  })

  on('command.run', { command: 'handoff' }, async $ => {
    await build($, await voice($, 'Asked for it, you did.', 'By your order, my lord.'))

    return {
      text: await voice($, 'Ready in the Handoff Holocron, your handoff is.', 'Report: handoff orders are ready in their pane.'),
    }
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
      $.ui.toast(
        await voice(
          $,
          '250,000 tokens, the context has grown. A handoff, I prepare.',
          'Report: the context has reached 250,000 tokens. Drafting handoff orders.',
        ),
      )
      void build(
        $,
        await voice(
          $,
          `Reached ${context.toLocaleString()} tokens, the conversation has.`,
          `The conversation reached ${context.toLocaleString()} tokens.`,
        ),
      )
    }

    coldTimer?.cancel()
    coldTimer = $.clock.after(COLD_MS, async () => {
      if (await read($, isOffered)) return
      await update($, isOffered, () => true)
      void build($, await voice($, 'Cold, the prompt cache went.', 'The prompt cache went cold.'))
    })

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Markdown, Text } = $.ui.resolve(e)
    const handoff = await read($, text)
    const reason = await read($, why)
    const s = SIDES[await read($, side)]

    if (handoff === '') {
      return <Text dimColor>{say(s.name, 'Nothing yet, there is. Type /handoff.', 'No orders yet. Type /handoff.')}</Text>
    }

    const room = Math.max(8, (e.viewport?.rows ?? 30) - 8)
    const shown = handoff.split('\n').slice(0, room * 2).join('\n')

    return (
      <Box flexDirection="column">
        <Text color={s.blade} bold>
          {spaced(say(s.name, 'FOR THE NEXT PADAWAN', 'FOR THE NEXT APPRENTICE'))}
        </Text>
        <Text dimColor>{reason}</Text>
        <Box>
          <Button
            key="fresh"
            variant="primary"
            label={say(s.name, 'Begin anew (fresh chat)', 'Deploy to a fresh chat')}
            onPress={async () => {
              await $.command.run({ command: 'clear' })
              await $.prompt.fill({ text: handoff, mode: 'replace' })
              await update($, isOffered, () => false)
              $.ui.toast(
                say(
                  s.name,
                  'In your prompt box, the handoff is. Press Enter, and begin you will.',
                  'Report: the orders are in your prompt box. Press Enter to deploy.',
                ),
              )
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
