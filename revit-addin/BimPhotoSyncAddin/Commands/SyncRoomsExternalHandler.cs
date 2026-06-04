using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using BimPhotoSyncAddin.Models;
using BimPhotoSyncAddin.Services;
using System.Globalization;
using System.IO;
using System.Security.Cryptography;
using System.Text;

namespace BimPhotoSyncAddin.Commands;

public sealed class SyncRoomsExternalHandler : IExternalEventHandler
{
    private const string SharedParameterName = "BIM_PHOTO_ROOM_ID";
    private const string SharedParameterGuid = "5E6A21CE-7829-4A8A-A354-448246AD687D";
    private sealed record FloorPlanSectionBoxResult(BoundingBoxXYZ? SectionBox, string Diagnostic);
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
                RevitSyncOperation.FloorPlans => $"Synced {SyncFloorPlans(doc, response.Data.Room_Mappings)} Revit Floor Plan views.",
                RevitSyncOperation.Sheets => $"Synced {SyncSheets(doc, response.Data.Room_Mappings)} Revit Sheets.",
                RevitSyncOperation.Model3D => Sync3DModel(doc),
                _ => "Room sync complete. Use Sync Floor Plans or Sync Sheets for drawing sync."
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
        catch (TaskCanceledException ex)
        {
            ValidationLog.Write($"SyncRoomsExternalHandler timed out: {ex}");
            TaskDialog.Show(
                "BIM Photo Sync",
                $"API request timed out after {AddinSettings.HttpTimeoutSeconds} seconds.\n" +
                "Large Revit models can take longer. Increase HttpTimeoutSeconds in %APPDATA%\\BimPhotoSync\\config.json and try again.");
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

        int floorPlanRoomCount = SyncFloorPlan(doc, activeView, mappingsByElementId);
        return floorPlanRoomCount == 0
            ? "Skipped current view sync: active view has no bounded Rooms."
            : $"Synced current view {activeView.Name} with {floorPlanRoomCount} Room overlays.";
    }

    private static int SyncFloorPlans(Document doc, IReadOnlyList<RoomMappingDto> mappings)
    {
        if (mappings.Count == 0) return 0;
        if (string.IsNullOrWhiteSpace(AddinSettings.ProjectId)) return 0;

        Dictionary<string, RoomMappingDto> mappingsByElementId = BuildMappingsByElementId(mappings);
        if (mappingsByElementId.Count == 0) return 0;

        List<ViewPlan> floorPlans = new FilteredElementCollector(doc)
            .OfClass(typeof(ViewPlan))
            .Cast<ViewPlan>()
            .Where(view => IsCanonicalFloorPlanView(doc, view))
            .OrderBy(view => view.GenLevel?.Elevation ?? 0)
            .ThenBy(view => view.Name)
            .ToList();

        if (floorPlans.Count == 0)
        {
            ValidationLog.Write("Skipped floor plan sync: no canonical Floor Plan views were found.");
            return 0;
        }

        new ApiClient()
            .ClearFloorPlansAsync(AddinSettings.ProjectId)
            .GetAwaiter()
            .GetResult();

        int syncedCount = 0;
        foreach (ViewPlan floorPlan in floorPlans)
        {
            try
            {
                if (SyncFloorPlan(doc, floorPlan, mappingsByElementId) > 0)
                {
                    syncedCount++;
                }
            }
            catch (Exception ex)
            {
                ValidationLog.Write($"Skipped floor plan {floorPlan.Name}: {ex.Message}");
            }
        }

        if (syncedCount == 0)
        {
            ValidationLog.Write("Skipped floor plan sync: no Floor Plan views with bounded Rooms were synced.");
            return 0;
        }

        ValidationLog.Write($"Synced {syncedCount} floor plan views.");
        return syncedCount;
    }

