using System.Windows;
using System.Windows.Controls;
using Autodesk.Revit.UI;
using BimPhotoSyncAddin.Models;

namespace BimPhotoSyncAddin.Panels;

public sealed class PhotoDockPane : IDockablePaneProvider
{
    private readonly StackPanel _root = new() { Margin = new Thickness(12) };
    private readonly TextBlock _header = new() { FontWeight = FontWeights.Bold, FontSize = 16, Margin = new Thickness(0, 0, 0, 8) };
    private readonly TextBlock _summary = new() { Margin = new Thickness(0, 0, 0, 12) };
    private readonly ListBox _photos = new();

    public PhotoDockPane()
    {
        _root.Children.Add(_header);
        _root.Children.Add(_summary);
        _root.Children.Add(_photos);
        ShowMessage("Room을 선택하면 사진 타임라인이 표시됩니다.");
    }

    public void SetupDockablePane(DockablePaneProviderData data)
    {
        data.FrameworkElement = _root;
        data.InitialState = new DockablePaneState
        {
            DockPosition = DockPosition.Right
        };
    }

    public void ShowMessage(string message)
    {
        _header.Text = "BIM Photo Sync";
        _summary.Text = message;
        _photos.Items.Clear();
    }

    public void Render(RevitRoomPhotoResponse response)
    {
        _header.Text = $"{response.Room.Room_Number} {response.Room.Room_Name}";
        _summary.Text = $"Level: {response.Room.Level_Name ?? "-"} | BIM_PHOTO_ROOM_ID: {response.Room.Bim_Photo_Room_Id}";
        _photos.Items.Clear();
        foreach (PhotoDto photo in response.Photos)
        {
            _photos.Items.Add($"{photo.Work_Date} | {photo.Trade}/{photo.Work_Surface} | {photo.Progress_Status}\nAI: {photo.Ai_Description ?? "분석 대기"}\n{photo.Photo_Url}");
        }
    }
}

