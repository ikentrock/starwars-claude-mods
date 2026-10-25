export type DeskTodo = {
  content: string
  status: 'pending' | 'in_progress' | 'completed'
  activeForm: string
}
export type DeskAgent = {
  id: string
  name: string
  color: string
  tools: number
  tokens: number
  isDone: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'helper-desk': { todos: Shaped<DeskTodo[]>; agents: Shaped<DeskAgent[]> }
  }
}
