import type { EngineInterface, Register } from 'claude-code'

const MODEL = 'haiku'
const HINT =
  /\b(always|never|don'?t|do not|stop (doing|using)|from now on|going forward|make sure|i prefer|i like (it )?when|i want you to|must|should always|should never|rule)\b/i

const CHOICES = ['Built-in memory', 'CLAUDE.md', 'Second brain', 'Not now'] as const

const EXTRACT = (text: string) => `A user sent this message to a coding assistant:

<message>
${text}
</message>

Did the user state a hard rule or lasting preference for how the assistant should work (not a one-off instruction for this task)? If yes, output the rule as one short imperative sentence. If not, output exactly: NONE`

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'rule'

async function append($: EngineInterface, path: string, line: string) {
  const dir = path.slice(0, path.lastIndexOf('/'))
  await $.process.run(['mkdir', '-p', dir])
  const before = (await $.fs.exists(path)) ? await $.fs.read(path) : ''
  const gap = before === '' || before.endsWith('\n') ? '' : '\n'
  await $.fs.write(path, `${before}${gap}${line}\n`)
}

export const register: Register = (on, options) => {
  let pending: string | undefined

  on('prompt.submit', async ($, e, next) => {
    if (!e.command && !e.isMeta && HINT.test(e.text)) {
      const found = await $.model.complete({
        model: MODEL,
        prompt: EXTRACT(e.text.slice(0, 4000)),
        maxTokens: 120,
        effort: 'low',
      })
      const rule = found.isAnswered ? found.text.trim() : 'NONE'
      pending = rule === 'NONE' || rule === '' ? undefined : rule
    }

    return next(e)
  })

  // Ask once the turn is over so the popup never fights a permission dialog.
  on('turn.complete', async ($, e, next) => {
    const rule = pending
    if (rule === undefined || e.agentId !== undefined) return next(e)
    pending = undefined

    const choice = await $.ui.ask(`Reflect: a rule, I sense. Save it? "${rule}"`, {
      options: [...CHOICES],
      header: 'Reflect',
    })
    const home = (await $.env.get('HOME')) ?? ''
    const cwd = await $.session.cwd()

    if (choice === 'Built-in memory') {
      const dir = `${home}/.claude/projects/${cwd.replace(/[/.]/g, '-')}/memory`
      const name = `feedback-${slug(rule)}`
      await $.process.run(['mkdir', '-p', dir])
      await $.fs.write(
        `${dir}/${name}.md`,
        `---\nname: ${name}\ndescription: ${rule.replace(/\n/g, ' ')}\nmetadata:\n  type: feedback\n---\n\n${rule}\n\n**Why:** the user stated it as a standing rule.\n**How to apply:** follow it in every session.\n`,
      )
      await append($, `${dir}/MEMORY.md`, `- [${rule.slice(0, 60)}](${name}.md) — user rule`)
      $.ui.toast('Reflect: saved to built-in memory.')
    } else if (choice === 'CLAUDE.md') {
      await append($, `${cwd}/CLAUDE.md`, `- ${rule}`)
      $.ui.toast('Reflect: added to CLAUDE.md.')
    } else if (choice === 'Second brain') {
      const file = String(options.secondBrainFile ?? '~/second-brain/rules.md').replace(/^~/, home)
      await append($, file, `- ${rule}`)
      $.ui.toast(`Reflect: saved to ${file}.`)
    }

    return next(e)
  })
}
