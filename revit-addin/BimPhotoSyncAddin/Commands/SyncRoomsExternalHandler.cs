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

    public void Execute(UIApplication app)
    {
        try
        {
            ValidationLog.Write("SyncRoomsExternalHandler.Execute entered.");
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

            SyncFloorPlan(doc, response.Data.Room_Mappings);

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
                TaskDialog.Show("BIM Photo Sync", $"Synced {response.Data.Room_Mappings.Count} Rooms.");
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

    private static void SyncFloorPlan(Document doc, IReadOnlyList<RoomMappingDto> mappings)
    {
        if (mappings.Count == 0) return;

        View activeView = doc.ActiveView;
        string levelName = GetActiveLevelName(doc, activeView);
        Dictionary<string, RoomMappingDto> mappingsByElementId = mappings
            .Where(mapping => !string.IsNullOrWhiteSpace(mapping.Revit_Element_Id))
            .ToDictionary(mapping => mapping.Revit_Element_Id, mapping => mapping);

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
            return;
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

