# Setup — what you need to do (≈15 minutes, phone is fine for most)

**Everything runs on free tiers. Total cost: $0/month. No card needed anywhere.**

The database is already created: a Supabase project called **opportunity-agent**, in a separate project from your BnB site, with all tables in place. These remaining steps need your own accounts and secrets, so only you can do them.

## 1. Repo visibility
The repo is **public**. Public repos have unlimited free GitHub Actions minutes, and your profile and keys live only in encrypted secrets, never in the code.
(It was made public in Nov 2026 after the account's free minutes ran out. GitHub pauses schedules in public repos after 60 days without commits and emails you first: re-enable them with one tap in Actions.)

## 2. Telegram bot (3 min)
1. In Telegram, open **@BotFather** → `/newbot` → pick a name. Copy the **token**.
2. Open your new bot and press **Start** (step 5 needs this).

## 3. (Skipped) AI key
The agent reads official pages with free built-in rules, so no AI key or credit is needed. AI reading is switched off (`AI_MONTHLY_CAP_USD=0`) and stays off unless you approve turning it on.

## 4. Supabase keys (1 min)
supabase.com → project **opportunity-agent** → **Project Settings → API Keys**. Copy the **secret / service_role** key.
The URL is `https://ikjpoquqklswkuqftnuq.supabase.co`.

## 5. Vercel (Telegram buttons and commands)
The Vercel project **opportunity-agent** is already created and linked to this repo, and `SUPABASE_URL` is already set.
You add the two secrets: vercel.com → **opportunity-agent** → **Settings → Environment Variables**:

| Key | Value |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | the Supabase secret key |
| `TELEGRAM_BOT_TOKEN` | the BotFather token |

Then **Deployments → ⋯ on the latest → Redeploy**.

## 6. GitHub Actions secrets
Repo → **Settings → Secrets and variables → Actions**: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`, `PROFILE_YAML_B64`.
No chat id is needed: the bot registers you as its owner when you press **Start**. It only ever answers that chat.

## 6b. Connect the bot (one tap)
GitHub → **Actions → Opportunity Agent → Run workflow** → job **setup** → **Run workflow**.
This points the bot at Vercel. The webhook password is derived from the bot token, so there is nothing to copy.
If you had already pressed Start, you get "You're registered as the owner". Otherwise send `/start` now.

Then run the workflow again with job **daily** for the first search, and **digest** to receive the results.

## 7. Documents (from your phone)
Send any scan or PDF to the bot, for example your KCSE certificate, JKUAT transcript, Moringa and ICDL certificates, or passport bio page. It is encrypted before it is stored, and the bot asks what it is. `/docs` lists your documents and sends any of them back. The encryption key (`VAULT_PASSPHRASE`) lives only in Vercel. If it is ever lost, re-upload your scans.

## 8. Profile changes
Your profile lives in `profile.yaml` (never committed). When it changes, update the `PROFILE_YAML_B64` value in **both** GitHub (Actions secrets) and Vercel (environment variables), or ask Claude to do it.

## Kill switch
- `/pause` in Telegram stops all jobs. `/resume` starts them again.
- Hard stop: GitHub → Actions → Opportunity Agent → **⋯ → Disable workflow**.

## Cost: $0
| Service | Free-tier limit | Our usage |
|---|---|---|
| GitHub Actions (public repo) | unlimited | daily finder ≤ 30 min, digest, check every 3 h |
| Supabase Free | 500 MB database, 1 GB storage | a few MB. Daily activity keeps the project from pausing |
| Vercel Hobby | free for personal use | one small webhook function |
| Telegram Bot API | free | — |
| AI | off (`AI_MONTHLY_CAP_USD=0`) | $0 |

Don't add a payment method to GitHub, Supabase or Vercel. That way nothing can ever be billed.
