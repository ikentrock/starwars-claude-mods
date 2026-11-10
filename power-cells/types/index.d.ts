export type PowerCell = { kind: string; percentLeft: number; detail: string }
export type WeekWindow = { windowEnd: number; baseline: number; percentUsed: number }

declare module 'claude-code' {
  interface PluginState {
    'power-cells': {
      cells: Shaped<PowerCell[]>
      isHidden: Shaped<boolean>
      week: Shaped<WeekWindow | null>
      side: Shaped<'jedi' | 'sith'>
    }
  }
}
