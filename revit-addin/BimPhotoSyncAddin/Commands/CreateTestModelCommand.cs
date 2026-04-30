using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using BimPhotoSyncAddin.Services;

namespace BimPhotoSyncAddin.Commands;

[Transaction(TransactionMode.Manual)]
public sealed class CreateTestModelCommand : IExternalCommand
{
    public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
    {
        ValidationLog.Write("CreateTestModelCommand.Execute entered.");
#if DEBUG
        if (BimPhotoSyncApp.CreateTestModelHandler == null || BimPhotoSyncApp.CreateTestModelEvent == null)
        {
            message = "Create test model ExternalEvent is not initialized.";
            ValidationLog.Write("CreateTestModelCommand failed: ExternalEvent is not initialized.");
            return Result.Failed;
        }

        BimPhotoSyncApp.CreateTestModelHandler.UiApplication = commandData.Application;
        BimPhotoSyncApp.CreateTestModelEvent.Raise();
        ValidationLog.Write("CreateTestModelCommand raised ExternalEvent.");
        return Result.Succeeded;
#else
        message = "Create Test Model is only available in Debug builds.";
        return Result.Cancelled;
#endif
    }
}
