using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using BimPhotoSyncAddin.Models;
using BimPhotoSyncAddin.Services;
using System.IO;

namespace BimPhotoSyncAddin.Commands;

public sealed class SyncRoomsExternalHandler : IExternalEventHandler
{
    private const string SharedParameterName = "BIM_PHOTO_ROOM_ID";
    private const string SharedParameterGuid = "5E6A21CE-7829-4A8A-A354-448246AD687D";
    public UIApplication? UiApplication { get; set; }
    public RevitSyncOperation Operation { get; set; } = RevitSyncOperation.Rooms;

    public void Execute(UIApplication app)
    {
        try
        {
            RevitSyncOperation operation = Operation;
            ValidationLog.Write($"SyncRoomsExternalHandler.Execute entered. Operation={operation}.");
            UIApplication uiapp = UiApplication ?? app;
            Document doc = uiapp.ActiveUIDocument.Document;
            ValidationLog.Write($"Active document: {doc.Title}");
            if (string.IsNullOrWhiteSpace(AddinSettings.ProjectId))
            {
                ValidationLog.Write("Project ID is not configured.");
                TaskDialog.Show("BIM Photo Sync", "Project ID is not configured.");
                return;
            }

            List<SyncRoomDto> rooms = new FilteredElementCollector(doc)
                .OfCategory(BuiltInCategory.OST_Rooms)
                .WhereElementIsNotElementType()
                .Cast<SpatialElement>()
                .Select(room => new SyncRoomDto(
                    Bim_Photo_Room_Id: room.LookupParameter(SharedParameterName)?.AsString(),
                    Revit_Unique_Id: room.UniqueId,
                    Revit_Element_Id: room.Id.Value.ToString(),
                    Room_Number: room.get_Parameter(BuiltInParameter.ROOM_NUMBER)?.AsString(),
                    Room_Name: room.get_Parameter(BuiltInParameter.ROOM_NAME)?.AsString() ?? "Unnamed Room",
                    Level_Name: doc.GetElement(room.LevelId)?.Name))
                .ToList();
            ValidationLog.Write($"Collected {rooms.Count} rooms.");
            ValidationLog.Write($"Calling sync API: {AddinSettings.ApiBaseUrl}/revit/sync-rooms");

            SyncRoomsResponse? response = new ApiClient()
                .SyncRoomsAsync(new SyncRoomsRequest(AddinSettings.ProjectId, AddinSettings.RevitModelId, rooms))
                .GetAwaiter()
                .GetResult();

            if (response == null)
            {
                ValidationLog.Write("Room sync failed: API response was null.");
                TaskDialog.Show("BIM Photo Sync", "Room sync failed.");
                return;
            }
            ValidationLog.Write($"API returned {response.Data.Room_Mappings.Count} room mappings.");

            using Transaction tx = new(doc, "Write BIM_PHOTO_ROOM_ID");
            tx.Start();
            EnsureSharedParameter(doc, uiapp);
            foreach (RoomMappingDto mapped in response.Data.Room_Mappings)
            {
                Element? element = doc.GetElement(new ElementId(long.Parse(mapped.Revit_Element_Id)));
                Parameter? parameter = element?.LookupParameter(SharedParameterName);
                if (parameter is { IsReadOnly: false })
                {
                    parameter.Set(mapped.Bim_Photo_Room_Id);
                }
            }
            tx.Commit();
            ValidationLog.Write("Committed BIM_PHOTO_ROOM_ID writes.");

            string syncSummary = operation switch
            {
                RevitSyncOperation.CurrentView => SyncCurrentView(doc, response.Data.Room_Mappings),
                RevitSyncOperation.Sheets => $"Synced {SyncSheets(doc, response.Data.Room_Mappings)} Revit Sheets.",
                _ => "Room sync complete. Use Sync View for the current drawing, or Sync Sheets for every sheet."
            };

            if (Environment.GetEnvironmentVariable("BIM_PHOTO_SYNC_AUTORUN_SELECT_AFTER_SYNC") == "1")
            {
                RoomMappingDto? selectedMapping = SelectValidationRoom(response.Data.Room_Mappings);
                if (selectedMapping != null)
                {
                    uiapp.ActiveUIDocument.Selection.SetElementIds(
                        new List<ElementId> { new(long.Parse(selectedMapping.Revit_Element_Id)) });
                    ValidationLog.Write(
                        $"Auto-selected Room element {selectedMapping.Revit_Element_Id} with BIM_PHOTO_ROOM_ID={selectedMapping.Bim_Photo_Room_Id}.");
                }
            }

            if (Environment.GetEnvironmentVariable("BIM_PHOTO_SYNC_AUTORUN_SYNC") != "1")
            {
                TaskDialog.Show("BIM Photo Sync", $"Synced {response.Data.Room_Mappings.Count} Rooms.\n{syncSummary}");
            }
        }
        catch (Exception ex)
        {
            ValidationLog.Write($"SyncRoomsExternalHandler failed: {ex}");
            TaskDialog.Show("BIM Photo Sync", ex.Message);
        }
    }

