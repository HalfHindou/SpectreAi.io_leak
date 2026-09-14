# Deploy to Vercel Production

Your repo has `vercel.json` and is ready to build. To get **production** live:

---

## Option A: Connect repo in Vercel (recommended)

1. **Go to [vercel.com](https://vercel.com)** and sign in (GitHub).
2. **Add New Project** → **Import** your Git repository (`Spectre-AI-Bot/Spectre-Sunny-Test` or your repo name).
3. **Configure:**
   - **Framework Preset:** Vite (or leave as detected)
   - **Build Command:** `npm run build` (from `vercel.json`)
   - **Output Directory:** `dist`
   - **Install Command:** `npm install`
4. **Environment variables:** Add any needed (e.g. `CODEX_API_KEY`) under **Settings → Environment Variables** for Production.
5. **Deploy** – first deploy will run. Then:
   - **Settings → Git → Production Branch:** set to `main` or `prod` (so pushes to that branch deploy to production).
6. Future pushes to the production branch will auto-deploy to production.

---

## Option B: Deploy from your machine (CLI)

1. **One-time login** (run in your project folder):
   ```bash
   npx vercel login
   ```
   Complete the browser login so the CLI is linked to your account.

2. **Link project** (first time only):
   ```bash
   npx vercel
   ```
   Follow prompts to link this folder to a new or existing Vercel project.

3. **Deploy to production:**
   ```bash
   npx vercel --prod
   ```

---

## If production still doesn’t exist

- In **Vercel Dashboard → Your Project → Deployments**: open the latest deployment → **⋯** → **Promote to Production**.
- Or set **Settings → Git → Production Branch** to `main` (or `prod`) and push that branch again; Vercel will create a production deployment.
