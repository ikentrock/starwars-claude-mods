import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Personality } from '../types'
import { SIDES, choiceFile, detectSide, followSide, herdrLayout, spaced } from './side'
import type { SideName } from './side'

const personality = atom(
  { plugin: 'droid-console', key: 'personality' } as const,
  'auto',
  { shape: 'personality-2' },
)
const side = atom({ plugin: 'droid-console', key: 'side' } as const, 'sith', { shape: 'side-1' })

type SpinnerMode = 'requesting' | 'thinking' | 'responding' | 'tool-input' | 'tool-use'

type Look = {
  name: string
  accent: string
  user: string
  ok: string
  alert: string
  /** What the person's own messages are labelled with. */
  operator: string
  /** The line over each reply. */
  header: string
  /** The band above the prompt, idle and working. */
  idle: string
  working: string
  spinner: Record<SpinnerMode, string>
  duration: string
}

const DROID_SPINNER: Record<SpinnerMode, string> = {
  requesting: 'Transmitting',
  thinking: 'Computing',
  responding: 'Broadcasting',
  'tool-input': 'Calibrating',
  'tool-use': 'Actuating',
}

const droid = (name: string, accent: string, user: string, ok: string, alert: string): Look => ({
  name,
  accent,
  user,
  ok,
  alert,
  operator: 'OPERATOR',
  header: `${name} // TRANSMISSION INCOMING`,
  idle: 'SYSTEMS NOMINAL',
  working: 'PROCESSING',
  spinner: DROID_SPINNER,
  duration: 'Computed',
})

// The two droids Herdr floats in its layouts, with Herdr's words for each side.
const SIDE_LOOKS: Record<SideName, Look> = {
  jedi: {
    name: 'TRAINING REMOTE',
    accent: SIDES.jedi.blade,
    user: SIDES.jedi.blade,
    ok: SIDES.jedi.done,
    alert: SIDES.jedi.blocked,
    operator: SIDES.jedi.master,
    header: 'From your padawan, a report this is',
    idle: SIDES.jedi.words.idle,
    working: SIDES.jedi.words.working,
    spinner: {
      requesting: 'Reaching out',
      thinking: 'Meditating',
      responding: 'Answering',
      'tool-input': 'Focusing',
      'tool-use': 'Training',
    },
    duration: 'Trained',
  },
  sith: {
    name: 'INTERROGATOR ORB',
    accent: SIDES.sith.blade,
    user: SIDES.sith.done,
    ok: SIDES.sith.done,
    alert: SIDES.sith.blocked,
    operator: SIDES.sith.master,
    header: 'REPORT FROM YOUR APPRENTICE',
    idle: SIDES.sith.words.idle,
    working: SIDES.sith.words.working,
    spinner: {
      requesting: 'Transmitting orders',
      thinking: 'Plotting',
      responding: 'Reporting',
      'tool-input': 'Forging',
      'tool-use': 'Executing orders',
    },
    duration: 'Plotted',
  },
}

const DROIDS: Record<Exclude<Personality, 'auto'>, Look> = {
  r2d2: droid('R2-D2', 'cyan', 'blue', 'green', 'red'),
  c3po: droid('C-3PO', 'yellow', 'white', 'green', 'red'),
  bb8: droid('BB-8', 'magenta', 'yellow', 'green', 'red'),
  imperial: droid('IG-11', 'red', 'white', 'gray', 'yellow'),
}
const ORDER: Personality[] = ['auto', 'r2d2', 'c3po', 'bb8', 'imperial']

// Claude Code's ANSI themes take their colors from the terminal, which Herdr
// paints from the layout's theme, so the whole UI wears the side's palette.
const THEMES: Record<SideName, string> = { jedi: 'light-ansi', sith: 'dark-ansi' }
const OURS = new Set(Object.values(THEMES))
const OWN_THEME = 'own-theme'

const insideHerdr = async ($: EngineInterface) =>
  Boolean(await $.env.get('HC_TERMINAL_SOCKET')) || (await $.env.get('__CFBundleIdentifier')) === 'dev.herdr.app'

const currentTheme = async ($: EngineInterface) =>
  String((await $.config.list()).find(row => row.key === 'theme')?.value ?? '')

// Puts on the side's theme, first keeping the person's own to give back later.
async function wearTheme($: EngineInterface, s: SideName) {
  const now = await currentTheme($)
  if (now === THEMES[s]) return
  if (!OURS.has(now)) await $.store.set(OWN_THEME, now)
  await $.config.set({ key: 'theme', value: THEMES[s] })
}

// Outside Herdr: the person's own theme back, unless they chose another since.
async function returnTheme($: EngineInterface) {
  const own = await $.store.get(OWN_THEME)
  if (typeof own !== 'string') return
  if (OURS.has(await currentTheme($))) await $.config.set({ key: 'theme', value: own })
  await $.store.delete(OWN_THEME)
}

