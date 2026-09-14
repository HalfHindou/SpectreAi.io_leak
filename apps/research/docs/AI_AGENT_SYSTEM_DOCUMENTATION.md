# Spectre Sunny AI/Agent System Architecture Documentation

## Executive Summary

Spectre Sunny features a sophisticated multi-layered AI and gamification system centered around a personalized AI agent that "hatches" from an egg after user interactions. The system combines:

1. **The Spectre Egg System** - An onboarding/gamification mechanic where an AI agent learns from user behavior before hatching
2. **Spectre Agent Chat** - A personalized AI assistant with context-aware responses
3. **Monarch AI** - A broader AI assistant for market analysis and token research
4. **Multiple Gamification Patterns** - Level progression, memory games, and interactive features

---

## 1. The Spectre Egg System (Easter Egg / Onboarding)

### Location
- `src/components/egg/SpectreEgg.jsx` - Visual egg component
- `src/components/egg/EggStateManager.js` - State machine logic
- `src/components/egg/useEggState.js` - React hook for egg state
- `src/components/egg/EggExplainerModal.jsx` - Onboarding modal

### State Machine

```
DORMANT → CRACKING → HATCHING → BORN → GROWING
```

| State | Description | Trigger |
|-------|-------------|---------|
| **DORMANT** | Initial state, egg is still with faint glow | User lands on page |
| **CRACKING** | 1-2 visible cracks, neural nodes start glowing | 3+ meaningful interactions OR user clicks "Start Hatching" |
| **HATCHING** | Multiple cracks, light shining through, wobble intensifies | 8+ total interactions |
| **BORN** | Egg breaks open, agent creature appears | Automatic after hatch animation (2 seconds) |
| **GROWING** | Agent is active, evolves visually based on usage | Continuous after birth |

### Interaction Tracking

```javascript
const INTERACTION_WEIGHTS = {
  search: 1,              // User searches for a token/topic
  pageView: 0.5,          // User views a research page
  chartInteraction: 1,    // User interacts with a chart
  agentChat: 2,           // User sends message in agent chat
  watchlistAdd: 2,        // User adds to watchlist
  researchRead: 3,        // User reads research (time > 30s)
  prediction: 5,          // User makes price prediction
  shareContent: 3,        // User shares from platform
  dailyLogin: 5,          // First visit of the day
  settingsChange: 1,      // User customizes settings
}
```

### Visual Design

The egg features:
- **Neural network visualization** - 13 nodes with 20 connections inside the egg
- **CSS animations** - Breathing, pulsing, node flickering, connection pulses
- **Stage-specific animations**:
  - Dormant: Gentle floating
  - Cracking: Wobble with cracks appearing
  - Hatching: Intense wobble with light through cracks
  - Born: Burst animation with brightness escalation

---

## 2. The Spectre Agent Chat System

### Location
- `src/components/agent/SpectreAgentChat.jsx` - Main chat panel
- `src/components/agent/AgentAvatar.jsx` - Agent creature avatar
- `src/components/agent/AgentFAB.jsx` - Floating action button
- `src/components/agent/agentProfile.js` - Profile management
- `src/components/agent/agentResponses.js` - Response templates

### Birth Conversation Flow

The agent asks 4 questions during onboarding:

1. **Motivation**: "What brings you here?"
   - Find the next 100x
   - Research before trading
   - Stay informed
   - Building a portfolio

2. **Markets**: "What do you mostly trade?"
   - Bitcoin & Ethereum (majors)
   - Altcoins
   - Memecoins
   - Stocks & crypto
   - I'm new

3. **Info Style**: "How do you like your info?"
   - Quick and to the point
   - Deep analysis with context
   - Just tell me what to do (action)
   - Visual (charts and data)

4. **Risk Profile**: "How much risk are you comfortable with?"
   - Conservative
   - Moderate
   - Aggressive
   - Degen

### Agent Type Assignment

Based on answers, one of 6 agent types is assigned:

