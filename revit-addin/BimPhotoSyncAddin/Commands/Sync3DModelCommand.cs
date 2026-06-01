using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using BimPhotoSyncAddin.Services;

namespace BimPhotoSyncAddin.Commands;

[Transaction(TransactionMode.Manual)]
public sealed class Sync3DModelCommand : IExternalCommand
{
    public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
    {
        ValidationLog.Write("Sync3DModelCommand.Execute entered.");
        if (BimPhotoSyncApp.SyncRoomsHandler == null || BimPhotoSyncApp.SyncRoomsEvent == null)
        {
            message = "ExternalEvent is not initialized.";
            ValidationLog.Write("Sync3DModelCommand failed: ExternalEvent is not initialized.");
            return Result.Failed;
        }

        BimPhotoSyncApp.SyncRoomsHandler.UiApplication = commandData.Application;
        BimPhotoSyncApp.SyncRoomsHandler.Operation = RevitSyncOperation.Model3D;
        BimPhotoSyncApp.SyncRoomsEvent.Raise();
        ValidationLog.Write("Sync3DModelCommand raised ExternalEvent.");
        return Result.Succeeded;
    }
}
