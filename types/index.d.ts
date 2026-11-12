export type CrewNode = {
  id: string
  parentId?: string
  type: string
  description: string
  model?: string
  effort?: string
  tool?: string
  skills: string[]
  worktree?: string
  status: 'running' | 'done' | 'failed'
  startedAt: number
  endedAt?: number
}

declare module 'claude-code' {
  interface PluginState {
    'agent-crew': { nodes: Shaped<CrewNode[]> }
  }
}
