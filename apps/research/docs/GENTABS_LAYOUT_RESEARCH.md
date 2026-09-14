# Google Disco & GenTabs – Correct Concept & Layout Inspiration

## Official Source: What GenTabs Actually Is

**Disco** is a Google Labs experiment: *“Take the web for a fresh spin”* — discovering the next AI features for the web.  
**GenTabs** are Disco’s first feature: **AI-generated, custom interactive apps** built from **your open browser tabs** and **your stated goal**. There is no fixed template; *“there is no end to what you can make.”*

- **Primary reference**: [labs.google/disco](https://labs.google/disco)
- **Concept**: GenTabs **turn the tabs you have open into custom, interactive apps**. They are **generated based on your specific tabs and your specific goal** (powered by Gemini in the Disco browser).
- **Examples** (from the Disco site): *Explore the solar system • Plan a trip • Create a meal plan • Plan your garden.*

So GenTabs are **not** a layout library or a design system. They are **ephemeral, task-specific UIs** generated at runtime by AI. We have no access to the actual GenTabs renderer; we can only **borrow layout and UX ideas** for our static Research page.

---

## Visuals on labs.google/disco

When you study [labs.google/disco](https://labs.google/disco), you see:

| Element | What’s there |
|--------|----------------|
| **Hero** | Bold headline (“Take the web for a fresh spin”), subline “Discovering the next great AI features for the web”, **animated hero visual** (disco-style motion). |
| **Videos** | Embedded demos show the **real GenTabs UI**: generated app interfaces (trip planner, etc.), not just static cards. |
| **Headlines** | “GenTabs turn the tabs you have open into custom, interactive apps.” “GenTabs are generated based on your specific tabs and your specific goal…” |
| **Example cards** | Four use cases: *Explore the solar system / Plan a trip / Create a meal plan / Plan your garden* — each is a **task**, not a layout component. |
| **Footer** | “Join the party”, waitlist CTA, newsletter; navigation (About, Experiments, Sessions, Community). |

**Design traits** (from Disco/GenTabs demos and write-ups):

- **Task-specific layouts**: timelines, planners, maps, comparisons, 3D views, dashboards — each app looks different.
- **Interactive** elements (not just text/summaries): buttons, controls, embedded content.
- **Source attribution**: generated content links back to original web sources.
- **Conversational context**: Disco often shows **two panels** — chat/conversation + browser/tabs — so the “goal” is set in conversation.

We are **not** building AI-generated GenTabs. We are using these **ideas** (task-oriented view, modular blocks, source links) to shape our **fixed** Research page.

---

## Patterns We’re Borrowing (Spectre Research Page)

We adopt **layout and UX patterns** inspired by GenTabs, not the AI or the Disco product itself:

| Pattern | GenTabs / Disco | Our use in Spectre |
|--------|------------------|---------------------|
| **Task-oriented single view** | One GenTab = one goal (e.g. “Japan trip”) with many blocks in one scroll. | Research page = one “Research” task with hero, cards, chart, sources. |
| **Modular blocks** | Maps, timelines, cards, charts in one vertical flow. | Trending token cards, Price (7d) chart block, then “Data from” strip. |
| **Source-linked content** | Blocks link back to origin (e.g. “From: …”). | “Data from Codex · CoinGecko” with links. |
| **Vertical rails** (optional) | Side column for multiple GenTabs/tasks. | Optional: “Saved research” or sessions rail. |
| **Command / intent** (optional) | Disco uses a chat-style bar for goal input. | Optional: “Ask” or “New research” bar. |

So “GenTabs-style” here means **we use these structural ideas** in our UI; we do **not** claim to replicate GenTabs or use any Google layout engine.

---

## What We Implemented (Crypto GenTabs-Style Structure)

Applied to **crypto** step by step:

1. **Hero banner** – “Research crypto your way” + “One view. Your goal. Live data from Codex & CoinGecko.” (crypto analogue of Disco’s “Take the web for a fresh spin”.)
2. **Task cards** – Four goals (like Disco’s solar system / trip / meal plan / garden): *Trending now* | *Compare tokens* | *Market pulse* | *Deep dive*. Selecting one highlights the matching block.
3. **Command bar** – “What do you want to research?” with placeholder “e.g. trending memecoins, compare ETH vs SOL…” (Disco-style intent input; can be wired later.)
4. **Profile strip** – “Welcome” + name + BTC/ETH/SOL widgets (unchanged).
5. **Modular blocks** – “Trending now” (clickable cards → token view), “Market pulse (7d)” chart (BTC/ETH/SOL), then “Data from Codex · CoinGecko”. Blocks get a soft focus style when their task is selected.
6. **Left rail** – “Saved” with “Current view”, “Trending snapshot”, “Market pulse”. Hidden on viewports &lt; 900px.
7. **Source-linked** – Footer strip with links to Codex and CoinGecko.

No official npm or layout library exists for GenTabs; the only “import” is **concepts and patterns** from [labs.google/disco](https://labs.google/disco) and related coverage (e.g. [Google Blog – GenTabs](https://blog.google/innovation-and-ai/models-and-research/google-labs/gentabs-gemini-3/)).
