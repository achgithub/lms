# Last Man Standing

Standalone Docker app — Go backend, React/TypeScript frontend, PostgreSQL.

## Quick Start

```bash
cp .env.example .env
# Edit .env with your values (or leave defaults for dev)
docker compose up --build
```

App runs at http://localhost:8080

Default login: `admin@lms.local` / `changeme` (forced to change on first login)

## Roles

| Role | Access |
|------|--------|
| admin | Users management only |
| manager | Fixtures + Manager setup + Games + Reports |
| games | Games + Reports |
| reports | Reports only |
| player | My Games (self-pick mode only) |

## Development (no Docker for Go/Vite)

```bash
# Start just postgres
docker compose -f docker-compose.dev.yml up -d

# Backend (requires Go installed)
cd backend
DATABASE_URL=postgres://lms:lmsdev@localhost:5432/lms go run .

# Frontend
cd frontend
npm install
npm run dev   # http://localhost:3000
```

## E2E Tests

```bash
# Against running docker stack
cd frontend
npm install
npx playwright install chromium
BASE_URL=http://localhost:8080 npx playwright test
```

## Football API

To use the Fixtures tab, get a free API key from https://www.football-data.org and set `FOOTBALL_API_KEY` in `.env`.
