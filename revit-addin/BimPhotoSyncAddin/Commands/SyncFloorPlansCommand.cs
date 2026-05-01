using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using BimPhotoSyncAddin.Services;

namespace BimPhotoSyncAddin.Commands;

[Transaction(TransactionMode.Manual)]
public sealed class SyncFloorPlansCommand : IExternalCommand
{
    public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
    {
        ValidationLog.Write("SyncFloorPlansCommand.Execute entered.");
        if (BimPhotoSyncApp.SyncRoomsHandler == null || BimPhotoSyncApp.SyncRoomsEvent == null)
        {
            message = "ExternalEvent is not initialized.";
            ValidationLog.Write("SyncFloorPlansCommand failed: ExternalEvent is not initialized.");
            return Result.Failed;
        }

        BimPhotoSyncApp.SyncRoomsHandler.UiApplication = commandData.Application;
        BimPhotoSyncApp.SyncRoomsHandler.Operation = RevitSyncOperation.FloorPlans;
        BimPhotoSyncApp.SyncRoomsEvent.Raise();
        ValidationLog.Write("SyncFloorPlansCommand raised ExternalEvent.");
        return Result.Succeeded;
    }
}