| Type | Color | Specialty | Assignment Criteria |
|------|-------|-----------|---------------------|
| **Phantom** | #00f0ff (Cyan) | Finding hidden alpha, stealth signals | 100x motivation + aggressive/degen risk |
| **Oracle** | #c084fc (Purple) | Sentiment reading, social signals | Informed + deep analysis |
| **Cipher** | #fbbf24 (Amber) | Quantitative patterns, statistical edges | Portfolio + visual + moderate |
| **Herald** | #f87171 (Red) | Speed, breaking news | Quick info style + informed/100x |
| **Titan** | #4ade80 (Green) | Risk management, portfolio protection | Conservative risk profile |
| **Wraith** | #22d3ee (Light Blue) | Generalist, adaptive | New user default |

### Agent Level Progression

```javascript
Level 1 (Hatchling):     0-50 interactions
Level 2 (Developing):   50-150 interactions  
Level 3 (Mature):      150-500 interactions
Level 4 (Ascended):   500-1500 interactions
Level 5 (Apex):       1500+ interactions
```

Visual evolution includes:
- Glow intensity increases
- Aura rings appear (up to 3 at level 3+)
- Particle effects at level 4+
- Color saturation increases

### Context-Aware Suggestions

The agent provides smart suggestions based on current page context:

| Page | Suggestions |
|------|-------------|
| Research Zone | Analyze [token], Key levels, Whale activity |
| Dashboard | Market brief, Find token, Watchlist check |
| Fear & Greed | What does this mean, Historical context |
| Watchlists | Portfolio scan, Any risks, Best performer |
| Heatmaps/Bubbles | What am I seeing, Sector breakdown |
| Social Zone | Trending narratives, Social sentiment |

### Response Patterns

Responses adapt to user's info style:
- **Quick**: Under 3 sentences, punchy, conclusion-first
- **Deep**: Full context, historical comparisons, data points
- **Action**: Entry/target/stop-loss included, direct commands
- **Visual**: Chart references, numbers, percentages

And risk profile:
- **Conservative**: Measured, emphasizes risk, protective tone
- **Moderate**: Balanced, calculated risks, gentle pushback
- **Aggressive**: Bold, energetic, confidence-focused
- **Degen**: Raw, street-smart, no BS, in-the-trenches

---

## 3. AI Assistant Features (Monarch AI)

### Location
- `src/components/AIAssistant.jsx` - Full-featured assistant
- `src/components/MonarchAIChatPage.jsx` - Full-page chat interface

### Capabilities

The AI Assistant provides:

1. **Token Search with @ mentions** - Type @ to search and add tokens
2. **Project Intelligence**:
   - Latest updates and news
   - Roadmap information
   - Whitepaper access
   - Social links (Twitter, Discord, Telegram)
   - Latest tweets from projects

3. **Page Navigation** - Open specific sections via commands:
   - "Show news" → Opens news tab
   - "Fear and greed" → Highlights F&G index
   - "Market analysis" → Opens AI analysis
   - "Pull up BTC chart" → Opens token chart

4. **Intent Parsing**:
   ```javascript
   parsePageIntent()    // For navigation commands
   parseProjectIntent() // For @token queries
   ```

### Deep Mode

Toggle for enhanced responses (more detailed analysis, additional data sources)

---

## 4. Gamification Patterns

### 1. Egg Hatching (Primary Gamification)
- Progress tracking toward hatching
- Visual evolution through stages
- Achievement: Agent birth

### 2. Agent Leveling System
- Continuous progression based on interactions
- Visual avatar evolution
- Status labels: Hatchling → Developing → Mature → Ascended → Apex

### 3. Crypto Memory Game (`CryptoMemoryGame.jsx`)
- Match pairs of token logos
- 8 pairs (16 cards)
- Completion rewards (points system)

### 4. Interaction Tracking
Gamified weights assigned to actions:
- Daily login: 5 points
- Predictions: 5 points
- Research read: 3 points
- Shares: 3 points
- Agent chat: 2 points
- Watchlist adds: 2 points

### 5. Visual Feedback
- Animations for progress
- Color-coded agent types
- Glow effects intensify with level
- Particle effects at higher levels

---

## 5. Technical Architecture

### Data Flow

