# mycongregation-server

NestJS REST API for [mycongregation](https://github.com/Backmann/mycongregation-app) — congregation management for Jehovah's Witnesses congregations.

Production API: **https://api.mycongregation.org/api**

> ⚠️ This is an unofficial, community-built tool. Not affiliated with or endorsed by any religious organization.

## Features

- 🔐 JWT authentication (access + refresh, bcrypt-12 password hashing)
- 👥 Publishers CRUD with soft-delete and restoration
- 👨‍👩‍👧 Families and service groups with relational linking
- 📋 Assignments for midweek and weekend meetings
- 🎤 Public talks catalog with bulk import (190+ talks)
- 📅 EPUB-based weekly meeting schedule import
- 🏢 Multi-tenancy ready (`congregationId` scoping on all entities)
- ✅ Manual TypeORM migrations (no auto-sync in production)

## Tech stack

- [NestJS](https://nestjs.com/) 10 + TypeScript (strict)
- PostgreSQL 16 + TypeORM
- Joi validation schemas
- Docker Compose for local + production
- BullMQ planned for async work

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

Deployed via Docker Compose on a Hetzner CX22 VPS, behind nginx + Cloudflare Origin Certificate. Shares the host with [30sec.org](https://30sec.org).

```bash
docker compose up -d
docker compose run --rm server npm run migration:run
```

## API surface

Routes mapped under `/api` prefix. Key endpoints:

- `POST /api/auth/login` — JWT auth
- `GET /api/publishers` — list with filters
- `POST /api/public-talks/bulk-import` — bulk text import
- `POST /api/schedule-import/upload` — EPUB upload (multipart)
- `GET /api/assignments` — meeting parts by date range

## License

[AGPL-3.0](LICENSE) — derivative works distributed over a network must publish their source.

Copyright (C) 2026 Lionel Hovorukha
