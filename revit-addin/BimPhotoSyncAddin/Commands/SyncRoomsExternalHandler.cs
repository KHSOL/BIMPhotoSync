using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using BimPhotoSyncAddin.Models;
using BimPhotoSyncAddin.Services;

namespace BimPhotoSyncAddin.Commands;

public sealed class SyncRoomsExternalHandler : IExternalEventHandler
{
    private const string SharedParameterName = "BIM_PHOTO_ROOM_ID";
    public UIApplication? UiApplication { get; set; }

    public void Execute(UIApplication app)
    {
        UIApplication uiapp = UiApplication ?? app;
        Document doc = uiapp.ActiveUIDocument.Document;
        if (string.IsNullOrWhiteSpace(AddinSettings.ProjectId))
        {
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
                Revit_Element_Id: room.Id.IntegerValue.ToString(),
                Room_Number: room.get_Parameter(BuiltInParameter.ROOM_NUMBER)?.AsString(),
                Room_Name: room.get_Parameter(BuiltInParameter.ROOM_NAME)?.AsString() ?? "Unnamed Room",
                Level_Name: doc.GetElement(room.LevelId)?.Name))
            .ToList();

        SyncRoomsResponse? response = new ApiClient()
            .SyncRoomsAsync(new SyncRoomsRequest(AddinSettings.ProjectId, AddinSettings.RevitModelId, rooms))
            .GetAwaiter()
            .GetResult();

        if (response == null)
        {
            TaskDialog.Show("BIM Photo Sync", "Room sync failed.");
            return;
        }

        using Transaction tx = new(doc, "Write BIM_PHOTO_ROOM_ID");
        tx.Start();
        foreach (RoomMappingDto mapped in response.Data.Room_Mappings)
        {
            Element? element = doc.GetElement(new ElementId(int.Parse(mapped.Revit_Element_Id)));
            Parameter? parameter = element?.LookupParameter(SharedParameterName);
            if (parameter is { IsReadOnly: false })
            {
                parameter.Set(mapped.Bim_Photo_Room_Id);
            }
        }
        tx.Commit();

        TaskDialog.Show("BIM Photo Sync", $"Synced {response.Data.Room_Mappings.Count} Rooms.");
    }

    public string GetName() => "BIM Photo Sync Room Sync";
}

