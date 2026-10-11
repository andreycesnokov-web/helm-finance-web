# Helm Finance Web

React + Express webapp for Helm Finance bot.

## Stack
- Frontend: React + Vite (port 5173)
- Backend: Express.js (port 3001)
- Auth: Telegram Login Widget + JWT
- DB: Supabase (same as bot)

## Setup

### 1. Supabase migration
Run `migration_v3.sql` in Supabase SQL Editor.

### 2. Environment variables
```
cp .env.example .env
cp client/.env.example client/.env
```
Fill in your values.

### 3. Telegram bot setup
In @BotFather → Bot Settings → Domain:
Add your Railway domain: `helm-finance-web.railway.app`

### 4. Install & run locally
```bash
npm install
cd client && npm install && cd ..
npm run dev
```

## Deploy to Railway

1. Create new service in Railway → Deploy from GitHub
2. Set root directory: `/` (this folder)
3. Add environment variables from `.env.example`
4. Build command: `npm run build`
5. Start command: `npm start`

Railway auto-detects Node.js and runs `npm start`.

## Architecture

```
Telegram Bot (helm-finance-bot)
    ↓ writes to Supabase
Supabase DB
    ↑ reads via API
Express Server (helm-finance-web/server)
    ↑ serves
React Client (helm-finance-web/client)
    ↑ opens in browser
User
```
