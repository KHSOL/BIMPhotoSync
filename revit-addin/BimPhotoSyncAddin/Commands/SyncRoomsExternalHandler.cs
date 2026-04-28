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

