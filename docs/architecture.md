# BIM Photo Sync Architecture

## Scope

This repository implements the current MVP scope from the BIM Photo Sync planning report:

1. Auth, company, project, and project access key structure
2. Room-centered relational data model
3. Photo upload through presigned object-storage URLs and photo querying
4. Queue-based basic AI analysis
5. Revit Add-in source for project connection, Room sync, and Room-click photo lookup

Explicitly out of scope for this stage: APS Viewer, report generation, MCP agent, process color overlay, advanced AI analysis, and HWP output.

## System Principle

The canonical object is `Room`, not `Photo`.

```
Company
  -> Project
      -> Room
          -> Photo
              -> PhotoAiAnalysis
```

Revit is a BIM authoring tool, not the application database. PostgreSQL is the source of truth. Revit stores only the `BIM_PHOTO_ROOM_ID` shared parameter used to map selected Room elements back to backend Rooms.

## Folder Structure

```
apps/api          NestJS stateless backend API
apps/ai-worker    BullMQ worker for photo AI analysis
apps/web          Next.js admin console
apps/mobile       Expo React Native field capture app
packages/shared   Shared TypeScript constants and DTO helpers
revit-addin       C#/.NET Revit Add-in source
docs              Architecture and operating notes
```

## Services

| Service | Responsibility |
| --- | --- |
| Backend API | JWT auth, RBAC, projects, Rooms, upload presign, photo metadata commit, photo queries, Revit APIs |
| PostgreSQL | Canonical relational source of truth |
| Object Storage | Private S3-compatible photo storage, accessed through presigned URLs |
| Redis Queue | Asynchronous AI analysis queue |
| AI Worker | Generates basic structured JSON analysis for each uploaded photo |
| Web Admin | Room/photo browsing, filters, AI result review |
| Mobile App | Room selection, metadata entry, local image upload, commit |
| Revit Add-in | Project connection, Room sync, shared parameter write-back, Dockable Panel photo timeline |

## API Structure

All routes use `/api/v1`.

| Domain | Routes |
| --- | --- |
| Auth | `POST /auth/register`, `POST /auth/login`, `GET /auth/me` |
| Projects | `GET /projects`, `POST /projects`, `POST /projects/:projectId/access-key` |
| Rooms | `GET /projects/:projectId/rooms`, `POST /projects/:projectId/rooms`, `PATCH /rooms/:roomId` |
| Uploads | `POST /uploads/photos/presign` |
| Photos | `POST /photos`, `GET /photos`, `GET /photos/:photoId` |
| AI | `GET /photos/:photoId/analysis`, `PATCH /photos/:photoId/analysis/review` |
| Revit | `POST /revit/connect`, `POST /revit/sync-rooms`, `GET /revit/rooms/:bimPhotoRoomId/photos` |

## Design System

The UI follows `designsystem.png`:

- Primary blue: `#2563EB`
- Blue scale: `#EFF6FF`, `#CFE2FF`, `#99C2FF`, `#2563EB`, `#1D4ED8`, `#1E40AF`, `#0F172A`
- Semantic: success `#22C55E`, warning `#F59E0B`, error `#EF4444`, info `#0EA5E9`, neutral `#6B7280`
- Font: Pretendard fallback stack
- 8px spacing grid, compact operational density
- Cards use 8px radius or less; UI is dashboard/tool focused, not a marketing page

## Revit Rules

- Room mapping is ID-based, never name-based.
- Shared Parameter: `BIM_PHOTO_ROOM_ID`
- Add-in UI is a WPF Dockable Panel.
- Model writes are performed only from External Events.
- Room selection flow:

```
Revit Room selected
-> read BIM_PHOTO_ROOM_ID
-> GET /api/v1/revit/rooms/{bimPhotoRoomId}/photos
-> render photo timeline in Dockable Panel
```

