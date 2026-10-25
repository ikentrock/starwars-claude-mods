export type PowerCell = { label: string; percentLeft: number; detail: string }

declare module 'claude-code' {
  interface PluginState {
    'power-cells': { cells: Shaped<PowerCell[]>; isHidden: Shaped<boolean> }
  }
}
