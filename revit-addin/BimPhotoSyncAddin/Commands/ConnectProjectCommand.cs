using Autodesk.Revit.Attributes;
using Autodesk.Revit.DB;
using Autodesk.Revit.UI;
using BimPhotoSyncAddin.Services;

namespace BimPhotoSyncAddin.Commands;

[Transaction(TransactionMode.Manual)]
public sealed class ConnectProjectCommand : IExternalCommand
{
    public Result Execute(ExternalCommandData commandData, ref string message, ElementSet elements)
    {
        var dialog = new TaskDialog("BIM Photo Sync")
        {
            MainInstruction = "Project connection",
            MainContent = $"Config path: {AddinSettings.ConfigPath}\n\nSet ApiBaseUrl, JwtToken, ProjectId, and optional RevitModelId there for this MVP. Production should replace this with a login dialog."
        };
        dialog.AddCommandLink(TaskDialogCommandLinkId.CommandLink1, $"API: {AddinSettings.ApiBaseUrl}");
        dialog.AddCommandLink(TaskDialogCommandLinkId.CommandLink2, string.IsNullOrWhiteSpace(AddinSettings.ProjectId) ? "Project ID not set" : AddinSettings.ProjectId);
        dialog.Show();
        return Result.Succeeded;
    }
}
