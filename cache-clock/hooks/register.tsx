import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { SIDES, followSide, say } from './side'

const WARM_LIMIT_MS = 2 * 60 * 60 * 1000
const MARGIN_MS = 20 * 1000

const expiresAt = atom({ plugin: 'cache-clock', key: 'expiresAt' } as const, null, {
  shape: 'expires-1',
})
const warmUntil = atom({ plugin: 'cache-clock', key: 'warmUntil' } as const, null, {
  shape: 'warm-1',
})
const clockNow = atom({ plugin: 'cache-clock', key: 'now' } as const, 0, { shape: 'now-1' })
const side = atom({ plugin: 'cache-clock', key: 'side' } as const, 'sith', { shape: 'side-1' })

const voice = async ($: EngineInterface, jedi: string, sith: string) => say(await read($, side), jedi, sith)

const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000))

  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

let ttlMs = 5 * 60 * 1000
let timer: { cancel: () => void } | undefined

const stopWarming = () => {
  timer?.cancel()
  timer = undefined
}

async function keepWarm($: EngineInterface) {
  const start = await $.clock.now()
  const limit = start + WARM_LIMIT_MS
  await update($, warmUntil, () => limit)

  const schedule = async () => {
    const at = await $.clock.now()
    const due = (await read($, expiresAt)) ?? at + ttlMs
    timer = $.clock.after(Math.max(1000, due - at - MARGIN_MS), async () => {
      const t = await $.clock.now()
      if (t >= limit || (await read($, warmUntil)) === null) {
        await update($, warmUntil, () => null)
        $.ui.toast(await voice($, 'Two hours, warm the cache I kept. Rest now, it will.', 'Report: two hours elapsed. Cache warming has stood down.'))
        return
      }
      // A fork rides the session's own cached prefix and never enters the chat.
      const pinged = await $.model.fork({ prompt: 'Reply with the single word: ok' })
      if (!pinged.isAnswered) {
        await update($, warmUntil, () => null)
        $.ui.toast(await voice($, 'Failed, the ping has. Warming, I stop.', 'Report: the ping failed. Cache warming aborted.'))
        return
      }
      await update($, expiresAt, () => t + ttlMs)
      await schedule()
    })
  }
  await schedule()
}

export const register: Register = (on, options) => {
  ttlMs = options.cacheTtl === '1h' ? 60 * 60 * 1000 : 5 * 60 * 1000

  on('session.start', async ($, e, next) => {
    await followSide($, s => update($, side, () => s))
    await $.command.register({
      name: 'keep-warm',
      description: 'Ping the prompt cache just before it expires, for up to 2 hours',
    })
    $.clock.every(1000, async () => {
      if ((await read($, expiresAt)) !== null) await update($, clockNow, () => Date.now())
    })

    return next(e)
  })

  // The reply is in: the cache was written or read, so its clock starts over.
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && e.usage) {
      const at = await $.clock.now()
      await update($, expiresAt, () => at + ttlMs)
      await update($, clockNow, () => at)
    }

    return next(e)
  })

  // A message of the person's own ends warming; the next reply restarts the clock.
  on('prompt.submit', async ($, e, next) => {
    if (!e.isMeta) {
      stopWarming()
      await update($, warmUntil, () => null)
      await update($, expiresAt, () => null)
    }

    return next(e)
  })

  on('command.run', { command: 'keep-warm' }, async $ => {
    if ((await read($, warmUntil)) !== null) {
      stopWarming()
      await update($, warmUntil, () => null)

      return { text: await voice($, 'Stopped, Keep Warm has.', 'Keep Warm stands down, my lord.') }
    }
    if ((await read($, expiresAt)) === null) {
      return { text: await voice($, 'No cache to keep warm yet, there is.', 'Report: no cache to hold yet.') }
    }
    await keepWarm($)

    return {
      text: await voice(
        $,
        'Warm, the cache I will keep. Two hours at most, or until you speak again.',
        'Report: holding the cache warm for up to 2 hours, or until your next order.',
      ),
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const end = await read($, expiresAt)
    if (e.props.hasSurvey || end === null) return next(e)

    const now = await read($, clockNow)
    const warming = (await read($, warmUntil)) !== null
    const left = end - (now === 0 ? Date.now() : now)
    const { Box, Button, Text } = $.ui.resolve(e)
    const s = SIDES[await read($, side)]

    return (
      <Box>
        <Text color={left > 60_000 ? s.done : left > 0 ? s.blocked : undefined} dimColor={left <= 0}>
          {left > 0 ? '● ' : '○ '}
          {left > 0
            ? `${say(s.name, 'Cache warm', 'Cache armed')} ${clock(left)}`
            : say(s.name, 'Cache gone cold', 'Cache cold')}
          {warming ? say(s.name, ' · kept warm', ' · held warm') : ''}{' '}
        </Text>
        <Button
          key="warm"
          label={warming ? say(s.name, 'Release', 'Stand down') : 'Keep Warm'}
          onPress={async () => {
            if ((await read($, warmUntil)) !== null) {
              stopWarming()
              await update($, warmUntil, () => null)
            } else {
              await keepWarm($)
            }
          }}
        />
      </Box>
    )
  })
}