```
User Interaction
     ↓
WelcomePage / Component
     ↓
trackEggInteraction() / trackAgentInteraction()
     ↓
localStorage (spectreEgg, spectreAgent)
     ↓
useEggState Hook (cross-tab sync)
     ↓
UI Updates (Egg, AgentAvatar, Chat)
```

### Storage Schema

**Egg State (`spectreEgg`)**:
```json
{
  "state": "DORMANT|CRACKING|HATCHING|BORN|GROWING",
  "started": true,
  "interactions": {
    "searches": 0,
    "pageViews": 0,
    "clicks": 0,
    "total": 0
  },
  "createdAt": "ISO date",
  "startedAt": "ISO date",
  "crackedAt": "ISO date",
  "hatchingAt": "ISO date",
  "bornAt": "ISO date"
}
```

**Agent Profile (`spectreAgent`)**:
```json
{
  "born": true,
  "bornAt": "ISO date",
  "motivation": "100x|research|informed|portfolio",
  "markets": "majors|altcoins|memecoins|stocks_crypto|new",
  "infoStyle": "quick|deep|action|visual",
  "riskProfile": "conservative|moderate|aggressive|degen",
  "agentType": "Phantom|Oracle|Cipher|Herald|Titan|Wraith",
  "agentColor": "#00f0ff",
  "level": 1,
  "interactions": 0
}
```

### Key Hooks

- `useEggState()` - Manages egg lifecycle
- `useTokenSearch()` - For @ mentions
- `useWatchlistPrices()` - Live price data
- `useMarketIntel()` - Market intelligence

---

## 6. Special Interactive Features

### 1. Floating Action Button (AgentFAB)
- Appears after agent is born
- Shows agent avatar with pulse animation
- Badge notification for agent messages
- Opens chat panel on click

### 2. Contextual Greetings
The agent greets users based on:
- Current page (Research Zone, Dashboard, etc.)
- Selected token
- Time since last visit
- Watchlist status

### 3. Smart Suggestions
Dynamic suggestion chips appear based on:
- User's risk profile (degen users see "🔥 What's pumping?")
- Current context (token research shows analysis options)
- Available data (watchlist users see portfolio scan)

### 4. Typing Simulation
- 3-dot typing indicator with staggered animation
- Natural delays (800-1500ms between messages)
- Creates feeling of real conversation

### 5. Pre-written Response System
Before Claude API integration:
- 100+ contextual responses mapped to intents
- Profile-aware tone adaptation
- Fallback responses for unknown queries

---

## 7. Integration Points

### With WelcomePage
```jsx
// WelcomePage receives egg state props
const {
  eggStage,
  eggStarted,
  eggProgress,
  agentIsBorn,
  agentProfile,
  onEggClick,
  onOpenAgentChat
} = props
```

### Chat Triggers
- Egg hatching completion → Auto-opens agent chat
- User clicks AgentFAB → Opens chat with greeting
- Specific actions → Open chat with context

### Cross-Tab Synchronization
```javascript
// useEggState listens for storage events
window.addEventListener('storage', (e) => {
  if (e.key === 'spectreEgg') {
    setEggState(getEggState())
  }
})
```

---

## 8. Future Extensibility

The system is designed for:

1. **Claude API Integration** - System prompt structure ready in `spectre-agent-spec.md`
2. **Database Migration** - localStorage schema maps to user table
3. **Additional Agent Types** - Easy to add new personality types
4. **More Gamification** - Point system supports new interactions
5. **Multi-Agent Support** - Architecture supports multiple agents per user

---

## 9. Design Philosophy

1. **Premium, Not Gamified** - Despite game mechanics, maintains professional feel
2. **Alive, Not Animated** - Subtle constant motion (breathing, pulsing) creates life
3. **Personalized, Not Generic** - Every agent is unique to the user
4. **Progressive Disclosure** - Complexity increases with user engagement
5. **Context-Aware** - Agent knows where the user is and what they're doing

---

## Related Documentation

- `spectre-agent-spec.md` - Full agent personality specification
- `spectre-egg-prompt.md` - Implementation guide for egg system
- `DESIGN_SYSTEM.md` - Visual design language
