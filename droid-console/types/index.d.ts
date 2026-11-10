/** `auto` follows Herdr's layout: the Jedi training remote or the Sith orb. */
export type Personality = 'auto' | 'r2d2' | 'c3po' | 'bb8' | 'imperial'

declare module 'claude-code' {
  interface PluginState {
    'droid-console': {
      personality: { shape: string; value: Personality }
      side: { shape: string; value: 'jedi' | 'sith' }
    }
  }
}
