# Windows Revit Agent Prompt

Use this prompt on the Windows PC that has Autodesk Revit installed.

```text
You are the Windows/Revit validation agent for the BIM Photo Sync project.

Repository:
https://github.com/HHSOLL/BIMPhotoSync.git

Primary goal:
Verify the phase-1 MVP from inside Revit:
Revit Room selection -> read BIM_PHOTO_ROOM_ID -> call Backend API -> show that Room's photos in chronological order in the dockable panel.

Do not expand scope.
Do not implement APS Viewer, reports, MCP agent, process color overlays, advanced AI, or HWP output.

System principles:
- Room is the system 기준 객체.
- Backend DB is the source of truth.
- Revit is a BIM authoring tool, not the database.
- Room mapping must use ID, not name.
- Shared Parameter: BIM_PHOTO_ROOM_ID.
- Revit model modification must happen only through External Event.
- Add-in UI must use a Dockable Panel.

Expected repo structure:
- Backend API: apps/api
- AI worker: apps/ai-worker
- Web admin: apps/web
- Mobile app: apps/mobile
- Shared types: packages/shared
- Revit add-in: revit-addin/BimPhotoSyncAddin
- Add-in manifest: revit-addin/BimPhotoSync.addin
- Add-in config example: revit-addin/config.example.json

Windows prerequisites:
1. Windows PC with Revit 2025 installed.
2. .NET 8 SDK installed.
3. Git installed.
4. Network access to the Backend API.

Backend connection:
If the backend is running on the Mac development machine, do not use localhost from Windows.
Use the Mac LAN IP, for example:
http://192.168.45.70:4000/api/v1

If the backend is running directly on Windows, use:
http://localhost:4000/api/v1

Fresh login token:
Create or reuse the dev user:
email: dev@bim.local
password: password123

Get a fresh JWT:
curl -X POST http://<API_HOST>:4000/api/v1/auth/login ^
  -H "Content-Type: application/json" ^
  -d "{\"email\":\"dev@bim.local\",\"password\":\"password123\"}"

Known development project from the Mac run:
project_id: 7e696e6a-12d7-4674-a908-4f8e8e71d32d
sample bim_photo_room_id: rm_bb2fb642-df9f-4aa6-ad5e-78fffcd46c1c

Build steps:
1. Clone repo:
   git clone https://github.com/HHSOLL/BIMPhotoSync.git
   cd BIMPhotoSync

2. Set Revit API path. It must contain RevitAPI.dll and RevitAPIUI.dll:
   setx REVIT_2025_API "C:\Program Files\Autodesk\Revit 2025"

3. Restart terminal after setx, then build:
   dotnet build revit-addin\BimPhotoSyncAddin\BimPhotoSyncAddin.csproj -c Debug

4. Create Revit add-in directory:
   mkdir "%APPDATA%\Autodesk\Revit\Addins\2025"

5. Copy built add-in DLLs from:
   revit-addin\BimPhotoSyncAddin\bin\Debug\net8.0-windows\
   into:
   %APPDATA%\Autodesk\Revit\Addins\2025\

6. Copy manifest:
   copy revit-addin\BimPhotoSync.addin "%APPDATA%\Autodesk\Revit\Addins\2025\BimPhotoSync.addin"

7. Create config directory:
   mkdir "%APPDATA%\BimPhotoSync"

8. Create config:
   %APPDATA%\BimPhotoSync\config.json

Config format:
{
  "ApiBaseUrl": "http://<API_HOST>:4000/api/v1",
  "JwtToken": "<fresh JWT from login>",
  "ProjectId": "7e696e6a-12d7-4674-a908-4f8e8e71d32d",
  "RevitModelId": "windows-revit-test-model"
}

Revit validation flow:
1. Start Revit 2025.
2. Open or create a model with Rooms.
3. Confirm BIM Photo Sync ribbon/panel loads.
4. Run Connect Project.
5. Run Sync Rooms.
6. Verify each Revit Room gets a BIM_PHOTO_ROOM_ID shared parameter value.
7. Select a Room.
8. Verify the dockable panel refreshes and calls:
   GET /api/v1/revit/rooms/{BIM_PHOTO_ROOM_ID}/photos
9. Verify photos appear sorted newest first by work_date/captured_at/created_at.
10. If a Room has no photos, verify the panel shows a clear empty state rather than an error.

API checks if needed:
curl -H "Authorization: Bearer <JWT>" ^
  "http://<API_HOST>:4000/api/v1/revit/rooms/<BIM_PHOTO_ROOM_ID>/photos"

Acceptance criteria:
- Add-in builds on Windows.
- Add-in loads in Revit 2025.
- Dockable panel appears.
- Project connection succeeds.
- Room Sync writes BIM_PHOTO_ROOM_ID.
- Selecting a Room triggers photo lookup by BIM_PHOTO_ROOM_ID.
- Returned photos display in the panel in time order.
- No Revit model writes happen outside External Event.

If blocked:
- Capture exact build/runtime error.
- Include Revit version, .NET SDK version, REVIT_2025_API value, and whether RevitAPI.dll exists.
- Include the API URL used and the HTTP status/body from the failing call.
- Do not redesign the architecture unless the existing implementation cannot satisfy the acceptance criteria.

Final report format:
1. Environment
   - Windows version
   - Revit version
   - .NET SDK version
   - API base URL
2. Build result
3. Revit load result
4. Room sync result
5. Room click/photo panel result
6. Issues found
7. Files changed, if any
8. Verification evidence
```

