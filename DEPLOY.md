# Deploy — AWS Lightsail via Terraform

One-time setup. After this, **`git push` to `main` auto-deploys** (GitHub Action).
Steps marked 🔵 need you (AWS creds / SSH / DNS) — they can't run from the agent.

## 0. Prereqs 🔵
```bash
brew install terraform awscli
aws configure         # your AWS access key + secret, region us-east-1
```

## 1. Repo
```bash
cd ~/Documents/ptw-consulting/world-cup-2026
git init && git add -A && git commit -m "World Cup 2026 bracket app"
gh repo create ptw-consulting/world-cup-2026 --public --source=. --remote=origin --push
```
Public is simplest — no secrets live in the repo (the passcode is env-seeded). For
a private repo, the box also needs a read deploy key to `git pull`.

## 2. Provision the box (Terraform) 🔵
```bash
cd terraform
terraform init
terraform apply          # creates the Lightsail box + static IP + firewall
terraform output static_ip
```

## 3. DNS 🔵
At your DNS provider for `ptwconsultingllc.com`, add an **A record**:
`cup` → the `static_ip` from step 2. Wait for it to resolve (`dig cup.ptwconsultingllc.com`).

## 4. CI deploy key 🔵
```bash
ssh-keygen -t ed25519 -f ~/.ssh/wc2026_deploy -N "" -C wc2026-ci
ssh ubuntu@<static_ip> 'cat >> ~/.ssh/authorized_keys' < ~/.ssh/wc2026_deploy.pub
```
Add GitHub repo **secrets** (Settings → Secrets → Actions):
- `SSH_HOST` = static_ip
- `SSH_USERNAME` = `ubuntu`
- `SSH_KEY` = contents of `~/.ssh/wc2026_deploy` (the private key)

## 5. First deploy on the box 🔵
```bash
ssh ubuntu@<static_ip>
git clone https://github.com/ptw-consulting/world-cup-2026.git
cd world-cup-2026
cp deploy/.env.production.example .env.production
nano .env.production        # set ADMIN_KEY (long random), confirm passcode
./scripts/provision-box.sh https://github.com/ptw-consulting/world-cup-2026.git cup.ptwconsultingllc.com
```
That builds, starts pm2, configures nginx, and runs certbot. Visit
**https://cup.ptwconsultingllc.com**.

## 6. Score poller secrets 🔵
Add repo secrets: `FOOTBALL_DATA_KEY`, `SITE_URL` (`https://cup.ptwconsultingllc.com`),
`ADMIN_KEY` (same as the box). Then run the **Poll World Cup scores** workflow with
`dry_run: true` — `unmapped` should be empty before you let it push.

## Going forward
- `git push` → auto-deploy.
- Re-create the box from scratch: `terraform destroy` then re-run from step 2.
- The SQLite DB lives at `~/world-cup-2026/data/cup.db` on the box (gitignored,
  survives deploys). Back it up with `scp ubuntu@<ip>:world-cup-2026/data/cup.db .`
