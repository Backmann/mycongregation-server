# mycongregation-server

[![Deploy](https://github.com/Backmann/mycongregation-server/actions/workflows/deploy.yml/badge.svg)](https://github.com/Backmann/mycongregation-server/actions/workflows/deploy.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

NestJS REST API for [mycongregation](https://github.com/Backmann/mycongregation-app) — a helper for organizing meetings and managing members in small organizations and groups.

Production API: **https://api.mycongregation.org/api**

> ⚠️ Independent, community-built tool. Not affiliated with or endorsed by any organization.

## Features

- 🔐 JWT authentication (access + refresh, bcrypt-12 password hashing)
- 👥 Member records with soft-delete and restoration
- 👨‍👩‍👧 Families and groups with relational linking
- 📋 Assignments for scheduled meetings
- 🎤 Talks catalog
- 🏢 Multi-tenancy ready (`congregationId` scoping on all entities)
- ✅ Manual TypeORM migrations (no auto-sync in production)

## Tech stack

- [NestJS](https://nestjs.com/) + TypeScript (strict)
- PostgreSQL 16 + TypeORM
- Joi validation schemas
- Docker Compose for local + production

## Development

Requirements: Node.js 20+, Docker, PostgreSQL 16

```bash
git clone https://github.com/Backmann/mycongregation-server.git
cd mycongregation-server
cp .env.example .env  # then edit credentials
npm install
docker compose up -d postgres
npm run migration:run
npm run start:dev
```

API on http://localhost:3000/api by default.

## Tests

```bash
npm run test       # unit
npm run test:e2e   # integration
```

## Production

Deployed via Docker Compose on a Hetzner CX22 VPS, behind nginx + Cloudflare Origin Certificate.

```bash
docker compose up -d
docker compose run --rm server npm run migration:run
```

## API surface

Routes mapped under `/api` prefix. Key endpoints:

- `POST /api/auth/login` — JWT auth
- `GET /api/publishers` — list with filters
- `GET /api/assignments` — meeting parts by date range

## License

[AGPL-3.0](LICENSE) — derivative works distributed over a network must publish their source.

Copyright (C) 2026 Lionel Backmann (Hovorukha)
