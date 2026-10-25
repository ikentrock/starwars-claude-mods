export type CacheClockTick = number

declare module 'claude-code' {
  interface PluginState {
    'cache-clock': {
      expiresAt: Shaped<number | null>
      warmUntil: Shaped<number | null>
      now: Shaped<number>
    }
  }
}
