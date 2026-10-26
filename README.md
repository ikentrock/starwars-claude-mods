# starwars-claude-mods

Nine local Claude Code mods (UI and hook plugins) with a light Star Wars flavor.

| Mod | What it does |
|---|---|
| brain-dump | Intercepts long, unstructured prompts, asks clarifying questions, rewrites them into a structured prompt. `!raw ` prefix skips it. |
| helper-desk | Progress bar from the to-do list, plus a side panel for sub-agents (`/helper-desk`). |
| cache-clock | Prompt-cache countdown, Keep Warm button, `/keep-warm`. |
| handoff | Generates a handoff prompt at 250k tokens, on cold cache, or on `/handoff`. |
| reflect | Offers to save rules/preferences to memory, CLAUDE.md, or a second brain. |
| chat-inventory | Zero-token "In This Chat" panel (`/inventory`). |
| switchboard | `/mods` panel to toggle mods and hide panels. |
| power-cells | Gauges above the prompt for context, the 5-hour limit, and a weekly pacing plan: a daily ration, work-day weighting, over/under-plan warnings. `/power plan` shows the week. |
| droid-console | Restyles the whole UI as a droid console: personality palettes, transmission headers, droid spinner words, status band. `/droid` switches personality. |

**Status:** experimental. They pass `claude plugin validate` and `tsc`, but have not been tested at runtime. Expect rough edges.

## Install

Add the marketplace once, then install the mods you want (user scope makes them load in every session):

```sh
claude plugin marketplace add ikentrock/starwars-claude-mods
claude plugin install brain-dump@starwars-claude-mods --scope user
claude plugin install cache-clock@starwars-claude-mods --scope user
claude plugin install chat-inventory@starwars-claude-mods --scope user
claude plugin install droid-console@starwars-claude-mods --scope user
claude plugin install handoff@starwars-claude-mods --scope user
claude plugin install helper-desk@starwars-claude-mods --scope user
claude plugin install power-cells@starwars-claude-mods --scope user
claude plugin install reflect@starwars-claude-mods --scope user
claude plugin install switchboard@starwars-claude-mods --scope user
```

Or one at a time from a session prompt:

```
/plugin install <mod> --marketplace ikentrock/starwars-claude-mods
```

Update later with `claude plugin marketplace update starwars-claude-mods`.
