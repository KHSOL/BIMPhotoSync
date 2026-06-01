using Autodesk.Revit.UI;
using Autodesk.Revit.UI.Events;
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
#if DEBUG
    public static ExternalEvent? CreateTestModelEvent { get; private set; }
    public static CreateTestModelExternalHandler? CreateTestModelHandler { get; private set; }
#endif
    private static bool _autoSyncRaised;

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

        RibbonPanel projectPanel = app.CreateRibbonPanel(tabName, "Project");
        projectPanel.AddItem(new PushButtonData(
            "ConnectProject",
            "Connect\nProject",
            typeof(BimPhotoSyncApp).Assembly.Location,
            typeof(ConnectProjectCommand).FullName));

        RibbonPanel syncPanel = app.CreateRibbonPanel(tabName, "Sync");
        syncPanel.AddItem(new PushButtonData(
            "SyncRooms",
            "Rooms",
            typeof(BimPhotoSyncApp).Assembly.Location,
            typeof(SyncRoomsCommand).FullName));
        syncPanel.AddItem(new PushButtonData(
            "SyncCurrentView",
            "Current\nView",
            typeof(BimPhotoSyncApp).Assembly.Location,
            typeof(SyncCurrentViewCommand).FullName));
        syncPanel.AddItem(new PushButtonData(
            "SyncFloorPlans",
            "Floor\nPlans",
            typeof(BimPhotoSyncApp).Assembly.Location,
            typeof(SyncFloorPlansCommand).FullName));
        syncPanel.AddItem(new PushButtonData(
            "SyncSheets",
            "Sheets",
            typeof(BimPhotoSyncApp).Assembly.Location,
            typeof(SyncSheetsCommand).FullName));
        syncPanel.AddItem(new PushButtonData(
            "Sync3DModel",
            "3D\nModel",
            typeof(BimPhotoSyncApp).Assembly.Location,
            typeof(Sync3DModelCommand).FullName));
#if DEBUG
        syncPanel.AddItem(new PushButtonData(
            "CreateTestModel",
            "Create\nTest",
            typeof(BimPhotoSyncApp).Assembly.Location,
            typeof(CreateTestModelCommand).FullName));
#endif

        RibbonPanel photosPanel = app.CreateRibbonPanel(tabName, "Photos");
        photosPanel.AddItem(new PushButtonData(
            "ShowRoomPhotos",
            "Room\nPhotos",
            typeof(BimPhotoSyncApp).Assembly.Location,
            typeof(ShowRoomPhotosCommand).FullName)
        {
            ToolTip = "Open or refresh the selected Room photo timeline in the BIM Photo Sync dockable panel."
        });

        Pane = new PhotoDockPane();
        var paneId = new DockablePaneId(PaneGuid);
        app.RegisterDockablePane(paneId, "BIM Photo Sync", Pane);

        SyncRoomsHandler = new SyncRoomsExternalHandler();
        SyncRoomsEvent = ExternalEvent.Create(SyncRoomsHandler);
#if DEBUG
        CreateTestModelHandler = new CreateTestModelExternalHandler();
        CreateTestModelEvent = ExternalEvent.Create(CreateTestModelHandler);
#endif

        app.SelectionChanged += (_, args) => SelectionRefresh.Handle(args);
        app.Idling += OnIdling;
        return Result.Succeeded;
    }

    public Result OnShutdown(UIControlledApplication app)
    {
        return Result.Succeeded;
    }

    private static void OnIdling(object? sender, IdlingEventArgs args)
    {
        if (_autoSyncRaised) return;
        if (Environment.GetEnvironmentVariable("BIM_PHOTO_SYNC_AUTORUN_SYNC") != "1") return;
        if (sender is not UIApplication uiapp || uiapp.ActiveUIDocument == null) return;
        if (SyncRoomsHandler == null || SyncRoomsEvent == null) return;

        _autoSyncRaised = true;
        ValidationLog.Write("Auto-run sync raising ExternalEvent from Idling.");
        SyncRoomsHandler.UiApplication = uiapp;
        SyncRoomsEvent.Raise();
    }
}
