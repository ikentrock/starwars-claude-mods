export type SwitchMod = { name: string; description: string; root: string }

declare module 'claude-code' {
  interface PluginState {
    switchboard: {
      mods: Shaped<SwitchMod[]>
      off: Shaped<string[]>
      panes: Shaped<{ id: string; title: string }[]>
    }
  }
}
