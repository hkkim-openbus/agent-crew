# agent-crew

A Claude Code mod that draws the agents behind each prompt as a live flowchart pane. Every prompt you send becomes one graph: the main session at the top, subagents, workflows and arena candidates fanning out below it. Each card shows a status dot (blinking while running, green when done, red on failure), the elapsed time, the tool in use, the model and effort, the worktree the agent runs in, and the skills or playbooks it used. Task titles are shortened to a few words by haiku.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install agent-crew --marketplace hkkim-openbus/agent-crew
```

From a shell:

```
claude plugin install agent-crew --marketplace hkkim-openbus/agent-crew
```

In the desktop app: click + next to the prompt box, then Plugins, Add marketplace with `hkkim-openbus/agent-crew`, then Add plugin.

## Use

Run `/crew` to open the pane. It also opens by itself when a subagent starts.
