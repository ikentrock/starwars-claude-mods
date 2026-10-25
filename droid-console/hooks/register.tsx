import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Personality } from '../types'

const personality = atom(
  { plugin: 'droid-console', key: 'personality' } as const,
  'r2d2',
  { shape: 'personality-1' },
)

type Look = { name: string; accent: string; user: string; ok: string; alert: string }

const LOOKS: Record<Personality, Look> = {
  r2d2: { name: 'R2-D2', accent: 'cyan', user: 'blue', ok: 'green', alert: 'red' },
  c3po: { name: 'C-3PO', accent: 'yellow', user: 'white', ok: 'green', alert: 'red' },
  bb8: { name: 'BB-8', accent: 'magenta', user: 'yellow', ok: 'green', alert: 'red' },
  imperial: { name: 'IG-11', accent: 'red', user: 'white', ok: 'gray', alert: 'yellow' },
}
const ORDER: Personality[] = ['r2d2', 'c3po', 'bb8', 'imperial']

const WORDS = {
  requesting: 'Transmitting',
  thinking: 'Computing',
  responding: 'Broadcasting',
  'tool-input': 'Calibrating',
  'tool-use': 'Actuating',
} as const

const look = async ($: Parameters<typeof read>[0]): Promise<Look> =>
  LOOKS[await read($, personality)]

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'droid',
      description: 'Switch the droid console personality (r2d2, c3po, bb8, imperial)',
    })
    $.ui.toast('Droid console online. Beep boop.')

    return next(e)
  })

  on('command.run', { command: 'droid' }, async ($, e) => {
    const wanted = String(e.args ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '')
    const current = await read($, personality)
    const next = (ORDER as string[]).includes(wanted)
      ? (wanted as Personality)
      : ORDER[(ORDER.indexOf(current) + 1) % ORDER.length]
    await update($, personality, () => next)

    return { text: `Personality set to ${LOOKS[next].name}.` }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)

    if (e.props.hasSurvey) {
      return below
    }

    const { Box, Text } = $.ui.resolve(e)
    const l = await look($)
    const state = e.props.isWorking ? 'PROCESSING' : 'SYSTEMS NOMINAL'

    return (
      <Box flexDirection="column">
        <Box>
          <Text color={l.accent} bold>
            ◉ {l.name}{' '}
          </Text>
          <Text color={e.props.isWorking ? l.alert : l.ok}>░▒▓ {state} ▓▒░</Text>
          <Text dimColor> /droid to swap personality</Text>
        </Box>
        {below}
      </Box>
    )
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.props.origin.kind !== 'composer') {
      return next(e)
    }

    const { Box, Text } = $.ui.resolve(e)
    const l = await look($)

    return (
      <Box>
        <Text color={l.user} bold>
          ▶ OPERATOR{' '}
        </Text>
        <Text>{e.props.text}</Text>
      </Box>
    )
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const drawn = await next(e)

    if (!e.props.isFirstOfReply) {
      return drawn
    }

    const { Box, Text } = $.ui.resolve(e)
    const l = await look($)

    return (
      <Box flexDirection="column">
        <Text color={l.accent} bold>
          ◉ {l.name} // TRANSMISSION INCOMING
        </Text>
        {drawn}
      </Box>
    )
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    const drawn = await next(e)
    const { Box, Text } = $.ui.resolve(e)
    const l = await look($)
    const color = e.props.isErrored ? l.alert : e.props.isRunning ? l.accent : l.ok

    return (
      <Box>
        <Text color={color}>⚙ </Text>
        {drawn}
      </Box>
    )
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) =>
    next({
      ...e,
      props: { ...e.props, word: WORDS[e.props.mode], suffix: ' ◉' },
    }),
  )

  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) =>
    next({ ...e, props: { ...e.props, word: 'Computed' } }),
  )

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) =>
    next({ ...e, props: { ...e.props, tail: `◉ ${(await look($)).name} console` } }),
  )
}
