# Deploy — AWS Lightsail via Terraform

One-time setup. After this, **`git push` to `main` auto-deploys** (GitHub Action).
Steps marked 🔵 need you (AWS creds / SSH / DNS) — they can't run from the agent.

## 0. Prereqs 🔵
```bash
brew install terraform awscli
aws configure         # your AWS access key + secret, region us-east-1
```

## 1. Repo ✅ done
`github.com/ptw-consulting/world-cup-2026` (private), `main` pushed. Because it's
private, the box authenticates to GitHub with a read-only **deploy key** — see step 5a.

## 2. Provision the box (Terraform) 🔵
```bash
cd terraform
terraform init
terraform apply          # creates the Lightsail box + static IP + firewall
terraform output static_ip
```

## 3. DNS 🔵
At your DNS provider for `ptwconsultingllc.com`, add an **A record**:
`worldcup` → the `static_ip` from step 2. Wait for it to resolve (`dig worldcup.ptwconsultingllc.com`).

## 4. CI deploy key 🔵
```bash
ssh-keygen -t ed25519 -f ~/.ssh/wc2026_deploy -N "" -C wc2026-ci
ssh ubuntu@<static_ip> 'cat >> ~/.ssh/authorized_keys' < ~/.ssh/wc2026_deploy.pub
```
Add GitHub repo **secrets** (Settings → Secrets → Actions):
- `SSH_HOST` = static_ip
- `SSH_USERNAME` = `ubuntu`
- `SSH_KEY` = contents of `~/.ssh/wc2026_deploy` (the private key)

## 5a. Box → GitHub read deploy key (private repo) 🔵
On the box, make a key and register it as a **read-only deploy key** on the repo:
```bash
ssh ubuntu@<static_ip>
ssh-keygen -t ed25519 -f ~/.ssh/github -N "" -C box-deploy
cat ~/.ssh/github.pub
printf 'Host github.com\n  IdentityFile ~/.ssh/github\n  IdentitiesOnly yes\n' >> ~/.ssh/config
```
Add that public key at repo **Settings → Deploy keys → Add** (read-only). From your
laptop you can do it in one line instead:
```bash
gh repo deploy-key add <(ssh ubuntu@<static_ip> 'cat ~/.ssh/github.pub') -R ptw-consulting/world-cup-2026 -t box-deploy
```

## 5b. First deploy on the box 🔵
```bash
# on the box:
git clone git@github.com:ptw-consulting/world-cup-2026.git
cd world-cup-2026
cp deploy/.env.production.example .env.production
nano .env.production        # set ADMIN_KEY (long random), confirm passcode
./scripts/provision-box.sh git@github.com:ptw-consulting/world-cup-2026.git worldcup.ptwconsultingllc.com
```
That builds, starts pm2, configures nginx, and runs certbot. Visit
**https://worldcup.ptwconsultingllc.com**.

## 6. Score poller secrets 🔵
Add repo secrets: `FOOTBALL_DATA_KEY`, `SITE_URL` (`https://worldcup.ptwconsultingllc.com`),
`ADMIN_KEY` (same as the box). Then run the **Poll World Cup scores** workflow with
`dry_run: true` — `unmapped` should be empty before you let it push.

## Going forward
- `git push` → auto-deploy.
- Re-create the box from scratch: `terraform destroy` then re-run from step 2.
- The SQLite DB lives at `~/world-cup-2026/data/cup.db` on the box (gitignored,
  survives deploys). Back it up with `scp ubuntu@<ip>:world-cup-2026/data/cup.db .`
