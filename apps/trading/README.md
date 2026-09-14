# Spectre AI Trading Platform

A modern, production-ready cryptocurrency trading platform built with React. Features real-time token data from Codex API, interactive charts, transaction history, and an Apple-inspired dark theme.

![Spectre AI Trading Platform](https://img.shields.io/badge/React-18.2.0-blue) ![Vite](https://img.shields.io/badge/Vite-5.0.0-purple)

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- npm or yarn
- Codex API key (get one at [codex.io](https://codex.io))

### 1. Clone & Install

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/spectre-ai-trading.git
cd spectre-ai-trading

# Install frontend dependencies
npm install

# Install backend dependencies
cd server
npm install
cd ..
```

### 2. Environment Setup

Create a `.env` file in the project root:

```bash
# Create .env file
echo "CODEX_API_KEY=your_codex_api_key_here" > .env
```

Or manually create `.env` with:
```
CODEX_API_KEY=your_codex_api_key_here
```

> ⚠️ **Never commit your `.env` file!** It's already in `.gitignore`.

### 3. Set Team Password

Set `TEAM_GATE_PASSWORD` in the root `.env` (server-side only — never client-side):

```
TEAM_GATE_PASSWORD=your_secure_password_here
```

The password is verified by `apps/trading/api/auth-gate.js` (Vercel) /
`packages/server/routes/auth-gate.js` (Express) with `crypto.timingSafeEqual`
and the client receives a signed HttpOnly cookie. Do NOT put the password
into `AuthGate.jsx` — earlier README versions described an inline constant
which is no longer the implementation.

### 4. Run Development Server

```bash
# Terminal 1: Start backend server
cd server
npm start

# Terminal 2: Start frontend
npm run dev
```

The app will be available at `http://localhost:5180`

### 5. Deploy to Vercel

```bash
# Build the project
npm run build

# Deploy (first time - will prompt for setup)
npx vercel

# Deploy to production
npx vercel --prod
```

**Important:** Add your `CODEX_API_KEY` in Vercel:
1. Go to your project in [Vercel Dashboard](https://vercel.com)
2. Settings → Environment Variables
3. Add `CODEX_API_KEY` with your API key value

---

## ✨ Features

- **Real-time Token Data** - Live prices, market cap, volume, liquidity from Codex API
- **Multi-chain Support** - Ethereum, Solana, BSC, Polygon, Arbitrum, Base, and more
- **Interactive Charts** - Candlestick and line charts with multiple timeframes
- **Transaction History** - Real-time trades with filtering and infinite scroll
- **Token Search** - Search any token by name, symbol, or contract address
- **AI Assistant** - Chat interface for market analysis (coming soon)
- **Responsive Design** - Works on desktop and tablet

## 📁 Project Structure

```
spectre-ai-trading/
├── api/                    # Vercel serverless functions
│   └── codex.js           # Main API proxy for production
├── server/                 # Local development server
│   └── index.js           # Express server for Codex API proxy
├── src/
│   ├── components/        # React components
│   ├── hooks/             # Custom React hooks
│   ├── services/          # API service layer
│   ├── App.jsx            # Main app component
│   └── main.jsx           # Entry point
├── public/                # Static assets
├── .env                   # Environment variables (create this!)
├── .env.example           # Example env file
└── package.json
```

## 🔧 Configuration

### API Endpoints

| Environment | Frontend | Backend |
|------------|----------|---------|
| Development | `localhost:5180` | `localhost:3001` |
| Production | Vercel | `/api/codex` serverless function |

### Supported Networks

| Network | ID |
|---------|-----|
| Ethereum | 1 |
| Solana | 1399811149 |
| BSC | 56 |
| Polygon | 137 |
| Arbitrum | 42161 |
| Base | 8453 |
| Optimism | 10 |
| Avalanche | 43114 |

## 🛠 Tech Stack

- **Frontend:** React 18, Vite 5
- **Backend:** Express.js (dev), Vercel Serverless (prod)
- **API:** Codex GraphQL API
- **Styling:** CSS with CSS Variables
- **Charts:** Canvas API (native)

## 📄 License

MIT License - Feel free to use this project for your own trading platform.

---

**Built with ❤️ by the Spectre AI Team**
