# Claude skills

Custom [Claude Code skills](https://docs.claude.com/en/docs/claude-code/skills) I've built. Each lives in its own folder with a `SKILL.md` (what Claude reads) and a `README.md` (what humans read).

## Skills

| Skill | What it does |
| --- | --- |
| [`aaarrr/`](./aaarrr/) | 🏴‍☠️ **App-store metrics, for pirates** — daily AAARRR report. Claude drives the Claude-in-Chrome extension to read App Store Connect + Play Console dashboards you're already signed into. No API keys. |
| [`html-doc/`](./html-doc/) | Makes HTML the default document format — a single self-contained file with a click-to-copy button. Falls back to .md/.docx/.pdf/.xlsx/.pptx only when requested. |
| [`rfp-evaluator/`](./rfp-evaluator/) | Evaluates an RFP — reads the document (incl. charts/plans), scores it with a rubric + red-flag gates, and renders a role-tailored bid/no-bid HTML report. Document-grounded, no web search. |

## Install

Skills are discovered from `~/.claude/skills/`. To install one of these in your own Claude Code:

```bash
# Clone the repo somewhere (anywhere — pick your skills workspace)
git clone <repo-url> ~/code/claude-skills

# Symlink each skill you want into ~/.claude/skills/
ln -s ~/code/claude-skills/aaarrr ~/.claude/skills/aaarrr
```

Restart Claude Code (or `/clear`). Then invoke with `/<skill-name>` — e.g. `/aaarrr`.

## Authoring notes

- `SKILL.md` is the instructions Claude reads at runtime. Frontmatter must include `name` (matches folder name = slash command) and `description` (drives auto-triggering).
- `scripts/`, `references/`, `assets/` are loaded on demand by the SKILL.md.
- Per-skill `README.md` documents the human-facing contract: what it does, how to use it, known gaps, where the rot points are.
