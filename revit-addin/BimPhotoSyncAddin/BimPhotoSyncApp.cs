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
        panel.AddItem(new PushButtonData(
            "SyncCurrentView",
            "Sync View",
            typeof(BimPhotoSyncApp).Assembly.Location,
            typeof(SyncCurrentViewCommand).FullName));
        panel.AddItem(new PushButtonData(
            "SyncFloorPlans",
            "Sync Floor Plans",
            typeof(BimPhotoSyncApp).Assembly.Location,
            typeof(SyncFloorPlansCommand).FullName));
        panel.AddItem(new PushButtonData(
            "SyncSheets",
            "Sync Sheets",
            typeof(BimPhotoSyncApp).Assembly.Location,
            typeof(SyncSheetsCommand).FullName));
#if DEBUG
        panel.AddItem(new PushButtonData(
            "CreateTestModel",
            "Create Test",
            typeof(BimPhotoSyncApp).Assembly.Location,
            typeof(CreateTestModelCommand).FullName));
#endif

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
