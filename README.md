# starwars-claude-mods

Nine local Claude Code mods (UI and hook plugins) with a Star Wars flavor, Jedi or Sith. They work in any terminal, and inside [Herdr](https://herdr.dev) with the [herdr-star-wars](https://github.com/ikentrock/herdr-star-wars) layouts they follow the Jedi Archives or Sith Citadel layout, Claude Code's theme included.

| Mod | What it does |
|---|---|
| brain-dump | Intercepts long, unstructured prompts, asks clarifying questions, rewrites them into a structured prompt. `!raw ` prefix skips it. |
| helper-desk | Progress saber from the to-do list, plus a side panel of sub-agents as padawans or apprentices (`/helper-desk`). |
| cache-clock | Prompt-cache countdown, Keep Warm button, `/keep-warm`. |
| handoff | Generates a handoff prompt at 250k tokens, on cold cache, or on `/handoff`. |
| reflect | Offers to save rules/preferences to memory, CLAUDE.md, or a second brain. |
| chat-inventory | Zero-token "In This Chat" panel (`/inventory`). |
| switchboard | `/mods` panel to toggle mods and hide panels. |
| power-cells | Gauges above the prompt for context, the 5-hour limit, and a weekly pacing plan: a daily ration, work-day weighting, over/under-plan warnings. `/power plan` shows the week. |
| droid-console | Restyles the whole UI for your side: Claude Code's theme in Herdr, the droid's voice, the side's colors, spinner words and a status band. `/droid` switches to R2-D2, C-3PO, BB-8 or IG-11, and `/droid auto` goes back to the side's droid. `/side` picks the side for every mod. |

## Jedi or Sith, with or without Herdr

Every mod speaks for one side of the Force. They work on their own in any terminal. With [Herdr](https://herdr.dev) and the [herdr-star-wars](https://github.com/ikentrock/herdr-star-wars) layouts, they also match the Jedi Archives or Sith Citadel layout around them.

| | Jedi | Sith |
|---|---|---|
| You are | MASTER | MY LORD |
| Sub-agents are | padawans | apprentices |
| Agent states | in training, seeks your counsel, trial complete, at rest | executing orders, awaits your command, mission complete, dormant |
| The droid | training remote, old-master word order | interrogator orb, "Report: …" |
| Colors | blue blade, green done, gold when you're needed | red blade, white done, amber when you're needed |

Gauges and progress bars are drawn as sabers (`▬━━━━──`), and headings use spaced capitals, as in Herdr.

**Picking the side.** The first of these that applies wins:

1. `STARWARS_SIDE=jedi` or `sith` in the environment.
2. `/side jedi` or `/side sith` (from droid-console). Every mod follows it within a few seconds. `/side auto` goes back to the steps below.
3. **Herdr's layout.** Herdr writes the layout it shows to `~/.config/herdr-app/shared.json` (or `$HERDR_APP_HOME/shared.json`), and the mods read it every 3 seconds. **Join the Dark Side** / **Return to the Light** in Herdr's top bar switches them too.
4. **Without Herdr, Claude Code's theme.** A light theme gives Jedi, which reads well on a light background. Anything else gives Sith.

**Colors are ANSI names, not hex**, so they come from the terminal's own palette and stay readable in any terminal. In Herdr that palette is the layout's theme, whose 16 terminal colors all keep 4.5:1 contrast on the cream Jedi background and the black Sith one.

**Claude Code's own theme follows Herdr.** Inside Herdr, droid-console sets Claude Code's theme to `light-ansi` (Jedi Archives) or `dark-ansi` (Sith Citadel). Those take their colors from the terminal, so the whole UI wears the layout's palette, and they change again when you switch layouts. The theme follows Herdr's background even if `/side` picked the other side. Your own theme is kept and comes back the next time a session starts outside Herdr. Outside Herdr the theme is never touched. It's set only at start and on a switch, so a theme you pick by hand in `/config` stays until the next switch. Turn it off with droid-console's **Match Claude Code's theme to Herdr** option in `/config`.

**Status:** experimental. They pass `claude plugin validate` and `tsc`, and droid-console has `claude plugin test` coverage for picking the side and matching the theme. Picking the side and the theme switch were tried in live sessions, in Herdr and outside it. The other mods' bands and panels have not been tried live. Expect rough edges.

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

## Developing

Each mod installs on its own, so each carries a copy of `shared/side.ts` (the side's words and colors, and how it's detected) as `hooks/side.ts`. Edit `shared/side.ts`, then run `scripts/sync-side.sh`.
