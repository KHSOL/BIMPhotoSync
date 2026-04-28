using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using BimPhotoSyncAddin.Services;

namespace BimPhotoSyncAddin.Commands;

public static class SelectionRefresh
{
    private const string SharedParameterName = "BIM_PHOTO_ROOM_ID";

    public static async void Handle(SelectionChangedEventArgs args)
    {
        try
        {
            UIDocument uidoc = args.GetDocument();
            Document doc = uidoc.Document;
            ElementId? selectedId = uidoc.Selection.GetElementIds().FirstOrDefault();
            if (selectedId == null) return;
            Element? element = doc.GetElement(selectedId);
            if (element?.Category?.Id.IntegerValue != (int)BuiltInCategory.OST_Rooms) return;

            string? bimPhotoRoomId = element.LookupParameter(SharedParameterName)?.AsString();
            if (string.IsNullOrWhiteSpace(bimPhotoRoomId))
            {
                BimPhotoSyncApp.Pane?.ShowMessage("선택한 Room에 BIM_PHOTO_ROOM_ID가 없습니다. Room Sync를 먼저 실행하세요.");
                return;
            }

            var response = await new ApiClient().GetRoomPhotosAsync(bimPhotoRoomId);
            if (response == null)
            {
                BimPhotoSyncApp.Pane?.ShowMessage("사진 조회 결과가 없습니다.");
                return;
            }

            BimPhotoSyncApp.Pane?.Render(response);
        }
        catch (Exception ex)
        {
            BimPhotoSyncApp.Pane?.ShowMessage(ex.Message);
        }
    }
}

