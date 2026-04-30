using Autodesk.Revit.DB;
using Autodesk.Revit.DB.Architecture;
using Autodesk.Revit.UI;
using BimPhotoSyncAddin.Services;
using System.IO;

namespace BimPhotoSyncAddin.Commands;

public sealed class CreateTestModelExternalHandler : IExternalEventHandler
{
    public UIApplication? UiApplication { get; set; }

    public void Execute(UIApplication app)
    {
        try
        {
            UIApplication uiapp = UiApplication ?? app;
            Document doc = uiapp.Application.NewProjectDocument(UnitSystem.Metric);
            string outputPath = BuildOutputPath();

            using Transaction tx = new(doc, "Create BIM Photo Sync minimal Room test model");
            tx.Start();

            Level level = GetOrCreateLevel(doc);
            WallType wallType = GetWallType(doc);
            CreateWalls(doc, level, wallType);
            doc.Regenerate();
            CreateRooms(doc, level);
            ViewPlan plan = CreatePlanView(doc, level);
            ViewSheet sheet = CreateSheet(doc, plan);

            tx.Commit();

            SaveAsOptions options = new()
            {
                OverwriteExistingFile = true
            };
            doc.SaveAs(outputPath, options);

            ValidationLog.Write($"Created minimal test model at {outputPath} with sheet {sheet.SheetNumber}.");
            TaskDialog.Show(
                "BIM Photo Sync",
                $"Created minimal Room test model.\n\nPath:\n{outputPath}\n\nOpen this RVT, then run Connect, Sync Rooms, and Sync View.");
        }
        catch (Exception ex)
        {
            ValidationLog.Write($"CreateTestModelExternalHandler failed: {ex}");
            TaskDialog.Show("BIM Photo Sync", ex.Message);
        }
    }

    public string GetName() => "BIM Photo Sync Test Model Generator";

    private static string BuildOutputPath()
    {
        string directory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
            "BimPhotoSync");
        Directory.CreateDirectory(directory);
        return Path.Combine(directory, "BPS_Minimal_Room_Test.rvt");
    }

    private static Level GetOrCreateLevel(Document doc)
    {
        Level? existing = new FilteredElementCollector(doc)
            .OfClass(typeof(Level))
            .Cast<Level>()
            .OrderBy(level => Math.Abs(level.Elevation))
            .FirstOrDefault();
        if (existing != null) return existing;

        Level created = Level.Create(doc, 0);
        created.Name = "BPS Level 1";
        return created;
    }

    private static WallType GetWallType(Document doc)
    {
        WallType? wallType = new FilteredElementCollector(doc)
            .OfClass(typeof(WallType))
            .Cast<WallType>()
            .FirstOrDefault(type => type.Kind == WallKind.Basic)
            ?? new FilteredElementCollector(doc)
                .OfClass(typeof(WallType))
                .Cast<WallType>()
                .FirstOrDefault();
        return wallType ?? throw new InvalidOperationException("No WallType is available in the Revit template.");
    }

    private static void CreateWalls(Document doc, Level level, WallType wallType)
    {
        double width = 45;
        double depth = 20;
        double height = 10;
        List<(XYZ Start, XYZ End)> segments = new()
        {
            (new XYZ(0, 0, 0), new XYZ(width, 0, 0)),
            (new XYZ(width, 0, 0), new XYZ(width, depth, 0)),
            (new XYZ(width, depth, 0), new XYZ(0, depth, 0)),
            (new XYZ(0, depth, 0), new XYZ(0, 0, 0)),
            (new XYZ(15, 0, 0), new XYZ(15, depth, 0)),
            (new XYZ(30, 0, 0), new XYZ(30, depth, 0))
        };

        foreach ((XYZ start, XYZ end) in segments)
        {
            Curve line = Line.CreateBound(start, end);
            Wall.Create(doc, line, wallType.Id, level.Id, height, 0, false, false);
        }
    }

    private static void CreateRooms(Document doc, Level level)
    {
        List<(string Number, string Name, UV Location)> rooms = new()
        {
            ("101", "Mock Bathroom", new UV(7.5, 10)),
            ("102", "Mock Bedroom", new UV(22.5, 10)),
            ("103", "Mock Living Room", new UV(37.5, 10))
        };

        foreach ((string number, string name, UV location) in rooms)
        {
            Room room = doc.Create.NewRoom(level, location);
            room.get_Parameter(BuiltInParameter.ROOM_NUMBER)?.Set(number);
            room.get_Parameter(BuiltInParameter.ROOM_NAME)?.Set(name);
        }
    }

    private static ViewPlan CreatePlanView(Document doc, Level level)
    {
        ViewFamilyType viewFamilyType = new FilteredElementCollector(doc)
            .OfClass(typeof(ViewFamilyType))
            .Cast<ViewFamilyType>()
            .FirstOrDefault(type => type.ViewFamily == ViewFamily.FloorPlan)
            ?? throw new InvalidOperationException("No Floor Plan ViewFamilyType is available in the Revit template.");

        ViewPlan plan = ViewPlan.Create(doc, viewFamilyType.Id, level.Id);
        plan.Name = "BPS Minimal L1 Plan";
        plan.Scale = 100;
        return plan;
    }

    private static ViewSheet CreateSheet(Document doc, ViewPlan plan)
    {
        ElementId titleBlockId = new FilteredElementCollector(doc)
            .OfCategory(BuiltInCategory.OST_TitleBlocks)
            .WhereElementIsElementType()
            .FirstElementId();
        if (titleBlockId == ElementId.InvalidElementId)
        {
            titleBlockId = ElementId.InvalidElementId;
        }

        ViewSheet sheet = ViewSheet.Create(doc, titleBlockId);
        sheet.SheetNumber = "BPS-101";
        sheet.Name = "BIM Photo Sync Minimal Room Test";
        Viewport.Create(doc, sheet.Id, plan.Id, new XYZ(0, 0, 0));
        return sheet;
    }
}
