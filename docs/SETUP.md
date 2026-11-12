# Setup — what you need to do (≈15 minutes, phone is fine for most)

**Everything runs on free tiers. Total cost: $0/month. No card needed anywhere.**

The database is already created: a Supabase project called **opportunity-agent**, in a separate project from your BnB site, with all tables in place. These remaining steps need your own accounts and secrets, so only you can do them.

## 1. Make the GitHub repo private (2 min)
GitHub → `ambwereMj/orppotunities` → **Settings → General → Danger Zone → Change visibility → Private**.
Private repos also avoid GitHub switching off scheduled jobs after 60 days without commits.

## 2. Telegram bot (3 min)
1. In Telegram, open **@BotFather** → `/newbot` → pick a name. Copy the **token**.
2. Open your new bot and press **Start** (step 5 needs this).

## 3. (Skipped) AI key
The agent reads official pages with free built-in rules, so no AI key or credit is needed. AI reading is switched off (`AI_MONTHLY_CAP_USD=0`) and stays off unless you approve turning it on.

## 4. Supabase keys (1 min)
supabase.com → project **opportunity-agent** → **Project Settings → API Keys**. Copy the **secret / service_role** key.
The URL is `https://ikjpoquqklswkuqftnuq.supabase.co`.

## 5. Vercel (Telegram buttons and commands) (5 min)
1. vercel.com → **Add New → Project** → import `ambwereMj/orppotunities` (Framework: Other).
2. Under **Environment Variables**, add: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` (any long random string you make up). Leave `TELEGRAM_CHAT_ID` empty for now.
3. Deploy. Then connect Telegram to it by opening this URL once in a browser, filled in:
   `https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<your-vercel-domain>/api/telegram&secret_token=<TELEGRAM_WEBHOOK_SECRET>`
4. Send `/start` to your bot. It replies with your **chat id**. Add it in Vercel as `TELEGRAM_CHAT_ID` and redeploy. From then on, the bot only answers you.

## 6. GitHub Actions secrets (5 min)
Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
|---|---|
| `SUPABASE_URL` | `https://ikjpoquqklswkuqftnuq.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | from step 4 |
| `TELEGRAM_BOT_TOKEN` | from step 2 |
| `TELEGRAM_CHAT_ID` | from step 5 |
| `PROFILE_YAML_B64` | contents of `vault/PROFILE_YAML_B64.txt` (prepared for you; never committed) |

Then go to **Actions → Opportunity Agent → Run workflow → daily** for a first run. After that it runs on its own every day.

## 7. Put your CV in the encrypted vault (optional now, needed in Phase 3)
On a computer with the repo:
```
export SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... VAULT_PASSPHRASE='a long passphrase you keep in a password manager'
npm run vault -- put path/to/your_CV.pdf cv
```
Files are encrypted on your machine before upload. If you lose the passphrase, the files can't be recovered.

## Kill switch
- `/pause` in Telegram stops all jobs. `/resume` starts them again.
- Hard stop: GitHub → Actions → Opportunity Agent → **⋯ → Disable workflow**.

## Cost: $0
| Service | Free-tier limit | Our usage |
|---|---|---|
| GitHub Actions (private repo) | 2,000 min/month | ≈ 600–1,000 min (daily finder ≤ 30 min, digest, check every 3 h). With no card on file, GitHub stops jobs at the limit; it never charges |
| Supabase Free | 500 MB database, 1 GB storage | a few MB. Daily activity keeps the project from pausing |
| Vercel Hobby | free for personal use | one small webhook function |
| Telegram Bot API | free | — |
| AI | off (`AI_MONTHLY_CAP_USD=0`) | $0 |

Don't add a payment method to GitHub, Supabase or Vercel. That way nothing can ever be billed.
