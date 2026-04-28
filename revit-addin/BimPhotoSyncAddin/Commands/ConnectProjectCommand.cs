using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using BimPhotoSyncAddin.Models;
using BimPhotoSyncAddin.Services;

namespace BimPhotoSyncAddin.Commands;

[Transaction(TransactionMode.Manual)]
public sealed class ConnectProjectCommand : IExternalCommand
{
    public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
    {
        try
        {
            Document? doc = commandData.Application.ActiveUIDocument?.Document;
            string modelName = doc?.Title ?? "Untitled Revit Model";
            ValidationLog.Write($"ConnectProjectCommand calling API for model '{modelName}'.");

            ConnectProjectResponse? response = new ApiClient()
                .ConnectProjectAsync(new ConnectProjectRequest(AddinSettings.ProjectId, modelName, null))
                .GetAwaiter()
                .GetResult();

            if (response == null)
            {
                message = "Project connection failed.";
                ValidationLog.Write("ConnectProjectCommand failed: API response was null.");
                return Result.Failed;
            }

            AddinSettings.RevitModelId = response.Data.Revit_Model_Id;
            ValidationLog.Write(
                $"Connected project {response.Data.Project_Id} with revit_model_id={response.Data.Revit_Model_Id}.");
            TaskDialog.Show("BIM Photo Sync", $"Connected project.\nModel: {response.Data.Model_Name}");
            return Result.Succeeded;
        }
        catch (Exception ex)
        {
            message = ex.Message;
            ValidationLog.Write($"ConnectProjectCommand failed: {ex}");
            TaskDialog.Show("BIM Photo Sync", ex.Message);
            return Result.Failed;
        }
    }
}
