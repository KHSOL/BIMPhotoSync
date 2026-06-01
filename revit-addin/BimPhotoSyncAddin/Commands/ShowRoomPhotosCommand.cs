using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;

namespace BimPhotoSyncAddin.Commands;

[Transaction(TransactionMode.Manual)]
public sealed class ShowRoomPhotosCommand : IExternalCommand
{
    public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
    {
        var paneId = new DockablePaneId(BimPhotoSyncApp.PaneGuid);
        DockablePane pane = commandData.Application.GetDockablePane(paneId);
        pane.Show();
        return Result.Succeeded;
    }
}
