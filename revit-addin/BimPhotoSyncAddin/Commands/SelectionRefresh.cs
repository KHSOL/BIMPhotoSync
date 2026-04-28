using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using Autodesk.Revit.UI.Events;
using BimPhotoSyncAddin.Services;

namespace BimPhotoSyncAddin.Commands;

public static class SelectionRefresh
{
    private const string SharedParameterName = "BIM_PHOTO_ROOM_ID";

    public static async void Handle(SelectionChangedEventArgs args)
    {
        try
        {
            Document doc = args.GetDocument();
            ElementId? selectedId = args.GetSelectedElements().FirstOrDefault();
            if (selectedId == null) return;
            ValidationLog.Write($"SelectionChanged selected element: {selectedId.Value}");

            Element? element = doc.GetElement(selectedId);
            if (element?.Category?.Id.Value != (long)BuiltInCategory.OST_Rooms) return;

            string? bimPhotoRoomId = element.LookupParameter(SharedParameterName)?.AsString();
            if (string.IsNullOrWhiteSpace(bimPhotoRoomId))
            {
                ValidationLog.Write("Selected Room has no BIM_PHOTO_ROOM_ID.");
                BimPhotoSyncApp.Pane?.ShowMessage("Selected Room has no BIM_PHOTO_ROOM_ID. Run Room Sync first.");
                return;
            }

            ValidationLog.Write($"Fetching photos for selected Room BIM_PHOTO_ROOM_ID={bimPhotoRoomId}.");
            var response = await new ApiClient().GetRoomPhotosAsync(bimPhotoRoomId);
            if (response == null)
            {
                ValidationLog.Write("Photo lookup returned null.");
                BimPhotoSyncApp.Pane?.ShowMessage("No photo lookup result.");
                return;
            }

            ValidationLog.Write($"Rendering {response.Photos.Count} photos for Room {response.Room.Bim_Photo_Room_Id}.");
            BimPhotoSyncApp.Pane?.Render(response);
        }
        catch (Exception ex)
        {
            ValidationLog.Write($"Selection refresh failed: {ex}");
            BimPhotoSyncApp.Pane?.ShowMessage(ex.Message);
        }
    }
}
