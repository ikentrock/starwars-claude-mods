export type InventoryTodo = { content: string; status: string; activeForm: string }
export type InventoryFile = { path: string; kind: 'read' | 'created' | 'edited' }

declare module 'claude-code' {
  interface PluginState {
    'chat-inventory': {
      goal: Shaped<string>
      todos: Shaped<InventoryTodo[]>
      connectors: Shaped<Record<string, number>>
      skills: Shaped<Record<string, number>>
      files: Shaped<InventoryFile[]>
    }
  }
}
