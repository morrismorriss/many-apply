# Vault format

Everything Many Apply knows is in these files. You can read and edit all of them by hand.

## grants/&lt;folder&gt;/grant.md

```yaml
---
title: Project Grant 2027
client: me            # who this application is for: me, or a client's slug
funder: pittsburgh-foundation
url: https://...
type: grant            # grant | residency | fellowship | award | commission
status: researching    # researching | planning | drafting | submitted | awarded | declined | withdrawn
starred: false
amount_requested: 5000
amount_awarded:
max_award: 5000        # the funder's cap, if any
currency: USD
deadline: 2027-02-01
deadline_type: fixed   # fixed | rolling | loi
project: Prodigy
location: Pittsburgh, PA
tags: [theater, individual-artist]
submitted_on:
decision_expected:
decision_on:
todoist_task_ids: []
reports:               # added by hand after an award, often from a later email
  - {title: Interim report, due: 2027-09-01, submitted_on:, todoist_task_id:, notes: From award email}
work_samples:          # in the order they were sent; paths relative to samples/
  - me/river-suite.md
created: 2026-11-22
updated: 2026-11-22
status_history:
  - {status: researching, date: 2026-11-22}
---

## Eligibility
...

## Questions
### 1. Project description (500 words)
Draft: drafts/01-project-description.md

### 2. Short answer (1,000 characters)
Draft: drafts/02-short-answer.md

## Notes
...
```

- A question is a `###` heading under `## Questions`. A limit in brackets at the end, in words or characters, drives the meter. A `Draft:` line points at the draft file.
- Any other frontmatter keys (for example, extra columns kept from an import) are preserved and shown in the drawer.
- When status changes to `submitted`, `awarded` or `declined`, the app fills in `submitted_on` or `decision_on` with today's date if they're empty.

## grants/&lt;folder&gt;/budget.csv

Columns: `category, type, line_item, quantity, rate, amount, notes`.

- `type` is `Expense`, `Income` or `In-kind`.
- If `quantity` and `rate` are both set, the line's amount is quantity × rate. Otherwise `amount` is used.
- The gap is total expenses minus total income. In-kind lines are shown but don't count toward the gap.

Budget templates in `library/budgets/` use the same columns.

## clients/&lt;slug&gt;.md

Frontmatter: `name, type, contact_person, contact_email, website, mission, fiscal_year_start, annual_budget, fiscal_sponsor, color, todoist_project_id, budget_template`. The body is free notes. `me.md` is created automatically.

## funders/&lt;slug&gt;.md

Frontmatter: `name, website, funder_type, contacts, notes`. `funder_type` is one of foundation, government, arts council, corporate, residency program.

## library/&lt;folder&gt;/&lt;name&gt;.md

Frontmatter: `title, tags, word_count` (computed on save), `used_in` (a list of grant folders). The top-level folder is either `shared` or a client's slug. The Library never suggests one client's writing for another client's application.

## samples/&lt;folder&gt;/&lt;name&gt;.md

One file per work sample. The media file it describes sits next to it (`river-suite.md` and `river-suite.jpg`). A sample can be a link only, with no file.

```yaml
---
title: River Suite
kind: image          # image | video | audio | document | link (worked out from the file or link if missing)
file: river-suite.jpg
url: https://vimeo.com/...
year: 2025
medium: Oil on linen
dimensions: 24 x 36 in.
duration:            # running time, for video and audio
credits: "Photo: Jane Doe"
tags: [painting]
used_in: [2027-02-pittsburgh-foundation-project-grant]
---
A sentence or two about the work, as you'd write it on an application.
```

The top-level folder is `shared` or a client's slug, like the Library: one client's samples are never offered for another client's application. Adding a sample to an application records it in the grant's `work_samples` and the sample's `used_in`.

## .manyapply/

| Path | What it is |
| --- | --- |
| `settings.json` | Theme, budget categories, Todoist options (not the token), saved import mappings, extension pairing code. |
| `calendar.ics` | A live calendar of every date, if turned on in Settings. |
| `imports/*.json` | One log per import, used for undo. |
| `trash/` | Deleted grants, library items and undone imports. Nothing is hard-deleted. |
