namespace BimPhotoSyncAddin.Services;

using System.IO;

public static class ValidationLog
{
    public static string LogPath =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "BimPhotoSync", "validation.log");

    public static void Write(string message)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(LogPath)!);
            File.AppendAllText(LogPath, $"{DateTimeOffset.Now:O} {message}{Environment.NewLine}");
        }
        catch
        {
            // Validation logging must never break the Revit add-in.
        }
    }
}
