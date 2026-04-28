using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using Autodesk.Revit.UI;
using BimPhotoSyncAddin.Models;
using BimPhotoSyncAddin.Services;

namespace BimPhotoSyncAddin.Panels;

public sealed class PhotoDockPane : IDockablePaneProvider
{
    private readonly StackPanel _root = new() { Margin = new Thickness(12) };
    private readonly TextBlock _header = new() { FontWeight = FontWeights.Bold, FontSize = 16, Margin = new Thickness(0, 0, 0, 8) };
    private readonly TextBlock _summary = new() { Margin = new Thickness(0, 0, 0, 12), TextWrapping = TextWrapping.Wrap };
    private readonly ListBox _photos = new();

    public PhotoDockPane()
    {
        _root.Children.Add(_header);
        _root.Children.Add(_summary);
        _root.Children.Add(_photos);
        ShowMessage("Select a Room to show the photo timeline.");
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
        if (response.Photos.Count == 0)
        {
            _photos.Items.Add("No photos are registered for this Room.");
            return;
        }

        foreach (PhotoDto photo in response.Photos)
        {
            StackPanel item = new() { Margin = new Thickness(0, 0, 0, 12) };
            item.Children.Add(new TextBlock
            {
                Text = $"{photo.Work_Date} | {photo.Trade}/{photo.Work_Surface} | {photo.Progress_Status}",
                FontWeight = FontWeights.Bold,
                TextWrapping = TextWrapping.Wrap
            });
            item.Children.Add(new TextBlock
            {
                Text = $"AI: {photo.Ai_Description ?? "Analysis pending"}",
                TextWrapping = TextWrapping.Wrap,
                Margin = new Thickness(0, 2, 0, 6)
            });
            Image image = new()
            {
                Height = 160,
                Stretch = Stretch.UniformToFill,
                HorizontalAlignment = HorizontalAlignment.Stretch
            };
            item.Children.Add(image);
            _photos.Items.Add(item);
            _ = LoadPhotoAsync(image, photo.Photo_Url);
        }
    }

    private static async Task LoadPhotoAsync(Image image, string photoUrl)
    {
        byte[]? bytes = await new ApiClient().GetPhotoBytesAsync(photoUrl);
        if (bytes == null || bytes.Length == 0)
        {
            image.Visibility = Visibility.Collapsed;
            return;
        }

        BitmapImage bitmap = new();
        using MemoryStream stream = new(bytes);
        bitmap.BeginInit();
        bitmap.CacheOption = BitmapCacheOption.OnLoad;
        bitmap.StreamSource = stream;
        bitmap.EndInit();
        bitmap.Freeze();
        image.Source = bitmap;
    }
}
