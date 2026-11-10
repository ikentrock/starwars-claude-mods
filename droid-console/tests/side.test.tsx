import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  plugin: 'droid-console',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: true,
    maxRows: 6,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 6 },
    view: {},
  },
} as const

test('the band follows the layout Herdr shows, and its switch', async ($, on) => {
  let layout = 'jedi'
  const clock = mock.clock(on)
  mock.store(on)
  mock.env(on, { HOME: '/home/padawan' })
  on('fs.read', (_, e) => {
    if (e.path !== '/home/padawan/.config/herdr-app/shared.json') throw new Error('ENOENT')

    return { value: JSON.stringify({ layout }) }
  })
  on('command.register', () => ({ value: { command: 'droid' } }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /J E D I/ }))?.text).toContain('J E D I   A R C H I V E S')
    expect(await ui.find({ type: 'Text', text: /in training/ })).toBeTruthy()
    await ui.unmount()
  }

  // "Join the Dark Side" in Herdr: the next poll picks it up.
  layout = 'sith'
  await clock.advance(3000)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /S I T H/ })).toBeTruthy()
  expect(await ui.find({ type: 'Text', text: /executing orders/ })).toBeTruthy()
  await ui.unmount()
})

test('no Herdr means Sith', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  mock.env(on, { HOME: '/nowhere' })
  on('fs.read', () => {
    throw new Error('ENOENT')
  })
  on('command.register', () => ({ value: { command: 'droid' } }))
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(String(e.text))

    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(toasts.join()).toContain('interrogator orb')

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /S I T H/ })).toBeTruthy()
  await ui.unmount()
})

test('STARWARS_SIDE=jedi overrides a Sith layout', async ($, on) => {
  mock.env(on, { HOME: '/home/padawan', STARWARS_SIDE: 'Jedi' })
  on('fs.read', () => ({ value: JSON.stringify({ layout: 'sith' }) }))
  on('command.register', () => ({ value: { command: 'droid' } }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /J E D I/ })).toBeTruthy()
  await ui.unmount()
})

// The /config theme row, answered from memory; records every set.
function themeRow(on: Parameters<Parameters<typeof test>[1]>[1], start: string) {
  const sets: string[] = []
  let theme = start
  on('config.list', () => ({
    value: [{ key: 'theme', label: 'Theme', kind: 'choice', value: theme, provider: { plugin: 'engine', tier: 'core' }, isLocked: false }],
  }))
  on('config.set', (_, e) => {
    theme = String(e.value)
    sets.push(theme)

    return { value: e.value }
  })

  return { sets, now: () => theme }
}

test('inside Herdr, the theme follows the side and keeps the person\'s own', async ($, on) => {
  let layout = 'jedi'
  const clock = mock.clock(on)
  mock.store(on)
  mock.env(on, { HOME: '/home/padawan', HC_TERMINAL_SOCKET: '/tmp/herdr.sock' })
  on('fs.read', () => ({ value: JSON.stringify({ layout }) }))
  on('command.register', () => ({ value: { command: 'droid' } }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const row = themeRow(on, 'dark')
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(row.sets).toEqual(['light-ansi'])

  layout = 'sith'
  await clock.advance(3000)
  expect(row.sets).toEqual(['light-ansi', 'dark-ansi'])
})

test('outside Herdr, the person\'s own theme comes back', async ($, on) => {
  mock.store(on, { 'own-theme': 'dark' })
  mock.env(on, { HOME: '/home/padawan' })
  on('fs.read', () => ({ value: JSON.stringify({ layout: 'jedi' }) }))
  on('command.register', () => ({ value: { command: 'droid' } }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const row = themeRow(on, 'light-ansi')
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(row.now()).toBe('dark')
})

test('matchTheme=off leaves the theme alone', { options: { matchTheme: 'off' } }, async ($, on) => {
  mock.clock(on)
  mock.store(on)
  mock.env(on, { HOME: '/home/padawan', HC_TERMINAL_SOCKET: '/tmp/herdr.sock' })
  on('fs.read', () => ({ value: JSON.stringify({ layout: 'jedi' }) }))
  on('command.register', () => ({ value: { command: 'droid' } }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  const row = themeRow(on, 'dark')
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(row.sets).toEqual([])
})

test('a theme that cannot be set leaves the console standing', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  mock.env(on, { HOME: '/home/padawan', HC_TERMINAL_SOCKET: '/tmp/herdr.sock' })
  on('fs.read', () => ({ value: JSON.stringify({ layout: 'jedi' }) }))
  on('command.register', () => ({ value: { command: 'droid' } }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('config.list', () => {
    throw new Error('no config here')
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /J E D I/ })).toBeTruthy()
  await ui.unmount()
})

test('no Herdr: a light Claude Code theme is Jedi', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  mock.env(on, { HOME: '/home/padawan' })
  on('fs.read', () => {
    throw new Error('ENOENT')
  })
  on('settings.read', () => ({ value: { theme: 'light-daltonized' } }))
  on('command.register', () => ({ value: { command: 'droid' } }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /J E D I/ })).toBeTruthy()
  await ui.unmount()
})

test('/side picks a side for every mod and wins over Herdr', async ($, on) => {
  const files: Record<string, string> = {
    '/home/padawan/.config/herdr-app/shared.json': JSON.stringify({ layout: 'jedi' }),
  }
  const clock = mock.clock(on)
  mock.store(on)
  mock.env(on, { HOME: '/home/padawan' })
  on('fs.read', (_, e) => {
    const text = files[e.path]
    if (text === undefined) throw new Error('ENOENT')

    return { value: text }
  })
  on('fs.write', (_, e) => {
    files[e.path] = e.text

    return { value: undefined }
  })
  on('fs.exists', (_, e) => ({ value: e.path in files }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.toast', () => ({ value: undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  const picked = await $.command.run({ command: 'side', args: 'sith' })
  expect(files['/home/padawan/.claude/starwars-side']).toBe('sith\n')
  expect(JSON.stringify(picked)).toContain('Sith side')
  await clock.advance(3000)
  let ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /S I T H/ })).toBeTruthy()
  await ui.unmount()

  await $.command.run({ command: 'side', args: 'auto' })
  await clock.advance(3000)
  ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /J E D I/ })).toBeTruthy()
  await ui.unmount()
})