    private static int SyncFloorPlan(Document doc, View view, IReadOnlyDictionary<string, RoomMappingDto> mappingsByElementId)
    {
        if (mappingsByElementId.Count == 0) return 0;

        string levelName = GetViewLevelName(doc, view);
        Transform? modelToViewTransform = GetModelToViewTransform(view);

        List<FloorPlanRoomDto> planRooms = new();
        foreach (SpatialElement room in new FilteredElementCollector(doc, view.Id)
                     .OfCategory(BuiltInCategory.OST_Rooms)
                     .WhereElementIsNotElementType()
                     .Cast<SpatialElement>())
        {
            string elementId = room.Id.Value.ToString();
            if (!mappingsByElementId.TryGetValue(elementId, out RoomMappingDto? mapping)) continue;

            IReadOnlyList<PlanPointDto> polygon = GetRoomBoundary(room, modelToViewTransform);
            IReadOnlyList<PlanPointDto> modelPolygon = GetRoomBoundary(room);
            if (polygon.Count < 3 || modelPolygon.Count < 3) continue;

            PlanPointDto center = GetRoomCenter(room, polygon, modelToViewTransform);
            PlanPointDto modelCenter = GetRoomCenter(room, modelPolygon);
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
                Polygon: polygon,
                Model_Center: modelCenter,
                Model_Polygon: modelPolygon));
        }

        if (planRooms.Count == 0)
        {
            ValidationLog.Write($"Skipped floor plan sync: {view.Name} has no bounded Rooms.");
            return 0;
        }

        PlanBoundsDto bounds = GetViewPlanBounds(view, modelToViewTransform) ?? CalculateBounds(planRooms.SelectMany(room => room.Polygon));
        SheetAssetDto? asset = ExportAndUploadViewImage(doc, view, $"{levelName}_{view.Name}", bounds);
        SyncFloorPlanResponse? floorPlanResponse = new ApiClient()
            .SyncFloorPlanAsync(new SyncFloorPlanRequest(
                AddinSettings.ProjectId,
                AddinSettings.RevitModelId,
                levelName,
                view.Name,
                view.Id.Value.ToString(),
                bounds,
                asset,
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

    private static string Sync3DModel(Document doc)
    {
        if (string.IsNullOrWhiteSpace(AddinSettings.ProjectId))
        {
            return "Skipped 3D model sync: Project ID is not configured.";
        }

        List<ViewPlan> floorPlans = new FilteredElementCollector(doc)
            .OfClass(typeof(ViewPlan))
            .Cast<ViewPlan>()
            .Where(view => IsCanonicalFloorPlanView(doc, view))
            .OrderBy(view => view.GenLevel?.Elevation ?? 0)
            .ThenBy(view => view.Name)
            .ToList();

        if (floorPlans.Count == 0)
        {
            return "Skipped 3D model sync: no canonical Floor Plan views were found.";
        }

        int syncedCount = 0;
        foreach (ViewPlan floorPlan in floorPlans)
        {
            try
            {
                View3D? exportView = GetOrCreateFloorPlanSection3DView(doc, floorPlan, out string sectionDiagnostics);
                ValidationLog.Write(sectionDiagnostics);
                if (exportView == null)
                {
                    continue;
                }

                string result = SyncSingle3DModel(doc, exportView, floorPlan.Name, floorPlan.Id.Value.ToString());
                ValidationLog.Write(result);
                if (result.StartsWith("Synced 3D model ", StringComparison.Ordinal))
                {
                    syncedCount++;
                }
            }
            catch (Exception ex)
            {
                ValidationLog.Write($"Skipped 3D model sync for {floorPlan.Name}: {ex.Message}");
            }
        }

        return syncedCount == 0
            ? "Skipped 3D model sync: no Floor Plan section models could be exported."
            : $"Synced {syncedCount} Floor Plan section 3D models.";
    }

    private static string SyncSingle3DModel(Document doc, View3D view, string displayViewName, string sourceViewId)
    {
        byte[] bytes = Encoding.UTF8.GetBytes(ExportObj(doc, view));
        string checksum = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        string assetName = $"{doc.Title}_{displayViewName}_3d";
        PresignModelAssetResponse? presign = new ApiClient()
            .PresignModelAssetAsync(new PresignModelAssetRequest(
                AddinSettings.ProjectId,
                "text/plain",
                bytes.LongLength,
                assetName,
                checksum))
            .GetAwaiter()
            .GetResult();

        if (presign == null)
        {
            return "Skipped 3D model sync: upload presign failed.";
        }

        new ApiClient()
            .UploadBytesAsync(presign.Data.Presigned_Url, "text/plain", bytes)
            .GetAwaiter()
            .GetResult();

        SyncModelAssetResponse? response = new ApiClient()
            .SyncModelAssetAsync(new SyncModelAssetRequest(
                AddinSettings.ProjectId,
                AddinSettings.RevitModelId,
                displayViewName,
                sourceViewId,
                "OBJ",
                new SheetAssetDto(presign.Data.Object_Key, "text/plain", null, null),
                bytes.LongLength,
                checksum))
            .GetAwaiter()
            .GetResult();

        return response == null
            ? "3D model uploaded but metadata sync returned no response."
            : $"Synced 3D model {displayViewName} ({Math.Round(bytes.LongLength / 1024.0 / 1024.0, 2)} MB).";
    }

    private static View3D? GetOrCreateFloorPlanSection3DView(Document doc, ViewPlan floorPlan, out string diagnostics)
    {
        FloorPlanSectionBoxResult sectionResult = BuildFloorPlanSectionBox(doc, floorPlan);
        diagnostics = sectionResult.Diagnostic;
        if (sectionResult.SectionBox == null) return null;

        string viewName = BuildFloorPlan3DViewName(floorPlan);
        View3D? view = FindMatching3DView(doc, viewName);
        ViewFamilyType? viewFamilyType = view == null
            ? new FilteredElementCollector(doc)
            .OfClass(typeof(ViewFamilyType))
            .Cast<ViewFamilyType>()
            .FirstOrDefault(type => type.ViewFamily == ViewFamily.ThreeDimensional)
            : null;
        if (view == null && viewFamilyType == null)
        {
            diagnostics = $"{diagnostics} 3D view creation skipped: no 3D ViewFamilyType is available.";
            return null;
        }

        bool reusedView = view != null;
        using Transaction transaction = new(doc, reusedView
            ? "BIM Photo Sync update 3D floor section"
            : "BIM Photo Sync create 3D floor section");
        transaction.Start();
        view ??= View3D.CreateIsometric(doc, viewFamilyType!.Id);
        if (!reusedView)
        {
            view.Name = viewName;
        }

        view.SetSectionBox(sectionResult.SectionBox);
        view.IsSectionBoxActive = true;
        TryConfigure3DExportView(view);
        transaction.Commit();
        diagnostics = $"{diagnostics} {(reusedView ? "Reused" : "Created")} 3D export view {view.Name} ({view.Id.Value}).";
        return view;
    }

    private static void TryConfigure3DExportView(View3D view)
    {
        try
        {
            if (view.ViewTemplateId != ElementId.InvalidElementId)
            {
                view.ViewTemplateId = ElementId.InvalidElementId;
            }

            view.DetailLevel = ViewDetailLevel.Medium;
            view.DisplayStyle = DisplayStyle.Shading;
        }
        catch (Exception ex) when (ex is Autodesk.Revit.Exceptions.ApplicationException or InvalidOperationException)
        {
            ValidationLog.Write($"3D export view display settings skipped for {view.Name}: {ex.Message}");
        }
    }

    private static string BuildFloorPlan3DViewName(ViewPlan floorPlan)
    {
        string desiredName = $"BPS 3D - {floorPlan.Name}";
        return desiredName.Length > 80 ? desiredName[..80] : desiredName;
    }

    private static View3D? FindMatching3DView(Document doc, string viewName)
    {
        return new FilteredElementCollector(doc)
            .OfClass(typeof(View3D))
            .Cast<View3D>()
            .Where(view => !view.IsTemplate)
            .FirstOrDefault(view => string.Equals(view.Name, viewName, StringComparison.OrdinalIgnoreCase));
    }

    private static FloorPlanSectionBoxResult BuildFloorPlanSectionBox(Document doc, ViewPlan floorPlan)
    {
        BoundingBoxXYZ? cropBounds = TryGetFloorPlanCropModelBounds(floorPlan);
        List<SpatialElement> viewRooms = new FilteredElementCollector(doc, floorPlan.Id)
            .OfCategory(BuiltInCategory.OST_Rooms)
            .WhereElementIsNotElementType()
            .Cast<SpatialElement>()
            .Where(IsBoundedRoom)
            .ToList();
        BoundingBoxXYZ? viewRoomBounds = BuildRoomBounds(viewRooms);
        if (viewRoomBounds != null)
        {
            BoundingBoxXYZ combinedBounds = CombineBoundingBoxes(cropBounds, viewRoomBounds) ?? CloneBoundingBox(viewRoomBounds);
            return CreateFloorPlanSectionBoxResult(
                doc,
                floorPlan,
                combinedBounds,
                $"3D section {floorPlan.Name}: using view-scoped room bounds from {viewRooms.Count} rooms{DescribeCropBounds(cropBounds)}.");
        }

        List<SpatialElement> levelRooms = new FilteredElementCollector(doc)
            .OfCategory(BuiltInCategory.OST_Rooms)
            .WhereElementIsNotElementType()
            .Cast<SpatialElement>()
            .Where(IsBoundedRoom)
            .Where(room => room.LevelId == floorPlan.GenLevel?.Id)
            .ToList();
        if (levelRooms.Count > 0)
        {
            List<SpatialElement> intersectingCropRooms = cropBounds == null
                ? levelRooms
                : levelRooms.Where(room => RoomIntersectsBounds(room, cropBounds)).ToList();
            List<SpatialElement> fallbackRooms = intersectingCropRooms.Count > 0 ? intersectingCropRooms : levelRooms;
            BoundingBoxXYZ? levelRoomBounds = BuildRoomBounds(fallbackRooms);
            if (levelRoomBounds != null)
            {
                BoundingBoxXYZ combinedBounds = CombineBoundingBoxes(cropBounds, levelRoomBounds) ?? CloneBoundingBox(levelRoomBounds);
                string cropDiagnostic = cropBounds == null
                    ? " without crop bounds."
                    : intersectingCropRooms.Count > 0
                        ? $"; crop intersection kept {intersectingCropRooms.Count} of {levelRooms.Count} same-level rooms."
                        : $"; crop bounds were available but did not intersect any same-level room boxes, so all {levelRooms.Count} same-level rooms were used.";
                return CreateFloorPlanSectionBoxResult(
                    doc,
                    floorPlan,
                    combinedBounds,
                    $"3D section {floorPlan.Name}: view-scoped room collection returned 0 bounded rooms. Using same-level document fallback for {floorPlan.GenLevel?.Name ?? floorPlan.Name} from {fallbackRooms.Count} rooms{cropDiagnostic}");
            }
        }

        if (cropBounds != null)
        {
            return CreateFloorPlanSectionBoxResult(
                doc,
                floorPlan,
                cropBounds,
                $"3D section {floorPlan.Name}: using crop-box fallback because view-scoped rooms returned 0 bounded rooms and same-level document fallback found no bounded room boxes.");
        }

        return new FloorPlanSectionBoxResult(
            null,
            $"Skipped 3D model sync for {floorPlan.Name}: no bounded rooms were found in view scope or same-level document fallback, and no crop box was available.");
    }

    private static FloorPlanSectionBoxResult CreateFloorPlanSectionBoxResult(
        Document doc,
        ViewPlan floorPlan,
        BoundingBoxXYZ combinedBounds,
        string diagnostic)
    {
        double padding = UnitUtils.ConvertToInternalUnits(2.5, UnitTypeId.Meters);
        double verticalPadding = UnitUtils.ConvertToInternalUnits(0.35, UnitTypeId.Meters);
        double baseElevation = floorPlan.GenLevel?.Elevation ?? combinedBounds.Min.Z;
        double topElevation = FindNextLevelElevation(doc, baseElevation)
            ?? baseElevation + UnitUtils.ConvertToInternalUnits(4.2, UnitTypeId.Meters);

        BoundingBoxXYZ sectionBox = new()
        {
            Transform = Transform.Identity,
            Min = new XYZ(combinedBounds.Min.X - padding, combinedBounds.Min.Y - padding, baseElevation - verticalPadding),
            Max = new XYZ(combinedBounds.Max.X + padding, combinedBounds.Max.Y + padding, topElevation + verticalPadding)
        };
        return new FloorPlanSectionBoxResult(
            sectionBox,
            $"{diagnostic} Section box XY=({Math.Round(sectionBox.Min.X, 2)}, {Math.Round(sectionBox.Min.Y, 2)}) -> ({Math.Round(sectionBox.Max.X, 2)}, {Math.Round(sectionBox.Max.Y, 2)}), Z={Math.Round(sectionBox.Min.Z, 2)} -> {Math.Round(sectionBox.Max.Z, 2)}.");
    }

    private static BoundingBoxXYZ? TryGetFloorPlanCropModelBounds(ViewPlan floorPlan)
    {
        try
        {
            BoundingBoxXYZ? cropBox = floorPlan.CropBox;
            if (cropBox == null) return null;

            List<XYZ> corners = GetCropBoxModelCorners(cropBox).ToList();
            if (corners.Count == 0) return null;

            return new BoundingBoxXYZ
            {
                Transform = Transform.Identity,
                Min = new XYZ(corners.Min(point => point.X), corners.Min(point => point.Y), corners.Min(point => point.Z)),
                Max = new XYZ(corners.Max(point => point.X), corners.Max(point => point.Y), corners.Max(point => point.Z))
            };
        }
        catch (Exception ex)
        {
            ValidationLog.Write($"Could not use crop bounds for 3D section {floorPlan.Name}: {ex.Message}");
            return null;
        }
    }

    private static BoundingBoxXYZ CloneBoundingBox(BoundingBoxXYZ source)
    {
        return new BoundingBoxXYZ
        {
            Transform = source.Transform,
            Min = source.Min,
            Max = source.Max
        };
    }

    private static BoundingBoxXYZ? BuildRoomBounds(IEnumerable<SpatialElement> rooms)
    {
        BoundingBoxXYZ? bounds = null;
        foreach (SpatialElement room in rooms)
        {
            BoundingBoxXYZ? box = room.get_BoundingBox(null);
            if (box == null) continue;

            bounds = bounds == null
                ? CloneBoundingBox(box)
                : ExpandBoundingBox(bounds, box);
        }

        return bounds;
    }

    private static BoundingBoxXYZ? CombineBoundingBoxes(BoundingBoxXYZ? first, BoundingBoxXYZ? second)
    {
        if (first == null) return second == null ? null : CloneBoundingBox(second);
        if (second == null) return CloneBoundingBox(first);

        BoundingBoxXYZ combined = CloneBoundingBox(first);
        return ExpandBoundingBox(combined, second);
    }

    private static bool RoomIntersectsBounds(SpatialElement room, BoundingBoxXYZ bounds)
    {
        BoundingBoxXYZ? roomBounds = room.get_BoundingBox(null);
        if (roomBounds == null) return false;

        return roomBounds.Max.X >= bounds.Min.X &&
               roomBounds.Min.X <= bounds.Max.X &&
               roomBounds.Max.Y >= bounds.Min.Y &&
               roomBounds.Min.Y <= bounds.Max.Y &&
               roomBounds.Max.Z >= bounds.Min.Z &&
               roomBounds.Min.Z <= bounds.Max.Z;
    }

    private static bool IsBoundedRoom(SpatialElement room)
    {
        return GetRoomAreaM2(room) > 0;
    }

    private static string DescribeCropBounds(BoundingBoxXYZ? cropBounds)
    {
        return cropBounds == null ? " without crop bounds" : " with crop bounds merged";
    }

    private static BoundingBoxXYZ ExpandBoundingBox(BoundingBoxXYZ target, BoundingBoxXYZ source)
    {
        target.Min = new XYZ(
            Math.Min(target.Min.X, source.Min.X),
            Math.Min(target.Min.Y, source.Min.Y),
            Math.Min(target.Min.Z, source.Min.Z));
        target.Max = new XYZ(
            Math.Max(target.Max.X, source.Max.X),
            Math.Max(target.Max.Y, source.Max.Y),
            Math.Max(target.Max.Z, source.Max.Z));
        return target;
    }

    private static double? FindNextLevelElevation(Document doc, double currentElevation)
    {
        return new FilteredElementCollector(doc)
            .OfClass(typeof(Level))
            .Cast<Level>()
            .Select(level => level.Elevation)
            .Where(elevation => elevation > currentElevation + 0.01)
            .OrderBy(elevation => elevation)
            .Cast<double?>()
            .FirstOrDefault();
    }

    private static string ExportObj(Document doc, View3D view)
    {
        StringBuilder builder = new();
        builder.AppendLine("# BIM Photo Sync Revit OBJ export");
        builder.AppendLine($"# Document: {doc.Title}");
        builder.AppendLine($"# View: {view.Name}");
        builder.AppendLine("s off");
        BoundingBoxXYZ? sectionBox = view.IsSectionBoxActive ? view.GetSectionBox() : null;

        Options options = new()
        {
            View = view,
            ComputeReferences = false,
            IncludeNonVisibleObjects = false
        };

        int vertexOffset = 0;
        int exportedElements = 0;
        foreach (Element element in new FilteredElementCollector(doc, view.Id).WhereElementIsNotElementType())
        {
            if (!ShouldExportModelElement(element)) continue;
            if (sectionBox != null && !ElementIntersectsSectionBox(element, sectionBox)) continue;

            try
            {
                GeometryElement? geometry = element.get_Geometry(options);
                if (geometry == null) continue;

                int before = vertexOffset;
                string safeName = SanitizeObjName(element.Category?.Name ?? element.GetType().Name);
                builder.AppendLine($"o {safeName}_{element.Id.Value}");
                AppendGeometry(builder, geometry, Transform.Identity, sectionBox, ref vertexOffset);
                if (vertexOffset > before) exportedElements++;
            }
            catch (Autodesk.Revit.Exceptions.ApplicationException ex)
            {
                ValidationLog.Write($"Skipped 3D element {element.Id.Value}: {ex.Message}");
            }
            catch (InvalidOperationException ex)
            {
                ValidationLog.Write($"Skipped 3D element {element.Id.Value}: {ex.Message}");
            }
            catch (NullReferenceException ex)
            {
                ValidationLog.Write($"Skipped 3D element {element.Id.Value}: {ex.Message}");
            }
        }

        builder.AppendLine($"# Exported elements: {exportedElements}");
        return builder.ToString();
    }

    private static bool ElementIntersectsSectionBox(Element element, BoundingBoxXYZ sectionBox)
    {
        BoundingBoxXYZ? elementBox = element.get_BoundingBox(null);
        if (elementBox == null) return true;

        Transform elementTransform = elementBox.Transform ?? Transform.Identity;
        Transform sectionTransform = sectionBox.Transform ?? Transform.Identity;
        Transform sectionInverse = sectionTransform.Inverse;
        List<XYZ> elementCornersInSection = GetBoundingBoxCorners(elementBox)
            .Select(point => sectionInverse.OfPoint(elementTransform.OfPoint(point)))
            .ToList();

        XYZ min = new(
            elementCornersInSection.Min(point => point.X),
            elementCornersInSection.Min(point => point.Y),
            elementCornersInSection.Min(point => point.Z));
        XYZ max = new(
            elementCornersInSection.Max(point => point.X),
            elementCornersInSection.Max(point => point.Y),
            elementCornersInSection.Max(point => point.Z));

        return max.X >= sectionBox.Min.X &&
               min.X <= sectionBox.Max.X &&
               max.Y >= sectionBox.Min.Y &&
               min.Y <= sectionBox.Max.Y &&
               max.Z >= sectionBox.Min.Z &&
               min.Z <= sectionBox.Max.Z;
    }

    private static IEnumerable<XYZ> GetBoundingBoxCorners(BoundingBoxXYZ box)
    {
        yield return new XYZ(box.Min.X, box.Min.Y, box.Min.Z);
        yield return new XYZ(box.Max.X, box.Min.Y, box.Min.Z);
        yield return new XYZ(box.Min.X, box.Max.Y, box.Min.Z);
        yield return new XYZ(box.Max.X, box.Max.Y, box.Min.Z);
        yield return new XYZ(box.Min.X, box.Min.Y, box.Max.Z);
        yield return new XYZ(box.Max.X, box.Min.Y, box.Max.Z);
        yield return new XYZ(box.Min.X, box.Max.Y, box.Max.Z);
        yield return new XYZ(box.Max.X, box.Max.Y, box.Max.Z);
    }

    private static bool ShouldExportModelElement(Element element)
    {
        Category? category = element.Category;
        if (category == null || category.CategoryType != CategoryType.Model) return false;
        if (element is SpatialElement) return false;

        long categoryId = category.Id.Value;
        return Exportable3DCategories.Contains(categoryId);
    }

    private static readonly HashSet<long> Exportable3DCategories = new()
    {
        (long)BuiltInCategory.OST_Walls,
        (long)BuiltInCategory.OST_Floors,
        (long)BuiltInCategory.OST_Ceilings,
        (long)BuiltInCategory.OST_Roofs,
        (long)BuiltInCategory.OST_Stairs,
        (long)BuiltInCategory.OST_Railings,
        (long)BuiltInCategory.OST_Columns,
        (long)BuiltInCategory.OST_StructuralColumns,
        (long)BuiltInCategory.OST_StructuralFraming
    };

    private static void AppendGeometry(
        StringBuilder builder,
        GeometryElement geometry,
        Transform transform,
        BoundingBoxXYZ? sectionBox,
        ref int vertexOffset)
    {
        if (geometry == null) return;

        foreach (GeometryObject geometryObject in geometry)
        {
            switch (geometryObject)
            {
                case Solid solid:
                    AppendSolid(builder, solid, transform, sectionBox, ref vertexOffset);
                    break;
                case GeometryInstance instance:
                    GeometryElement instanceGeometry = instance.GetInstanceGeometry();
                    if (instanceGeometry == null) break;

                    Transform instanceTransform = instance.Transform ?? Transform.Identity;
                    AppendGeometry(builder, instanceGeometry, transform.Multiply(instanceTransform), sectionBox, ref vertexOffset);
                    break;
            }
        }
    }

    private static void AppendSolid(
        StringBuilder builder,
        Solid solid,
        Transform transform,
        BoundingBoxXYZ? sectionBox,
        ref int vertexOffset)
    {
        if (solid.Faces == null || solid.Faces.Size == 0) return;

        foreach (Face face in solid.Faces)
        {
            if (face == null) continue;

            Mesh? mesh;
            try
            {
                mesh = face.Triangulate();
            }
            catch (Autodesk.Revit.Exceptions.ApplicationException)
            {
                continue;
            }
            catch (InvalidOperationException)
            {
                continue;
            }

            if (mesh?.Vertices == null || mesh.Vertices.Count < 3 || mesh.NumTriangles <= 0) continue;

            int faceVertexStart = vertexOffset + 1;
            int vertexCount = mesh.Vertices.Count;
            for (int i = 0; i < vertexCount; i++)
            {
                XYZ point = transform.OfPoint(mesh.Vertices[i]);
                builder.Append("v ");
                builder.Append(ObjNumber(point.X));
                builder.Append(' ');
                builder.Append(ObjNumber(point.Z));
                builder.Append(' ');
                builder.Append(ObjNumber(-point.Y));
                builder.AppendLine();
            }

            for (int i = 0; i < mesh.NumTriangles; i++)
            {
                MeshTriangle triangle = mesh.get_Triangle(i);
                if (triangle == null) continue;

                uint index0 = triangle.get_Index(0);
                uint index1 = triangle.get_Index(1);
                uint index2 = triangle.get_Index(2);
                if (index0 >= vertexCount || index1 >= vertexCount || index2 >= vertexCount) continue;

                XYZ point0 = transform.OfPoint(mesh.Vertices[(int)index0]);
                XYZ point1 = transform.OfPoint(mesh.Vertices[(int)index1]);
                XYZ point2 = transform.OfPoint(mesh.Vertices[(int)index2]);
                if (!TriangleInsideSectionBox(point0, point1, point2, sectionBox)) continue;

                builder.Append("f ");
                builder.Append(faceVertexStart + (int)index0);
                builder.Append(' ');
                builder.Append(faceVertexStart + (int)index1);
                builder.Append(' ');
                builder.Append(faceVertexStart + (int)index2);
                builder.AppendLine();
            }

            vertexOffset += vertexCount;
        }
    }

    private static bool TriangleInsideSectionBox(XYZ point0, XYZ point1, XYZ point2, BoundingBoxXYZ? sectionBox)
    {
        if (sectionBox == null) return true;

        return PointInsideSectionBox(point0, sectionBox) &&
               PointInsideSectionBox(point1, sectionBox) &&
               PointInsideSectionBox(point2, sectionBox);
    }

    private static bool PointInsideSectionBox(XYZ point, BoundingBoxXYZ sectionBox)
    {
        Transform sectionTransform = sectionBox.Transform ?? Transform.Identity;
        XYZ local = sectionTransform.Inverse.OfPoint(point);
        const double tolerance = 0.01;
        return local.X >= sectionBox.Min.X - tolerance &&
               local.X <= sectionBox.Max.X + tolerance &&
               local.Y >= sectionBox.Min.Y - tolerance &&
               local.Y <= sectionBox.Max.Y + tolerance &&
               local.Z >= sectionBox.Min.Z - tolerance &&
               local.Z <= sectionBox.Max.Z + tolerance;
    }

    private static string ObjNumber(double value)
    {
        return Math.Round(value, 6).ToString("0.######", CultureInfo.InvariantCulture);
    }

    private static string SanitizeObjName(string value)
    {
        string sanitized = new(value.Select(character => char.IsLetterOrDigit(character) ? character : '_').ToArray());
        return string.IsNullOrWhiteSpace(sanitized) ? "Element" : sanitized;
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
            SheetAssetDto? asset = ExportAndUploadPrintablePdf(doc, sheet, sheet.SheetNumber, $"sheet {sheet.SheetNumber}");
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

    private static bool IsCanonicalFloorPlanView(Document doc, ViewPlan view)
    {
        if (view.IsTemplate) return false;
        if (view.ViewType != ViewType.FloorPlan) return false;
        if (view.GenLevel == null) return false;
        if (view.GetPrimaryViewId() != ElementId.InvalidElementId) return false;
        if (doc.GetElement(view.GetTypeId()) is not ViewFamilyType viewFamilyType) return false;
        if (viewFamilyType.ViewFamily != ViewFamily.FloorPlan) return false;

        string viewTypeName = viewFamilyType.Name.Trim();
        bool defaultFloorPlanType =
            viewTypeName.Equals("Floor Plan", StringComparison.OrdinalIgnoreCase) ||
            viewTypeName.Equals("평면", StringComparison.OrdinalIgnoreCase) ||
            viewTypeName.Equals("평면도", StringComparison.OrdinalIgnoreCase);
        if (!defaultFloorPlanType) return false;

        return NormalizePlanName(view.Name) == NormalizePlanName(view.GenLevel.Name);
    }

    private static string NormalizePlanName(string value)
    {
        return new string(value.Where(char.IsLetterOrDigit).Select(char.ToUpperInvariant).ToArray());
    }

    private static SheetAssetDto? ExportAndUploadViewImage(Document doc, View view, string assetName, PlanBoundsDto bounds)
    {
        if (!view.CanBePrinted)
        {
            ValidationLog.Write($"floor plan {view.Name} is not printable. Metadata will sync without an image asset.");
            return null;
        }

        string exportDirectory = Path.Combine(Path.GetTempPath(), "BimPhotoSync", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(exportDirectory);
        string fileStem = SanitizeFileName(assetName);
        const int pixelWidth = 2400;
        int pixelHeight = Math.Max(1, (int)Math.Round(pixelWidth * (bounds.Height / Math.Max(0.000001, bounds.Width))));
        ImageExportOptions options = new()
        {
            ExportRange = ExportRange.SetOfViews,
            FilePath = Path.Combine(exportDirectory, fileStem),
            FitDirection = FitDirectionType.Horizontal,
            HLRandWFViewsFileType = ImageFileType.PNG,
            ImageResolution = ImageResolution.DPI_150,
            PixelSize = pixelWidth,
            ShadowViewsFileType = ImageFileType.PNG,
            ZoomType = ZoomFitType.FitToPage
        };
        options.SetViewsAndSheets(new List<ElementId> { view.Id });

        try
        {
            string[] before = Directory.GetFiles(exportDirectory, "*.png");
            doc.ExportImage(options);

            FileInfo? exportedFile = Directory.GetFiles(exportDirectory, "*.png")
                .Select(path => new FileInfo(path))
                .Where(file => !before.Contains(file.FullName, StringComparer.OrdinalIgnoreCase))
                .OrderByDescending(file => file.LastWriteTimeUtc)
                .FirstOrDefault();

            if (exportedFile == null || !exportedFile.Exists)
            {
                ValidationLog.Write($"Image export produced no file for floor plan {view.Name}.");
                return null;
            }

            byte[] bytes = File.ReadAllBytes(exportedFile.FullName);
            PresignDrawingAssetResponse? presign = new ApiClient()
                .PresignDrawingAssetAsync(new PresignDrawingAssetRequest(
                    AddinSettings.ProjectId,
                    "image/png",
                    bytes.LongLength,
                    assetName,
                    null))
                .GetAwaiter()
                .GetResult();

            if (presign == null)
            {
                ValidationLog.Write($"Drawing presign returned null for floor plan {view.Name}.");
                return null;
            }

            new ApiClient()
                .UploadBytesAsync(presign.Data.Presigned_Url, "image/png", bytes)
                .GetAwaiter()
                .GetResult();

            return new SheetAssetDto(
                Object_Key: presign.Data.Object_Key,
                Mime_Type: "image/png",
                Width_Px: pixelWidth,
                Height_Px: pixelHeight);
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

    private static SheetAssetDto? ExportAndUploadPrintablePdf(Document doc, View printableView, string assetName, string label)
    {
        if (!printableView.CanBePrinted)
        {
            ValidationLog.Write($"{label} is not printable. Metadata will sync without a PDF asset.");
            return null;
        }

        string exportDirectory = Path.Combine(Path.GetTempPath(), "BimPhotoSync", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(exportDirectory);
        string fileStem = SanitizeFileName(assetName);
        PDFExportOptions options = new()
        {
            Combine = false,
            FileName = fileStem
        };

        try
        {
            string[] before = Directory.GetFiles(exportDirectory, "*.pdf");
            bool exported = doc.Export(exportDirectory, new List<ElementId> { printableView.Id }, options);
            if (!exported)
            {
                ValidationLog.Write($"PDF export returned false for {label}.");
                return null;
            }

            FileInfo? exportedFile = Directory.GetFiles(exportDirectory, "*.pdf")
                .Select(path => new FileInfo(path))
                .Where(file => !before.Contains(file.FullName, StringComparer.OrdinalIgnoreCase))
                .OrderByDescending(file => file.LastWriteTimeUtc)
                .FirstOrDefault();

            if (exportedFile == null || !exportedFile.Exists)
            {
                ValidationLog.Write($"PDF export produced no file for {label}.");
                return null;
            }

            byte[] bytes = File.ReadAllBytes(exportedFile.FullName);
            PresignDrawingAssetResponse? presign = new ApiClient()
                .PresignDrawingAssetAsync(new PresignDrawingAssetRequest(
                    AddinSettings.ProjectId,
                    "application/pdf",
                    bytes.LongLength,
                    assetName,
                    null))
                .GetAwaiter()
                .GetResult();

            if (presign == null)
            {
                ValidationLog.Write($"Drawing presign returned null for {label}.");
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

    private static string GetViewLevelName(Document doc, View view)
    {
        if (view is ViewPlan viewPlan && viewPlan.GenLevel != null) return viewPlan.GenLevel.Name;
        return view.Name;
    }

    private static IReadOnlyList<PlanPointDto> GetRoomBoundary(SpatialElement room, Transform? modelToViewTransform = null)
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
            foreach (XYZ modelPoint in segment.GetCurve().Tessellate())
            {
                AddPoint(points, ToPlanPoint(modelPoint, modelToViewTransform));
            }
        }

        if (points.Count > 1)
        {
            PlanPointDto first = points[0];
            PlanPointDto last = points[^1];
            if (Math.Abs(first.X - last.X) < 0.001 && Math.Abs(first.Y - last.Y) < 0.001)
            {
                points.RemoveAt(points.Count - 1);
            }
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

    private static PlanPointDto ToPlanPoint(XYZ modelPoint, Transform? modelToViewTransform = null)
    {
        XYZ point = modelToViewTransform == null ? modelPoint : modelToViewTransform.OfPoint(modelPoint);
        return new PlanPointDto(Math.Round(point.X, 4), Math.Round(point.Y, 4));
    }

    private static PlanPointDto GetRoomCenter(SpatialElement room, IReadOnlyList<PlanPointDto> polygon, Transform? modelToViewTransform = null)
    {
        if (room.Location is LocationPoint locationPoint)
        {
            return ToPlanPoint(locationPoint.Point, modelToViewTransform);
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

    private static Transform? GetModelToViewTransform(View view)
    {
        try
        {
            IList<TransformWithBoundary> transforms = view.GetModelToProjectionTransforms();
            if (transforms.Count > 0)
            {
                return transforms[0].GetModelToProjectionTransform();
            }
        }
        catch (Exception ex)
        {
            ValidationLog.Write($"Model-to-projection transform unavailable for {view.Name}: {ex.Message}");
        }

        BoundingBoxXYZ? cropBox = view.CropBox;
        return cropBox?.Transform.Inverse;
    }

    private static PlanBoundsDto? GetViewPlanBounds(View view, Transform? modelToViewTransform)
    {
        BoundingBoxXYZ? cropBox = view.CropBox;
        if (cropBox == null) return null;

        PlanBoundsDto bounds = CalculateTightBounds(GetCropBoxModelCorners(cropBox)
            .Select(point => ToPlanPoint(point, modelToViewTransform)));
        return bounds.Width <= 0.001 || bounds.Height <= 0.001 ? null : bounds;
    }

    private static IEnumerable<XYZ> GetCropBoxModelCorners(BoundingBoxXYZ cropBox)
    {
        double minX = Math.Min(cropBox.Min.X, cropBox.Max.X);
        double minY = Math.Min(cropBox.Min.Y, cropBox.Max.Y);
        double maxX = Math.Max(cropBox.Min.X, cropBox.Max.X);
        double maxY = Math.Max(cropBox.Min.Y, cropBox.Max.Y);
        double z = cropBox.Min.Z;

        yield return cropBox.Transform.OfPoint(new XYZ(minX, minY, z));
        yield return cropBox.Transform.OfPoint(new XYZ(maxX, minY, z));
        yield return cropBox.Transform.OfPoint(new XYZ(maxX, maxY, z));
        yield return cropBox.Transform.OfPoint(new XYZ(minX, maxY, z));
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