    public string GetName() => "BIM Photo Sync Room Sync";

    private static RoomMappingDto? SelectValidationRoom(IReadOnlyList<RoomMappingDto> mappings)
    {
        string? preferredElementId = Environment.GetEnvironmentVariable("BIM_PHOTO_SYNC_AUTORUN_SELECT_ELEMENT_ID");
        if (!string.IsNullOrWhiteSpace(preferredElementId))
        {
            RoomMappingDto? preferred = mappings.FirstOrDefault(mapping => mapping.Revit_Element_Id == preferredElementId);
            if (preferred != null) return preferred;
        }

        return mappings.FirstOrDefault();
    }

    private static string SyncCurrentView(Document doc, IReadOnlyList<RoomMappingDto> mappings)
    {
        Dictionary<string, RoomMappingDto> mappingsByElementId = BuildMappingsByElementId(mappings);
        if (mappingsByElementId.Count == 0) return "Skipped drawing sync: no Room mappings were available.";

        View activeView = doc.ActiveView;
        if (activeView is ViewSheet activeSheet)
        {
            int sheetCount = SyncSheet(doc, activeSheet, mappingsByElementId);
            return sheetCount == 0
                ? $"Skipped current Sheet sync: {activeSheet.SheetNumber} could not be exported."
                : $"Synced current Sheet {activeSheet.SheetNumber} - {activeSheet.Name}.";
        }

        int floorPlanRoomCount = SyncFloorPlan(doc, mappingsByElementId);
        return floorPlanRoomCount == 0
            ? "Skipped current view sync: active view has no bounded Rooms."
            : $"Synced current view {activeView.Name} with {floorPlanRoomCount} Room overlays.";
    }

