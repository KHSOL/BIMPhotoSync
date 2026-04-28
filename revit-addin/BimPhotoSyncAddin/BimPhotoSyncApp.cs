using Autodesk.Revit.UI;
using BimPhotoSyncAddin.Commands;
using BimPhotoSyncAddin.Panels;
using BimPhotoSyncAddin.Services;

namespace BimPhotoSyncAddin;

public class BimPhotoSyncApp : IExternalApplication
{
    public static readonly Guid PaneGuid = new("03B6AE6F-4984-42D7-8C3E-9D5A733CF6AA");
    public static PhotoDockPane? Pane { get; private set; }
    public static ExternalEvent? SyncRoomsEvent { get; private set; }
    public static SyncRoomsExternalHandler? SyncRoomsHandler { get; private set; }

    public Result OnStartup(UIControlledApplication app)
    {
        AddinSettings.Load();
        const string tabName = "BIM Photo Sync";
        try
        {
            app.CreateRibbonTab(tabName);
        }
        catch
        {
            // Tab may already exist after reload.
        }

        RibbonPanel panel = app.CreateRibbonPanel(tabName, "Room Photos");
        panel.AddItem(new PushButtonData(
            "ConnectProject",
            "Connect",
            typeof(BimPhotoSyncApp).Assembly.Location,
            typeof(ConnectProjectCommand).FullName));
        panel.AddItem(new PushButtonData(
            "SyncRooms",
            "Sync Rooms",
            typeof(BimPhotoSyncApp).Assembly.Location,
            typeof(SyncRoomsCommand).FullName));

        Pane = new PhotoDockPane();
        var paneId = new DockablePaneId(PaneGuid);
        app.RegisterDockablePane(paneId, "BIM Photo Sync", Pane);

        SyncRoomsHandler = new SyncRoomsExternalHandler();
        SyncRoomsEvent = ExternalEvent.Create(SyncRoomsHandler);

        app.SelectionChanged += (_, args) => SelectionRefresh.Handle(args);
        return Result.Succeeded;
    }

    public Result OnShutdown(UIControlledApplication app)
    {
        return Result.Succeeded;
    }
}
