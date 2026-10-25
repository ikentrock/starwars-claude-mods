export type Personality = 'r2d2' | 'c3po' | 'bb8' | 'imperial'

declare module 'claude-code' {
  interface PluginState {
    'droid-console': { personality: { shape: string; value: Personality } }
  }
}
