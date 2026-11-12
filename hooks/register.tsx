import { atom, read, update } from 'claude-code'
import type { Register, RenderChildren } from 'claude-code'

import type { CrewNode } from '../types'

const PANE = 'agent-crew'
const TASK = 'task' // a root node: one per prompt the person sent, played by the main session
const WORKFLOW = 'workflow'
// Bump the tag when CrewNode's meaning changes: it drops what an older version stored.
const nodes = atom({ plugin: 'agent-crew', key: 'nodes' } as const, [], { shape: 'nodes-2' })

// Each agent type gets a color so cards of the same kind read as a group.
const PALETTE = ['#ff7eb6', '#78a9ff', '#42be65', '#f1c21b', '#be95ff', '#3ddbd9', '#ee5396']
// Status dots: a running dot blinks between the two glyphs.
const DOT = { done: '#42be65', failed: '#fa4d56' } as const

const hash = (s: string) => {
  let h = 0
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h
}
const looksOf = (type: string) => {
  if (type === TASK) return { color: '#d97757' } // Claude orange: the main session alone
  if (type === WORKFLOW) return { color: '#8d8d8d' }
  return { color: PALETTE[hash(type) % PALETTE.length]! }
}

// Flowchart geometry, in terminal columns.
const CARD = 24
const GAP = 2
const MAX_KIDS = 24 // ponytail: bigger fan-outs show "+N more"; page them if that gets common
const MAX_NODES = 150 // oldest tasks fall off first

const patch = (id: string | undefined, fn: (n: CrewNode) => CrewNode) => (list: CrewNode[]) =>
  list.map(n => (n.id === id ? fn(n) : n))
// Keep the newest nodes, then drop any whose parent fell off so counts match the chart.
const trim = (list: CrewNode[]) => {
  const kept = list.slice(-MAX_NODES)
  const ids = new Set(kept.map(n => n.id))
  return kept.filter(n => !n.parentId || ids.has(n.parentId))
}
// A path under a worktrees folder names the worktree; anything else is the main checkout.
const worktreeOf = (cwd?: string) => cwd?.match(/worktrees?\/([^/]+)/)?.[1]
// ponytail: Agent calls with isolation:'worktree' are matched to their spawn by description; same-description parallel spawns can mix up.
const isolated = new Set<string>()

const shortModel = (id: string) => id.replace(/^claude-/, '').replace(/-\d{8}$/, '').replace(/\[.*\]$/, '')

const lastTask =(list: CrewNode[]) => list.findLast(n => n.type === TASK)?.id

// The connector row under a parent: ┌──┬──┴──┬──┐ with the junction at the parent's center.
export const fanLine = (centers: number[], width: number) => {
  const p = Math.floor(width / 2)
  const lo = Math.min(centers[0]!, p)
  const hi = Math.max(centers[centers.length - 1]!, p)
  const row: string[] = Array.from({ length: width }, (_, i) => (i > lo && i < hi ? '─' : ' '))
  for (const c of centers) row[c] = c === lo ? '┌' : c === hi ? '┐' : '┬'
  row[p] = centers.includes(p) ? (p === lo ? '├' : p === hi ? '┤' : '┼') : p === lo ? '└' : p === hi ? '┘' : '┴'
  return row.join('')
}

