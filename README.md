# BIM Photo Sync

Room-centered construction photo operations platform.

## MVP Scope

- Backend API: auth, company/project, Room, presigned photo upload, photo query, AI review, Revit sync APIs
- AI Worker: queue-based basic photo analysis
- Web Admin: Room and photo browsing with design-system styling
- Mobile App: field photo selection, metadata entry, presigned upload, commit
- Revit Add-in: Room sync, `BIM_PHOTO_ROOM_ID` write-back, selected Room photo lookup panel

Out of scope for this phase: APS Viewer, report generation, MCP agent, process color overlay, advanced AI, and HWP output.

## Local Setup

```bash
cp .env.example .env
docker compose up -d
npm install
npm --workspace apps/api run prisma:generate
npm --workspace apps/api run prisma:migrate
npm run dev:api
npm run dev:worker
npm run dev:web
```

The web app defaults to `http://localhost:3000`.

If Prisma schema engine fails locally, apply the equivalent SQL directly:

```bash
docker exec -i bimphotosync-postgres-1 psql -U bim -d bim_photo_sync < apps/api/prisma/manual-init.sql
```

The Docker PostgreSQL service uses host port `55432` to avoid conflicts with a local macOS PostgreSQL service on `5432`.

## Verification

```bash
npm run typecheck
npm run build
DATABASE_URL='postgresql://bim:bim@localhost:55432/bim_photo_sync?schema=public' npm --workspace apps/api exec -- prisma validate
```

## Revit Add-in

The add-in source targets Revit 2025+ and .NET 8. Set `REVIT_2025_API` to the directory containing `RevitAPI.dll` and `RevitAPIUI.dll`, then build the C# project on Windows with Revit installed.