    private static int SyncFloorPlan(Document doc, IReadOnlyDictionary<string, RoomMappingDto> mappingsByElementId)
    {
        if (mappingsByElementId.Count == 0) return 0;

        View activeView = doc.ActiveView;
        string levelName = GetActiveLevelName(doc, activeView);

        List<FloorPlanRoomDto> planRooms = new();
        foreach (SpatialElement room in new FilteredElementCollector(doc, activeView.Id)
                     .OfCategory(BuiltInCategory.OST_Rooms)
                     .WhereElementIsNotElementType()
                     .Cast<SpatialElement>())
        {
            string elementId = room.Id.Value.ToString();
            if (!mappingsByElementId.TryGetValue(elementId, out RoomMappingDto? mapping)) continue;

            IReadOnlyList<PlanPointDto> polygon = GetRoomBoundary(room);
            if (polygon.Count < 3) continue;

            PlanPointDto center = GetRoomCenter(room, polygon);
            planRooms.Add(new FloorPlanRoomDto(
                Room_Id: mapping.Room_Id,
                Bim_Photo_Room_Id: mapping.Bim_Photo_Room_Id,
                Revit_Unique_Id: mapping.Revit_Unique_Id,
                Revit_Element_Id: mapping.Revit_Element_Id,
                Room_Number: room.get_Parameter(BuiltInParameter.ROOM_NUMBER)?.AsString(),
                Room_Name: room.get_Parameter(BuiltInParameter.ROOM_NAME)?.AsString() ?? "Unnamed Room",
                Level_Name: doc.GetElement(room.LevelId)?.Name ?? levelName,
                Area_M2: GetRoomAreaM2(room),
                Center: center,
                Polygon: polygon));
        }

        if (planRooms.Count == 0)
        {
            ValidationLog.Write("Skipped floor plan sync: active view has no bounded Rooms.");
            return 0;
        }

        PlanBoundsDto bounds = CalculateBounds(planRooms.SelectMany(room => room.Polygon));
        SyncFloorPlanResponse? floorPlanResponse = new ApiClient()
            .SyncFloorPlanAsync(new SyncFloorPlanRequest(
                AddinSettings.ProjectId,
                AddinSettings.RevitModelId,
                levelName,
                activeView.Name,
                activeView.Id.Value.ToString(),
                bounds,
                planRooms))
            .GetAwaiter()
            .GetResult();

        ValidationLog.Write(
            floorPlanResponse == null
                ? "Floor plan sync returned null."
                : $"Synced floor plan {floorPlanResponse.Data.Id} for {levelName} with {planRooms.Count} rooms.");
        return floorPlanResponse == null ? 0 : planRooms.Count;
    }

    private static int SyncSheets(Document doc, IReadOnlyList<RoomMappingDto> mappings)
    {
        if (mappings.Count == 0) return 0;
        if (string.IsNullOrWhiteSpace(AddinSettings.ProjectId)) return 0;

        Dictionary<string, RoomMappingDto> mappingsByElementId = BuildMappingsByElementId(mappings);
        if (mappingsByElementId.Count == 0) return 0;
        int syncedCount = 0;
        foreach (ViewSheet sheet in new FilteredElementCollector(doc)
                     .OfClass(typeof(ViewSheet))
                     .Cast<ViewSheet>()
                     .Where(sheet => !sheet.IsPlaceholder)
                     .OrderBy(sheet => sheet.SheetNumber))
        {
            syncedCount += SyncSheet(doc, sheet, mappingsByElementId);
        }

        if (syncedCount == 0)
        {
            ValidationLog.Write("Skipped sheet sync: no sheets could be exported.");
            return 0;
        }

        ValidationLog.Write($"Synced {syncedCount} sheets with room overlays.");
        return syncedCount;
    }

    private static int SyncSheet(
        Document doc,
        ViewSheet sheet,
        IReadOnlyDictionary<string, RoomMappingDto> mappingsByElementId)
    {
        RevitSheetDto? sheetDto = BuildSheetDto(doc, sheet, mappingsByElementId);
        if (sheetDto == null) return 0;

        SyncSheetsResponse? sheetResponse = new ApiClient()
            .SyncSheetsAsync(new SyncSheetsRequest(AddinSettings.ProjectId, AddinSettings.RevitModelId, new[] { sheetDto }))
            .GetAwaiter()
            .GetResult();

        int syncedCount = sheetResponse?.Data.Count ?? 0;
        ValidationLog.Write($"Synced sheet {sheet.SheetNumber} result count={syncedCount}.");
        return syncedCount;
    }