const BLINK_MS = 450
let anyRunning = false // set by each render; the ticker redraws only while an agent is working

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'crew', description: 'Open the agent crew flowchart pane' })
    $.clock.every(BLINK_MS, () => {
      if (anyRunning) $.ui.invalidate('ui.render')
    })
    return next(e)
  })

  on('command.run', { command: 'crew' }, async $ => {
    await $.ui.open({ id: PANE, title: 'Agent crew' })
    return { text: 'Agent crew pane opened.' }
  })

  // Every prompt starts a new task chart below the earlier ones, which stay as history.
  on('prompt.submit', async ($, e, next) => {
    // Only the person's own prompts start a task; hand-backs and notifications join the running one.
    const byPerson = ['composer', 'bridge', 'sdk'].includes(e.origin.kind)
    const text = (e.command ? e.command.args : e.text).trim()
    if (byPerson && text && (e.command || !text.startsWith('/'))) {
      const task: CrewNode = { id: `task:${Date.now()}`, type: TASK, description: text, skills: e.command ? [e.command.name] : [], status: 'running', startedAt: Date.now(), worktree: worktreeOf(await $.session.cwd()) }
      await update($, nodes, list => trim([
        ...list.map(n => (n.type === TASK && n.status === 'running' ? { ...n, status: 'done' as const } : n)),
        task,
      ]))
      // Show a short task name instead of the full prompt; the prompt stays until haiku answers or fails.
      void $.model.complete({
        model: 'haiku',
        prompt: `다음 요청을 2~5단어 작업명으로만 답해. 요청과 같은 언어, 따옴표·마침표 없이. 예: 인증 작업\n\n${text.slice(0, 2000)}`,
      }).then(r => {
        const name = r.isAnswered ? (r.text.trim().split('\n')[0] ?? '').slice(0, 40) : ''
        if (name) return update($, nodes, patch(task.id, n => ({ ...n, description: name })))
      }).catch(() => {})
    }
    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const res = await next(e)
    if (!res.agentId) return res
    const agentId = res.agentId
    const iso = isolated.delete(e.description)
    await update($, nodes, list => {
      let parentId = e.parentAgentId ?? lastTask(list)
      const worktree = worktreeOf(e.cwd) ?? (iso ? 'new worktree' : list.find(n => n.id === (e.parentAgentId ?? lastTask(list)))?.worktree)
      const add: CrewNode[] = []
      if (e.workflow?.runId) {
        const wf = `wf:${e.workflow.runId}`
        if (!list.some(n => n.id === wf)) {
          add.push({ id: wf, parentId, type: WORKFLOW, description: e.workflow.runId, skills: [], status: 'running', startedAt: Date.now() })
        }
        parentId = wf
      }
      add.push({ id: agentId, parentId, type: e.subagentType || 'agent', description: e.description, model: res.model, skills: [], status: 'running', startedAt: Date.now(), worktree })
      return trim([...list.filter(n => n.id !== agentId), ...add])
    })
    void $.ui.open({ id: PANE, title: 'Agent crew' })
    return res
  })

  // Skills come from the Skill tool, a typed /command (prompt.submit), or a Read of a SKILL.md or playbook.
  on('tool.call', async ($, e, next) => {
    // pstack-style skills and playbooks run by reading their file, so a Read of one counts as using it.
    const read = e.tool === 'Read' ? e.file_path.match(/skills\/([^/]+)\/(?:SKILL\.md$|playbooks\/([^/]+)\.md$)/) : null
    const skill = e.tool === 'Skill' ? e.skill : read ? (read[2] ? `${read[1]}/${read[2]}` : read[1]) : undefined
    const at = (list: CrewNode[]) => e.agentId ?? lastTask(list)
    await update($, nodes, list => patch(at(list), n => ({
      ...n,
      tool: e.tool,
      skills: skill && !n.skills.includes(skill) ? [...n.skills, skill].slice(-4) : n.skills,
    }))(list))
    if (e.tool === 'Agent' && e.isolation === 'worktree') isolated.add(e.description)
    const res = await next(e)
    const moved = !e.agentId && (e.tool === 'EnterWorktree' || e.tool === 'ExitWorktree')
    const worktree = moved ? worktreeOf(await $.session.cwd()) : undefined
    await update($, nodes, list => patch(at(list), n => ({
      ...(n.tool === e.tool ? { ...n, tool: undefined } : n),
      ...(moved ? { worktree } : {}),
    }))(list))
    return res
  })

  // Each model request names its model and effort.
  // turn.step streams: the hook is a generator that passes every chunk through untouched.
  on('turn.step', async function* ($, e, next) {
    const effort = e.effort === undefined ? undefined : String(e.effort)
    void update($, nodes, list => patch(e.agentId ?? lastTask(list), x =>
      x.model === e.model && x.effort === effort ? x : { ...x, model: e.model, effort })(list))
    return yield* next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const status = e.reason === 'answer' ? 'done' : 'failed'
    await update($, nodes, list => patch(e.agentId ?? lastTask(list), n => ({ ...n, status, tool: undefined, endedAt: Date.now() }))(list))
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const list = await read($, nodes)
    const live = new Map((await $.agent.list()).map(a => [a.id, a.status]))
    const byParent = new Map<string | undefined, CrewNode[]>()
    for (const n of list) byParent.set(n.parentId, [...(byParent.get(n.parentId) ?? []), n])
    const kidsOf = (id: string) => byParent.get(id) ?? []
    const widths = new Map<string, number>()

    const statusOf = (n: CrewNode): CrewNode['status'] => {
      if (n.type === WORKFLOW) {
        const s = kidsOf(n.id).map(statusOf)
        return s.includes('running') ? 'running' : s.includes('failed') ? 'failed' : 'done'
      }
      const s = live.get(n.id)
      if (s === 'completed' || s === 'idle') return 'done'
      if (s === 'failed' || s === 'killed') return 'failed'
      return s ? 'running' : n.status
    }

    // Children wrap onto a new row once the next one would pass the pane's width.
    const avail = Math.max(CARD, (e.viewport?.columns ?? 80) - 2)
    const rowsOf = (n: CrewNode): CrewNode[][] => {
      const rows: CrewNode[][] = []
      let used = avail + 1
      for (const k of kidsOf(n.id).slice(0, MAX_KIDS)) {
        const w = widthOf(k)
        if (used + GAP + w > avail) rows.push([]), (used = -GAP)
        rows[rows.length - 1]!.push(k)
        used += GAP + w
      }
      return rows
    }

    const widthOf = (n: CrewNode): number => {
      const hit = widths.get(n.id)
      if (hit !== undefined) return hit
      const rows = rowsOf(n)
      const w = Math.max(CARD, ...rows.map(r => r.reduce((s, k) => s + widthOf(k), 0) + GAP * (r.length - 1)))
      widths.set(n.id, w)
      return w
    }

    const card = (n: CrewNode) => {
      const st = statusOf(n)
      const { color } = looksOf(n.type)
      const secs = Math.round(((n.endedAt ?? Date.now()) - n.startedAt) / 1000)
      const title = n.type === TASK ? 'main' : n.type
      const lit = Math.floor(Date.now() / BLINK_MS) % 2 === 0
      const dot = st === 'running' ? <Text color={color}>{lit ? "●" : "○"}</Text> : <Text color={DOT[st]}>●</Text>
      const doing = st === 'running' && n.tool ? ` ⚙ ${n.tool}` : ''
      return (
        <Box width={CARD} flexDirection="column" borderStyle="round" borderColor={color} borderDimColor={st === 'done'} paddingX={1}>
            <Text wrap="truncate">
              {dot}
              <Text bold color={color}>{` ${title}`}</Text>
              <Text dimColor>{` ${secs}s${doing}`}</Text>
            </Text>
            <Text dimColor={st === 'done'} wrap="truncate">{n.type === TASK ? 'main session' : n.description}</Text>
            {n.model && <Text color="#78a9ff" wrap="truncate">{`◆ ${shortModel(n.model)}${n.effort ? ` · ${n.effort}` : ''}`}</Text>}
            {n.worktree && <Text color="#42be65" wrap="truncate">{`⎇ ${n.worktree}`}</Text>}
            {n.skills.length > 0 && <Text color="#f1c21b" wrap="truncate">{`✦ ${n.skills.join(', ')}`}</Text>}
        </Box>
      )
    }

    const flow = (n: CrewNode): RenderChildren => {
      const all = kidsOf(n.id)
      const rows = rowsOf(n)
      const width = widthOf(n)
      const shown = rows.reduce((s, r) => s + r.length, 0)
      return (
        <Box flexDirection="column" alignItems="center" width={width}>
          {card(n)}
          {rows.map((row, i) => {
            const rowWidth = row.reduce((s, k) => s + widthOf(k), 0) + GAP * (row.length - 1)
            let x = 0
            const centers = row.map(k => {
              const c = x + Math.floor(widthOf(k) / 2)
              x += widthOf(k) + GAP
              return c
            })
            return (
              <Box key={row[0]!.id} flexDirection="column" alignItems="center" width={width}>
                <Text dimColor>{i === 0 ? '│' : '┆'}</Text>
                {row.length > 1 && <Text dimColor>{fanLine(centers, rowWidth)}</Text>}
                <Box flexDirection="row" gap={GAP} alignItems="flex-start">
                  {row.map(k => (
                    <Box key={k.id} flexDirection="column" alignItems="center" width={widthOf(k)}>
                      <Text dimColor>▼</Text>
                      {flow(k)}
                    </Box>
                  ))}
                </Box>
              </Box>
            )
          })}
          {all.length > shown && <Text dimColor>{`+${all.length - shown} more`}</Text>}
        </Box>
      )
    }

    const tasks = list.filter(n => n.type === TASK)
    if (!tasks.length) return <Text dimColor>No task yet. Send a prompt to start a chart.</Text>
    const agents = list.filter(n => n.type !== TASK && n.type !== WORKFLOW)
    const running = agents.filter(n => statusOf(n) === 'running').length
    anyRunning = list.some(n => statusOf(n) === 'running')
    return (
      <Box flexDirection="column" alignItems="center">
        <Text dimColor>{`tasks ${tasks.length} · agents ${agents.length} · running ${running}`}</Text>
        {tasks.map((t, i) => (
          <Box key={t.id} flexDirection="column" alignItems="center" marginTop={1}>
            <Box width={Math.max(CARD, Math.min(widthOf(t), 60))} borderStyle="bold" borderColor={t.status === 'running' ? '#78a9ff' : '#525252'} paddingX={1}>
              <Text bold={t.status === 'running'} dimColor={t.status !== 'running'} wrap="truncate">{`${i + 1}. ${t.description}`}</Text>
            </Box>
            <Text dimColor>▼</Text>
            {flow(t)}
          </Box>
        ))}
      </Box>
    )
  })
}
