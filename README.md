# Opportunity Agent

A personal agent that runs in the cloud every day. It finds scholarships, internships, remote paid work, paid programmes and hackathons. Each one is checked on its **official page**, filtered for eligibility and scams, ranked, and sent to Telegram. It also prepares application packs. A human always makes the final decision and does the final submit.

Everything runs on free tiers ($0/month): GitHub Actions (public repo), Supabase, Vercel Hobby and Telegram. No AI model is used unless you approve a budget.

## Phase status
| Phase | Scope | Status |
|---|---|---|
| 1 | Sources → verify → filter → rank → Telegram digest, alerts, kill switch, source-health alerts | ✅ live |
| 2 | Learning from your buttons, deadline reminders, web tracker (`/web`), CV generator, academic-referee reminder | ✅ live |
| 3 | Application assistant: checklist, tailored CV, letter outline, referee email drafts, questions when info is missing, encrypted document vault (`/docs`) | ✅ live |
| 4 | Assisted form-filling with human checkpoints | planned |

## How it works
```
06:00 EAT  GitHub Actions: daily finder
           sources.yaml → fetch (robots.txt, 5 s per site, retries) → de-duplicate → pre-filter
           → aggregator listing resolved to the OFFICIAL page → free rule-based reader (every fact
           is quoted from a sentence on the page; nothing found = unknown, never guessed)
           → eligibility rules → scam rules → payout route → 0–100 score → Supabase → instant alerts
07:00 EAT  daily digest with Apply / Save / Skip / Not interested buttons
every 3 h  instant alerts, deadline reminders (14/7/3/1 days), broken-source alerts,
           Sunday summary (+ "check these yourself" links, academic-referee reminder)
any time   Telegram bot on Vercel (commands below); tracker page via /web
```

Sites that block bots from their pages but publish feeds (Devpost, We Work Remotely, Opportunity Desk) are never worked around. Their items are built from the feed text and always marked "check".

### Telegram
| You do | You get |
|---|---|
| **Apply** on an item | Checklist from the official page, a CV tailored to that page, a letter **outline** to write in your own words, and referee email drafts you send yourself. If something mandatory is missing (e.g. a required GPA), it pauses and asks you. |
| **Save / Skip / Not interested** | Status change, plus the ranking learns from it |
| Send a scan or PDF | Stored **encrypted** in your vault; the bot asks what it is |
| `/docs` | Your stored documents, each downloadable |
| `/web` | Private 7-day link to the tracker page (status, blockers, notes) |
| `/saved` `/deadlines` `/tracker` `/status` | Lists and agent status |
| `/pause` `/resume` | Kill switch for all automation |

## Code map
| Path | What |
|---|---|
| `sources.yaml` | Pluggable sources. `enabled`, `self` (page is one programme), `external`, `manual_url` (check by hand) |
| `profile.yaml` | **Private, git-ignored.** Your facts. Cloud copies are the `PROFILE_YAML_B64` secrets (GitHub, Vercel) |
| `src/sources/` | RSS, RemoteOK, Himalayas, Jobicy, Devpost, watched official pages |
| `src/pipeline/` | dedupe, prefilter, resolve, extract (rules / optional AI), eligibility, scam, payout, rank |
| `src/apply/` | Application pack: requirements checklist, tailoring, letter outline, referee drafts |
| `src/cv/` | CV generator (`npm run cv`) |
| `src/vault/`, `src/lib/vault.ts` | Encrypted document vault (AES-256-GCM) |
| `src/web/`, `api/tracker.ts` | Tracker page |
| `src/telegram/`, `api/telegram.ts` | Bot |
| `src/jobs/` | `daily`, `digest`, `hourly`, `setup-telegram`, `reset-cache`, `vault-cli` |
| `supabase/migrations/` | Database schema |
| `test/` | 166 tests |

## Guarantees
- **No invented facts.** Every fact is quoted from the official page (or the site's own feed, labelled). Missing facts show as unknown, and grades and dates are never guessed.
- **Partial funding is never shown as full.** "Full" means the page states that tuition *and* living costs are covered.
- **Truthful enrolment.** Scholarships that bar current university students are excluded; "new entrants only" items are marked for a manual check.
- **Scam rules.** Fees, PINs and upfront payments are rejected. On official programme pages, fees are flagged instead. Guaranteed acceptance, unrealistic pay, chat-only recruiters and free-mail contacts are flagged with the reason.
- **You submit.** Nothing is ever submitted or emailed on your behalf. Referee emails open in your own mail app.
- **Bot-forbidding platforms** (LinkedIn, Upwork, Wellfound…) get files and a link only, never automation.
- **$0.** AI is off (`AI_MONTHLY_CAP_USD=0`). If it's ever approved, spending stops at the cap.

## Commands
```
npm test                 # run the test suite
npm run dry-run          # run the finder locally without Telegram or database
npm run cv               # build vault/CV.docx (+PDF) from profile.yaml
```

Setup: see [docs/SETUP.md](docs/SETUP.md).
