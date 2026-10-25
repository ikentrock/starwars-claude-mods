export type HandoffText = string

declare module 'claude-code' {
  interface PluginState {
    handoff: { text: Shaped<string>; why: Shaped<string>; isOffered: Shaped<boolean> }
  }
}
