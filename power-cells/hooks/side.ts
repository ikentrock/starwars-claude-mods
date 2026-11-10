// Which side of the Force this session is on, and that side's words and colors.
//
// The side, first match wins:
//   1. STARWARS_SIDE=jedi|sith in the environment;
//   2. the side picked with /side (droid-console), kept in ~/.claude/starwars-side;
//   3. Herdr's Star Wars layouts (herdr-star-wars): Herdr keeps the layout it
//      shows in shared.json, so Jedi Archives / Sith Citadel switch every mod;
//   4. without Herdr, Claude Code's own theme: a light one is Jedi, else Sith.
//
// Colors are ANSI names, never hex, so they come from the terminal's palette:
// Herdr paints them from the layout's theme (4.5:1 contrast on cream and on
// black), and any other terminal from its own.
//
// The canonical copy is shared/side.ts; scripts/sync-side.sh copies it into
// each mod's hooks/ folder, since every mod installs on its own.

import type { EngineInterface } from 'claude-code'

export type SideName = 'jedi' | 'sith'

export type Status = 'working' | 'blocked' | 'done' | 'idle'

export type Side = {
  name: SideName
  /** The layout's title, as Herdr's top bar shows it. */
  title: string
  motto: string
  /** The blade, the side's own color. */
  blade: string
  /** A finished agent: green for the Jedi, white for the Sith. */
  done: string
  /** An agent that needs you: amber on both sides. */
  blocked: string
  /** Something gone wrong. */
  alert: string
  /** A saber's hilt. */
  hilt: string
  /** What the person is called, and what an agent is. */
  master: string
  agent: string
  agents: string
  words: Record<Status, string>
  /** One color per sub-agent, readable on the side's background. */
  palette: string[]
}

export const SIDES: Record<SideName, Side> = {
  jedi: {
    name: 'jedi',
    title: 'JEDI ARCHIVES',
    motto: 'Patience. The build will come.',
    blade: 'blue',
    done: 'green',
    blocked: 'yellow',
    alert: 'red',
    hilt: 'gray',
    master: 'MASTER',
    agent: 'Padawan',
    agents: 'Padawans',
    words: { working: 'in training', blocked: 'seeks your counsel', done: 'trial complete', idle: 'at rest' },
    palette: ['blue', 'green', 'magenta', 'cyan', 'yellow', 'blueBright', 'greenBright'],
  },
  sith: {
    name: 'sith',
    title: 'SITH CITADEL',
    motto: 'Peace is a lie. There is only the build.',
    blade: 'red',
    done: 'whiteBright',
    blocked: 'yellow',
    alert: 'redBright',
    hilt: 'gray',
    master: 'MY LORD',
    agent: 'Apprentice',
    agents: 'Apprentices',
    words: { working: 'executing orders', blocked: 'awaits your command', done: 'mission complete', idle: 'dormant' },
    palette: ['red', 'yellow', 'magenta', 'cyan', 'redBright', 'yellowBright', 'magentaBright'],
  },
}

export const DEFAULT_SIDE: SideName = 'sith'

const isSide = (value: unknown): value is SideName => value === 'jedi' || value === 'sith'

/** Where /side keeps a side picked by hand, for every mod to read. */
export async function choiceFile($: EngineInterface) {
  return `${(await $.env.get('HOME')) ?? ''}/.claude/starwars-side`
}

/** The Star Wars layout Herdr shows, if it shows one. */
export async function herdrLayout($: EngineInterface): Promise<SideName | undefined> {
  const home = (await $.env.get('HOME')) ?? ''
  const herdr = (await $.env.get('HERDR_APP_HOME')) || `${home}/.config/herdr-app`
  try {
    const shared = JSON.parse(await $.fs.read(`${herdr}/shared.json`)) as { layout?: unknown }
    if (isSide(shared.layout)) return shared.layout
  } catch {
    // no Herdr, or Herdr is rewriting the file
  }

  return undefined
}

/** Reads the side: STARWARS_SIDE, /side's pick, Herdr's layout, Claude Code's theme. */
export async function detectSide($: EngineInterface): Promise<SideName> {
  const forced = String((await $.env.get('STARWARS_SIDE')) ?? '').trim().toLowerCase()
  if (isSide(forced)) return forced

  try {
    const picked = (await $.fs.read(await choiceFile($))).trim().toLowerCase()
    if (isSide(picked)) return picked
  } catch {
    // nothing picked: fall through
  }

  const layout = await herdrLayout($)
  if (layout) return layout

  // No Herdr: the side whose colors suit Claude Code's theme, light or dark.
  try {
    const theme = String((await $.settings.read({ key: 'theme' })) ?? '')
    if (theme.startsWith('light')) return 'jedi'
  } catch {
    // settings unreadable: fall through
  }

  return DEFAULT_SIDE
}

/**
 * Calls `onChange` with the side now, then again whenever it changes, so a
 * switch in Herdr ("Join the Dark Side") redraws the mod within seconds.
 */
export async function followSide($: EngineInterface, onChange: (side: SideName) => Promise<unknown>) {
  let last = await detectSide($)
  await onChange(last)
  $.clock.every(3000, async () => {
    const now = await detectSide($)
    if (now !== last) {
      last = now
      await onChange(now)
    }
  })
}

/** Jedi or Sith words for the same thing. */
export const say = (side: SideName, jedi: string, sith: string) => (side === 'jedi' ? jedi : sith)

/** Spaced capitals ("S I T H"), Herdr's heading style. */
export const spaced = (text: string) => text.split('').join(' ')

/** A saber gauge split into its lit and unlit parts, for two colors. */
export const saber = (fraction: number, width: number) => {
  const lit = Math.round(Math.max(0, Math.min(1, fraction)) * width)

  return { hilt: '▬', blade: '━'.repeat(lit), rest: '─'.repeat(width - lit) }
}
