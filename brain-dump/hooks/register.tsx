import type { Register } from 'claude-code'

const MIN_CHARS = 500
const MAX_QUESTIONS = 4
const MODEL = 'haiku'

const BULLET = /^\s*([-*•]|\d+[.)]|#{1,4})\s/
const STRUCTURED = /^#{1,3}\s*(task|why|guardrails|done)\b/im

// A long wall of text with few bullets, headings or numbered lines.
const isBrainDump = (text: string) => {
  if (text.length < MIN_CHARS || STRUCTURED.test(text)) return false
  const lines = text.split('\n').filter(line => line.trim() !== '')
  const bullets = lines.filter(line => BULLET.test(line)).length

  return bullets < 3 && bullets / lines.length < 0.4
}

const QUESTIONS = (dump: string) => `A user typed this unstructured brain dump as a prompt for a coding assistant:

<dump>
${dump}
</dump>

Ask at most ${MAX_QUESTIONS} short clarifying questions that would most improve a prompt built from it. Cover whichever of these are unclear: the concrete task, why it matters, guardrails (what must not change), and what "done" looks like. Skip anything the dump already answers.

Output one question per line in exactly this form, nothing else:
question | suggested answer A | suggested answer B`

const REWRITE = (dump: string, answers: string) => `Rewrite this brain dump into a clear, structured prompt for a coding assistant.

<dump>
${dump}
</dump>

<clarifications>
${answers || '(none given)'}
</clarifications>

Output only the prompt, in markdown, with exactly these sections:
## Task
## Why
## Guardrails
## What done looks like

Keep every concrete detail, name and constraint from the dump. Do not invent requirements; write "Not specified" where nothing was said.`

export const register: Register = on => {
  on('prompt.submit', async ($, e, next) => {
    if (e.command || e.isMeta) return next(e)
    if (e.text.startsWith('!raw ')) return next({ ...e, text: e.text.slice(5) })
    if (!isBrainDump(e.text)) return next(e)

    $.ui.toast('Brain Dump: a cluttered mind, this is. Sorting it, I am…')

    const asked = await $.model.complete({
      model: MODEL,
      prompt: QUESTIONS(e.text),
      maxTokens: 600,
      effort: 'low',
    })
    if (!asked.isAnswered) return next(e)

    const questions = asked.text
      .split('\n')
      .map(line => line.split('|').map(part => part.trim()))
      .filter(parts => parts[0] && parts[0].endsWith('?'))
      .slice(0, MAX_QUESTIONS)

    const answers: string[] = []
    for (const [question = '', ...options] of questions) {
      const answer = await $.ui.ask(question, {
        options: options.filter(Boolean).slice(0, 3),
        header: 'Brain Dump',
      })
      answers.push(`Q: ${question}\nA: ${answer}`)
    }

    const rewritten = await $.model.complete({
      model: MODEL,
      prompt: REWRITE(e.text, answers.join('\n\n')),
      maxTokens: 2000,
    })
    if (!rewritten.isAnswered) return next(e)

    await $.prompt.fill({ text: rewritten.text.trim(), mode: 'replace' })

    return {
      drop: 'Brain Dump: your thoughts are sorted. The structured prompt is in your prompt box; edit it, then press Enter. (Prefix a prompt with "!raw " to skip Brain Dump.)',
    }
  })
}