    private static RevitSheetDto? BuildSheetDto(
        Document doc,
        ViewSheet sheet,
        IReadOnlyDictionary<string, RoomMappingDto> mappingsByElementId)
    {
        try
        {
            SheetAssetDto? asset = ExportAndUploadSheetPdf(doc, sheet);
            SheetBounds bounds = GetSheetBounds(sheet);
            List<RevitSheetViewDto> views = new();
            List<RevitRoomOverlayDto> overlays = new();

            foreach (Viewport viewport in new FilteredElementCollector(doc)
                         .OfClass(typeof(Viewport))
                         .Cast<Viewport>()
                         .Where(viewport => viewport.SheetId == sheet.Id))
            {
                View? view = doc.GetElement(viewport.ViewId) as View;
                if (view == null) continue;

                views.Add(new RevitSheetViewDto(
                    Source_View_Id: view.Id.Value.ToString(),
                    Viewport_Element_Id: viewport.Id.Value.ToString(),
                    View_Name: view.Name,
                    View_Type: view.ViewType.ToString(),
                    Scale: view.Scale,
                    Viewport_Box: GetViewportBox(viewport)));

                if (view.ViewType != ViewType.FloorPlan &&
                    view.ViewType != ViewType.CeilingPlan &&
                    view.ViewType != ViewType.AreaPlan)
                {
                    continue;
                }

                overlays.AddRange(BuildRoomOverlaysForViewport(
                    doc,
                    view,
                    viewport,
                    bounds,
                    mappingsByElementId));
            }

            return new RevitSheetDto(
                Revit_Unique_Id: sheet.UniqueId,
                Revit_Element_Id: sheet.Id.Value.ToString(),
                Sheet_Number: sheet.SheetNumber,
                Sheet_Name: sheet.Name,
                Width_Mm: UnitUtils.ConvertFromInternalUnits(bounds.Width, UnitTypeId.Millimeters),
                Height_Mm: UnitUtils.ConvertFromInternalUnits(bounds.Height, UnitTypeId.Millimeters),
                Asset: asset,
                Views: views,
                Overlays: overlays);
        }
        catch (Exception ex)
        {
            ValidationLog.Write($"Skipped sheet {sheet.SheetNumber}: {ex.Message}");
            return null;
        }
    }

    private static Dictionary<string, RoomMappingDto> BuildMappingsByElementId(IReadOnlyList<RoomMappingDto> mappings)
    {
        return mappings
            .Where(mapping => !string.IsNullOrWhiteSpace(mapping.Revit_Element_Id))
            .ToDictionary(mapping => mapping.Revit_Element_Id, mapping => mapping);
    }

