# Opportunity Agent

A personal agent that runs in the cloud every day. It finds scholarships, internships, remote paid work and paid programs, verifies each one on its **official page**, filters for eligibility and scams, ranks them, and sends them to Telegram. A human always makes the final decision and does the final submit.

## Phase status
| Phase | Scope | Status |
|---|---|---|
| 1 | Sources → verify → filter → rank → Telegram digest, alerts, tracker commands, kill switch, health alerts, tests | ✅ built |
| 2 | Feedback learning (basic version in Phase 1), reminders (in Phase 1), web tracker, CV upgrade | next |
| 3 | Application assistant: checklists, tailored CV, essay drafts, referee emails | later |
| 4 | Assisted form-filling with human checkpoints | later |

## How it works
```
06:00 EAT  GitHub Actions: daily finder
           sources.yaml → fetch (robots.txt, 5s/host, retries) → de-duplicate → keyword pre-filter
           → aggregator listing resolved to the OFFICIAL page → AI extraction (every fact must quote
           the page, unquoted facts are dropped) → eligibility rules → scam rules → payout route
           → 0–100 score → Supabase → instant alerts (score ≥ 80 or deadline ≤ 7 days)
07:00 EAT  daily digest with Apply / Save / Skip / Not interested buttons
hourly     instant alerts, deadline reminders (14/7/3/1 days), broken-source alerts, Sunday 19:00 summary
any time   Telegram webhook on Vercel: /saved /deadlines /tracker /status /pause /resume
```

| Path | What |
|---|---|
| `sources.yaml` | Pluggable source list. Switch sources on/off here |
| `profile.yaml` | **Private, git-ignored.** Your facts. Cloud copy is the `PROFILE_YAML_B64` secret |
| `src/sources/` | Source plugins (RSS, RemoteOK, Remotive, Himalayas, watched official pages) |
| `src/pipeline/` | dedupe, prefilter, resolve, extract, eligibility, scam, payout, rank |
| `src/jobs/` | `daily`, `digest`, `hourly`, `vault-cli` |
| `api/telegram.ts` | Vercel webhook for buttons and commands |
| `supabase/migrations/` | Database schema |
| `test/` | Tests for parsers, filters, scam rules, payout, ranking, vault and the pipeline |

## Guarantees
- **No invented facts.** Each extracted fact must be backed by a verbatim quote found on the official page. Otherwise it is dropped. A missing deadline is shown as "deadline unknown – check".
- **Partial funding is never shown as full.** "Full" means the page states that tuition *and* a living stipend are covered.
- **Truthful enrollment.** Scholarships that bar current university students are excluded. "New entrants only" items are marked for a manual check.
- **Scam rules.** Items asking for fees, PINs or upfront payment are rejected. Guaranteed acceptance, unrealistic pay, chat-only recruiters and free-mail contacts are flagged with the reason.
- **Spending cap.** AI calls stop when `AI_MONTHLY_CAP_USD` (default $10) is reached, and you get a Telegram message.
- **Kill switch.** `/pause` in Telegram stops every job.

## Commands
```
npm test            # run the test suite
npm run dry-run     # run the finder locally without Telegram or database (needs ANTHROPIC_API_KEY)
npm run vault -- put path/to/your_CV.pdf cv    # encrypt and store a document
```

Setup steps: see [docs/SETUP.md](docs/SETUP.md).
