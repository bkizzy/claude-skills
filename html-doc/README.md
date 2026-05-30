# html-doc skill

Makes Claude produce documents as a **single self-contained HTML file with a click-to-copy button** by default, unless another format is requested or required.

## Two ways this works

### 1. The skill (self-contained, no setup)
`SKILL.md` holds the full rules + HTML template. It auto-triggers when Claude judges a document is being created (based on the `description:` field). Nothing else to install — it works on its own. The skill is the right home for the template so it only loads into context when you're actually making a document, not every session.

The trade-off: skill triggering is a judgment call, so it won't fire on *literally every* document with 100% certainty.

### 2. The always-on global rule (guarantees the default)
To make HTML the default in **every session without depending on the skill triggering**, add the short rule below to an always-loaded instructions file. It's cheap (one paragraph) and it points at this skill for the template, so the bulky template still stays out of always-loaded context.

**Where to add it** — pick one:

| File | Scope | When |
|------|-------|------|
| `~/.claude/CLAUDE.md` | All projects on this machine | You want HTML-default everywhere |
| `<project>/.claude/CLAUDE.md` or `<project>/CLAUDE.md` | This project only | You want it scoped to one repo |

**Paste this into the chosen file:**

```markdown
## Document output
When creating a document for the user (report, write-up, summary, notes, memo, deliverable)
and no format is specified, default to a single self-contained `.html` file (inline CSS/JS,
no external dependencies) with a click-to-copy button on the content. Use the `html-doc`
skill for the template. Use another format (.md, .docx, .pdf, .xlsx, .pptx) only if the
user asks or the task requires it.
```

## Recommendation
Add the global rule **and** keep the skill. The rule guarantees the behavior every session; the skill supplies the template on demand. If you skip the global rule, the skill still works on its own — it's fully self-contained.
