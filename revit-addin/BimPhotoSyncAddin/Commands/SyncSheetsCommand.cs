using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using BimPhotoSyncAddin.Services;

namespace BimPhotoSyncAddin.Commands;

[Transaction(TransactionMode.Manual)]
public sealed class SyncSheetsCommand : IExternalCommand
{
    public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
    {
        ValidationLog.Write("SyncSheetsCommand.Execute entered.");
        if (BimPhotoSyncApp.SyncRoomsHandler == null || BimPhotoSyncApp.SyncRoomsEvent == null)
        {
            message = "ExternalEvent is not initialized.";
            ValidationLog.Write("SyncSheetsCommand failed: ExternalEvent is not initialized.");
            return Result.Failed;
        }

        BimPhotoSyncApp.SyncRoomsHandler.UiApplication = commandData.Application;
        BimPhotoSyncApp.SyncRoomsHandler.Operation = RevitSyncOperation.Sheets;
        BimPhotoSyncApp.SyncRoomsEvent.Raise();
        ValidationLog.Write("SyncSheetsCommand raised ExternalEvent.");
        return Result.Succeeded;
    }
}