const look = async ($: EngineInterface): Promise<Look> => {
  const p = await read($, personality)

  return p === 'auto' ? SIDE_LOOKS[await read($, side)] : DROIDS[p]
}

export const register: Register = (on, options) => {
  const matchTheme = options.matchTheme !== 'off'

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'droid',
      description: 'Switch the droid console: auto (follows the side), r2d2, c3po, bb8, imperial',
    })
    await $.command.register({
      name: 'side',
      description: 'Pick a side for every Star Wars mod: jedi, sith, or auto (follow Herdr, else Claude Code\'s theme)',
      argumentHint: 'jedi|sith|auto',
    })
    // The theme is a nicety: a refusal there must never stop the console.
    const herdr = matchTheme && (await insideHerdr($))
    if (!herdr) await returnTheme($).catch(() => undefined)
    await followSide($, s => update($, side, () => s))
    // The theme follows Herdr's background, even when /side picked the other side.
    if (herdr) {
      let worn: SideName | undefined
      const fit = async () => {
        const layout = await herdrLayout($)
        if (layout && layout !== worn) {
          worn = layout
          await wearTheme($, layout).catch(() => undefined)
        }
      }
      await fit()
      $.clock.every(3000, fit)
    }
    const s = await read($, side)
    $.ui.toast(
      s === 'jedi'
        ? 'Online, the training remote is. Begin, we shall.'
        : 'Report: the interrogator orb is online, my lord.',
    )

    return next(e)
  })

  // A side picked by hand, for every mod, with or without Herdr.
  on('command.run', { command: 'side' }, async ($, e) => {
    const wanted = String(e.args ?? '').trim().toLowerCase()
    const file = await choiceFile($)
    if (wanted === 'jedi' || wanted === 'sith') {
      await $.fs.write(file, `${wanted}\n`)
    } else if (wanted === 'auto') {
      if (await $.fs.exists(file)) await $.fs.write(file, '')
    } else {
      return { text: `On the ${await detectSide($)} side. Usage: /side jedi, /side sith, or /side auto (follow Herdr, else Claude Code's theme).` }
    }
    const now = await detectSide($)
    if (wanted === 'auto') {
      return { text: `Following Herdr again, else Claude Code's theme: on the ${now} side.` }
    }

    return {
      text:
        now === 'jedi'
          ? 'With the Jedi, you now stand. Within moments, follow the other mods will.'
          : 'Report: the Sith side is yours, my lord. The other mods follow within moments.',
    }
  })

  on('command.run', { command: 'droid' }, async ($, e) => {
    const wanted = String(e.args ?? '').trim().toLowerCase().replace(/[^a-z0-9]/g, '')
    const current = await read($, personality)
    const chosen = (ORDER as string[]).includes(wanted)
      ? (wanted as Personality)
      : (ORDER[(ORDER.indexOf(current) + 1) % ORDER.length] ?? 'auto')
    await update($, personality, () => chosen)

    return {
      text:
        chosen === 'auto'
          ? `Droid follows the side again: ${SIDE_LOOKS[await read($, side)].name}.`
          : `Personality set to ${DROIDS[chosen].name}.`,
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)

    if (e.props.hasSurvey) {
      return below
    }

    const { Box, Text } = $.ui.resolve(e)
    const l = await look($)
    const isAuto = (await read($, personality)) === 'auto'
    const title = isAuto ? spaced(SIDES[await read($, side)].title) : l.name
    const state = e.props.isWorking ? l.working : l.idle

    return (
      <Box flexDirection="column">
        <Box>
          <Text color={l.accent} bold>
            ◉ {title}{' '}
          </Text>
          {isAuto ? (
            <Text>
              <Text color="gray">▬</Text>
              <Text color={l.accent}>{e.props.isWorking ? '━━━━━━━━ ' : '━━ '}</Text>
              <Text color={e.props.isWorking ? l.accent : l.ok}>{state}</Text>
            </Text>
          ) : (
            <Text color={e.props.isWorking ? l.alert : l.ok}>░▒▓ {state} ▓▒░</Text>
          )}
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
          ▶ {l.operator}{' '}
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
          ◉ {l.header}
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
        <Text color={color}>{(await read($, personality)) === 'auto' ? '● ' : '⚙ '}</Text>
        {drawn}
      </Box>
    )
  })

  on('ui.render', { component: 'Spinner' }, async ($, e, next) =>
    next({
      ...e,
      props: { ...e.props, word: (await look($)).spinner[e.props.mode], suffix: ' ◉' },
    }),
  )

  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) =>
    next({ ...e, props: { ...e.props, word: (await look($)).duration } }),
  )

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const l = await look($)
    const isAuto = (await read($, personality)) === 'auto'

    return next({
      ...e,
      props: { ...e.props, tail: isAuto ? `◉ ${SIDES[await read($, side)].motto}` : `◉ ${l.name} console` },
    })
  })
}