    private static SheetAssetDto? ExportAndUploadSheetPdf(Document doc, ViewSheet sheet)
    {
        if (!sheet.CanBePrinted)
        {
            ValidationLog.Write($"Sheet {sheet.SheetNumber} is not printable. Metadata will sync without a PDF asset.");
            return null;
        }

        string exportDirectory = Path.Combine(Path.GetTempPath(), "BimPhotoSync", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(exportDirectory);
        string fileStem = SanitizeFileName($"{sheet.SheetNumber}_{sheet.Name}");
        PDFExportOptions options = new()
        {
            Combine = false,
            FileName = fileStem
        };

        try
        {
            string[] before = Directory.GetFiles(exportDirectory, "*.pdf");
            bool exported = doc.Export(exportDirectory, new List<ElementId> { sheet.Id }, options);
            if (!exported)
            {
                ValidationLog.Write($"PDF export returned false for sheet {sheet.SheetNumber}.");
                return null;
            }

            FileInfo? exportedFile = Directory.GetFiles(exportDirectory, "*.pdf")
                .Select(path => new FileInfo(path))
                .Where(file => !before.Contains(file.FullName, StringComparer.OrdinalIgnoreCase))
                .OrderByDescending(file => file.LastWriteTimeUtc)
                .FirstOrDefault();

            if (exportedFile == null || !exportedFile.Exists)
            {
                ValidationLog.Write($"PDF export produced no file for sheet {sheet.SheetNumber}.");
                return null;
            }

            byte[] bytes = File.ReadAllBytes(exportedFile.FullName);
            PresignDrawingAssetResponse? presign = new ApiClient()
                .PresignDrawingAssetAsync(new PresignDrawingAssetRequest(
                    AddinSettings.ProjectId,
                    "application/pdf",
                    bytes.LongLength,
                    sheet.SheetNumber,
                    null))
                .GetAwaiter()
                .GetResult();

            if (presign == null)
            {
                ValidationLog.Write($"Drawing presign returned null for sheet {sheet.SheetNumber}.");
                return null;
            }

            new ApiClient()
                .UploadBytesAsync(presign.Data.Presigned_Url, "application/pdf", bytes)
                .GetAwaiter()
                .GetResult();

            return new SheetAssetDto(
                Object_Key: presign.Data.Object_Key,
                Mime_Type: "application/pdf",
                Width_Px: null,
                Height_Px: null);
        }
        finally
        {
            try
            {
                Directory.Delete(exportDirectory, true);
            }
            catch (Exception ex)
            {
                ValidationLog.Write($"Could not delete temporary export directory {exportDirectory}: {ex.Message}");
            }
        }
    }

    private static IEnumerable<RevitRoomOverlayDto> BuildRoomOverlaysForViewport(
        Document doc,
        View view,
        Viewport viewport,
        SheetBounds sheetBounds,
        IReadOnlyDictionary<string, RoomMappingDto> mappingsByElementId)
    {
        Transform projectionToSheet;
        IList<TransformWithBoundary> modelToProjectionTransforms;
        try
        {
            projectionToSheet = viewport.GetProjectionToSheetTransform();
            modelToProjectionTransforms = view.GetModelToProjectionTransforms();
        }
        catch (Exception ex)
        {
            ValidationLog.Write($"Skipped overlay transform for view {view.Name}: {ex.Message}");
            yield break;
        }

        if (modelToProjectionTransforms.Count == 0) yield break;

        foreach (SpatialElement room in new FilteredElementCollector(doc, view.Id)
                     .OfCategory(BuiltInCategory.OST_Rooms)
                     .WhereElementIsNotElementType()
                     .Cast<SpatialElement>())
        {
            string elementId = room.Id.Value.ToString();
            if (!mappingsByElementId.TryGetValue(elementId, out RoomMappingDto? mapping)) continue;

            IReadOnlyList<XYZ> boundary = GetRoomBoundaryXyz(room);
            if (boundary.Count < 3) continue;

            List<PlanPointDto> sheetPolygon = new();
            foreach (XYZ modelPoint in boundary)
            {
                Transform modelToProjection = PickModelToProjectionTransform(modelToProjectionTransforms, modelPoint);
                XYZ projectionPoint = modelToProjection.OfPoint(modelPoint);
                XYZ sheetPoint = projectionToSheet.OfPoint(projectionPoint);
                sheetPolygon.Add(new PlanPointDto(Math.Round(sheetPoint.X, 6), Math.Round(sheetPoint.Y, 6)));
            }

            if (sheetPolygon.Count < 3) continue;
            PlanBoundsDto bbox = CalculateTightBounds(sheetPolygon);
            List<PlanPointDto> normalized = sheetPolygon
                .Select(point => NormalizeSheetPoint(point, sheetBounds))
                .ToList();

            yield return new RevitRoomOverlayDto(
                Room_Id: mapping.Room_Id,
                Bim_Photo_Room_Id: mapping.Bim_Photo_Room_Id,
                Source_View_Id: view.Id.Value.ToString(),
                Viewport_Element_Id: viewport.Id.Value.ToString(),
                Polygon: sheetPolygon,
                Normalized_Polygon: normalized,
                Bbox: bbox);
        }
    }

    private static Transform PickModelToProjectionTransform(
        IList<TransformWithBoundary> transforms,
        XYZ modelPoint)
    {
        foreach (TransformWithBoundary transformWithBoundary in transforms)
        {
            if (CurveLoopContainsPoint(transformWithBoundary.GetBoundary(), modelPoint))
            {
                return transformWithBoundary.GetModelToProjectionTransform();
            }
        }

        return transforms[0].GetModelToProjectionTransform();
    }

    private static bool CurveLoopContainsPoint(CurveLoop boundary, XYZ point)
    {
        List<XYZ> points = new();
        foreach (Curve curve in boundary)
        {
            foreach (XYZ tessellatedPoint in curve.Tessellate())
            {
                AddXyzPoint(points, tessellatedPoint);
            }
        }

        if (points.Count < 3) return false;

        bool inside = false;
        for (int currentIndex = 0, previousIndex = points.Count - 1;
             currentIndex < points.Count;
             previousIndex = currentIndex++)
        {
            XYZ current = points[currentIndex];
            XYZ previous = points[previousIndex];
            bool crossesY = current.Y > point.Y != previous.Y > point.Y;
            if (!crossesY) continue;

            double denominator = previous.Y - current.Y;
            if (Math.Abs(denominator) < 0.000001) continue;

            double intersectionX = (previous.X - current.X) * (point.Y - current.Y) / denominator + current.X;
            if (point.X < intersectionX) inside = !inside;
        }

        return inside;
    }

    private static IReadOnlyList<XYZ> GetRoomBoundaryXyz(SpatialElement room)
    {
        SpatialElementBoundaryOptions options = new()
        {
            SpatialElementBoundaryLocation = SpatialElementBoundaryLocation.Finish
        };
        IList<IList<BoundarySegment>>? loops = room.GetBoundarySegments(options);
        if (loops == null || loops.Count == 0) return Array.Empty<XYZ>();

        IList<BoundarySegment> outerLoop = loops
            .OrderByDescending(loop => Math.Abs(SignedArea(loop.SelectMany(segment => SegmentPoints(segment.GetCurve())))))
            .First();

        List<XYZ> points = new();
        foreach (BoundarySegment segment in outerLoop)
        {
            IList<XYZ> tessellated = segment.GetCurve().Tessellate();
            foreach (XYZ point in tessellated)
            {
                AddXyzPoint(points, point);
            }
        }

        if (points.Count > 1 && points[0].DistanceTo(points[^1]) < 0.001)
        {
            points.RemoveAt(points.Count - 1);
        }

        return points;
    }

    private static ViewportBoxDto GetViewportBox(Viewport viewport)
    {
        Outline box = viewport.GetBoxOutline();
        XYZ center = viewport.GetBoxCenter();
        return new ViewportBoxDto(
            Min_X: Math.Round(box.MinimumPoint.X, 6),
            Min_Y: Math.Round(box.MinimumPoint.Y, 6),
            Max_X: Math.Round(box.MaximumPoint.X, 6),
            Max_Y: Math.Round(box.MaximumPoint.Y, 6),
            Center_X: Math.Round(center.X, 6),
            Center_Y: Math.Round(center.Y, 6),
            Rotation: viewport.Rotation.ToString());
    }

    private static SheetBounds GetSheetBounds(ViewSheet sheet)
    {
        BoundingBoxUV outline = sheet.Outline;
        return new SheetBounds(outline.Min.U, outline.Min.V, outline.Max.U, outline.Max.V);
    }

    private static PlanPointDto NormalizeSheetPoint(PlanPointDto point, SheetBounds sheetBounds)
    {
        double width = Math.Max(0.000001, sheetBounds.Width);
        double height = Math.Max(0.000001, sheetBounds.Height);
        double x = (point.X - sheetBounds.MinX) / width;
        double y = 1 - ((point.Y - sheetBounds.MinY) / height);
        return new PlanPointDto(Math.Round(x, 6), Math.Round(y, 6));
    }

    private static PlanBoundsDto CalculateTightBounds(IEnumerable<PlanPointDto> points)
    {
        List<PlanPointDto> list = points.ToList();
        double minX = list.Min(point => point.X);
        double minY = list.Min(point => point.Y);
        double maxX = list.Max(point => point.X);
        double maxY = list.Max(point => point.Y);
        return new PlanBoundsDto(
            Math.Round(minX, 6),
            Math.Round(minY, 6),
            Math.Round(maxX, 6),
            Math.Round(maxY, 6),
            Math.Round(maxX - minX, 6),
            Math.Round(maxY - minY, 6));
    }

    private static void AddXyzPoint(List<XYZ> points, XYZ point)
    {
        XYZ? previous = points.LastOrDefault();
        if (previous != null && previous.DistanceTo(point) < 0.001) return;
        points.Add(point);
    }

    private static string SanitizeFileName(string fileName)
    {
        char[] invalidChars = Path.GetInvalidFileNameChars();
        string sanitized = new(fileName.Select(character => invalidChars.Contains(character) ? '-' : character).ToArray());
        sanitized = sanitized.Trim('-', ' ', '.');
        return string.IsNullOrWhiteSpace(sanitized) ? "sheet" : sanitized;
    }

    private sealed record SheetBounds(double MinX, double MinY, double MaxX, double MaxY)
    {
        public double Width => MaxX - MinX;
        public double Height => MaxY - MinY;
    }

    private static string GetActiveLevelName(Document doc, View activeView)
    {
        if (activeView is ViewPlan viewPlan && viewPlan.GenLevel != null) return viewPlan.GenLevel.Name;
        return doc.ActiveView.Name;
    }

    private static IReadOnlyList<PlanPointDto> GetRoomBoundary(SpatialElement room)
    {
        SpatialElementBoundaryOptions options = new()
        {
            SpatialElementBoundaryLocation = SpatialElementBoundaryLocation.Finish
        };
        IList<IList<BoundarySegment>>? loops = room.GetBoundarySegments(options);
        if (loops == null || loops.Count == 0) return Array.Empty<PlanPointDto>();

        IList<BoundarySegment> outerLoop = loops
            .OrderByDescending(loop => Math.Abs(SignedArea(loop.SelectMany(segment => SegmentPoints(segment.GetCurve())))))
            .First();

        List<PlanPointDto> points = new();
        foreach (BoundarySegment segment in outerLoop)
        {
            XYZ start = segment.GetCurve().GetEndPoint(0);
            AddPoint(points, new PlanPointDto(Math.Round(start.X, 4), Math.Round(start.Y, 4)));
        }
        return points;
    }

    private static IEnumerable<XYZ> SegmentPoints(Curve curve)
    {
        yield return curve.GetEndPoint(0);
        yield return curve.GetEndPoint(1);
    }

    private static void AddPoint(List<PlanPointDto> points, PlanPointDto point)
    {
        PlanPointDto? previous = points.LastOrDefault();
        if (previous != null && Math.Abs(previous.X - point.X) < 0.001 && Math.Abs(previous.Y - point.Y) < 0.001) return;
        points.Add(point);
    }

    private static double SignedArea(IEnumerable<XYZ> xyzPoints)
    {
        List<XYZ> points = xyzPoints.ToList();
        if (points.Count < 3) return 0;
        double area = 0;
        for (int i = 0; i < points.Count; i++)
        {
            XYZ current = points[i];
            XYZ next = points[(i + 1) % points.Count];
            area += current.X * next.Y - next.X * current.Y;
        }
        return area / 2;
    }

    private static PlanPointDto GetRoomCenter(SpatialElement room, IReadOnlyList<PlanPointDto> polygon)
    {
        if (room.Location is LocationPoint locationPoint)
        {
            return new PlanPointDto(Math.Round(locationPoint.Point.X, 4), Math.Round(locationPoint.Point.Y, 4));
        }

        return new PlanPointDto(
            Math.Round(polygon.Average(point => point.X), 4),
            Math.Round(polygon.Average(point => point.Y), 4));
    }

    private static double? GetRoomAreaM2(SpatialElement room)
    {
        Parameter? area = room.get_Parameter(BuiltInParameter.ROOM_AREA);
        if (area == null || !area.HasValue) return null;
        return Math.Round(UnitUtils.ConvertFromInternalUnits(area.AsDouble(), UnitTypeId.SquareMeters), 2);
    }

    private static PlanBoundsDto CalculateBounds(IEnumerable<PlanPointDto> points)
    {
        List<PlanPointDto> list = points.ToList();
        double minX = list.Min(point => point.X);
        double minY = list.Min(point => point.Y);
        double maxX = list.Max(point => point.X);
        double maxY = list.Max(point => point.Y);
        double width = Math.Max(1, maxX - minX);
        double height = Math.Max(1, maxY - minY);
        double padding = Math.Max(width, height) * 0.08;

        minX -= padding;
        minY -= padding;
        maxX += padding;
        maxY += padding;

        return new PlanBoundsDto(
            Math.Round(minX, 4),
            Math.Round(minY, 4),
            Math.Round(maxX, 4),
            Math.Round(maxY, 4),
            Math.Round(maxX - minX, 4),
            Math.Round(maxY - minY, 4));
    }

    private static void EnsureSharedParameter(Document doc, UIApplication uiapp)
    {
        bool alreadyBound = new FilteredElementCollector(doc)
            .OfCategory(BuiltInCategory.OST_Rooms)
            .WhereElementIsNotElementType()
            .Any(element => element.LookupParameter(SharedParameterName) != null);
        if (alreadyBound) return;

        Autodesk.Revit.ApplicationServices.Application app = uiapp.Application;
        string? originalSharedParameterFile = app.SharedParametersFilename;
        string configDirectory = Path.GetDirectoryName(AddinSettings.ConfigPath)
            ?? Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        Directory.CreateDirectory(configDirectory);
        string sharedParameterFile = Path.Combine(configDirectory, "BimPhotoSyncSharedParameters.txt");
        EnsureSharedParameterFile(sharedParameterFile);

        try
        {
            app.SharedParametersFilename = sharedParameterFile;
            DefinitionFile definitionFile = app.OpenSharedParameterFile()
                ?? throw new InvalidOperationException("Unable to open BIM Photo Sync shared parameter file.");
            DefinitionGroup group = definitionFile.Groups.get_Item("BIM Photo Sync")
                ?? definitionFile.Groups.Create("BIM Photo Sync");
            Definition definition = group.Definitions.get_Item(SharedParameterName)
                ?? group.Definitions.Create(new ExternalDefinitionCreationOptions(SharedParameterName, SpecTypeId.String.Text)
                {
                    GUID = new Guid(SharedParameterGuid),
                    Description = "Backend Room mapping ID for BIM Photo Sync."
                });

            CategorySet categories = app.Create.NewCategorySet();
            categories.Insert(doc.Settings.Categories.get_Item(BuiltInCategory.OST_Rooms));
            InstanceBinding binding = app.Create.NewInstanceBinding(categories);
            if (!doc.ParameterBindings.Insert(definition, binding, GroupTypeId.IdentityData))
            {
                doc.ParameterBindings.ReInsert(definition, binding, GroupTypeId.IdentityData);
            }
        }
        finally
        {
            app.SharedParametersFilename = originalSharedParameterFile;
        }
    }

    private static void EnsureSharedParameterFile(string path)
    {
        if (File.Exists(path)) return;
        File.WriteAllText(path,
            "# This is a Revit shared parameter file.\r\n" +
            "# Do not edit manually.\r\n" +
            "*META\tVERSION\tMINVERSION\r\n" +
            "META\t2\t1\r\n" +
            "*GROUP\tID\tNAME\r\n" +
            "GROUP\t1\tBIM Photo Sync\r\n" +
            "*PARAM\tGUID\tNAME\tDATATYPE\tDATACATEGORY\tGROUP\tVISIBLE\tDESCRIPTION\tUSERMODIFIABLE\r\n",
            System.Text.Encoding.UTF8);
    }
}

