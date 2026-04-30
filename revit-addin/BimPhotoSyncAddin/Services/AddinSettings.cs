namespace BimPhotoSyncAddin.Services;

using System.IO;
using System.Text.Json;

public static class AddinSettings
{
    private const int DefaultHttpTimeoutSeconds = 180;
    private const int MinimumHttpTimeoutSeconds = 30;
    private const int MaximumHttpTimeoutSeconds = 600;

    public static string ApiBaseUrl { get; set; } = "https://bimphotosync-api-production.up.railway.app/api/v1";
    public static string JwtToken { get; set; } = "";
    public static string ProjectId { get; set; } = "";
    public static string? RevitModelId { get; set; }
    public static int HttpTimeoutSeconds { get; set; } = DefaultHttpTimeoutSeconds;

    public static string ConfigPath =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "BimPhotoSync", "config.json");

    public static void Load()
    {
        ApiBaseUrl = Environment.GetEnvironmentVariable("BIM_PHOTO_SYNC_API_BASE_URL") ?? ApiBaseUrl;
        JwtToken = Environment.GetEnvironmentVariable("BIM_PHOTO_SYNC_JWT") ?? JwtToken;
        ProjectId = Environment.GetEnvironmentVariable("BIM_PHOTO_SYNC_PROJECT_ID") ?? ProjectId;
        RevitModelId = Environment.GetEnvironmentVariable("BIM_PHOTO_SYNC_REVIT_MODEL_ID") ?? RevitModelId;
        HttpTimeoutSeconds = ParseHttpTimeoutSeconds(
            Environment.GetEnvironmentVariable("BIM_PHOTO_SYNC_HTTP_TIMEOUT_SECONDS"),
            HttpTimeoutSeconds);

        if (!File.Exists(ConfigPath)) return;

        string json = File.ReadAllText(ConfigPath);
        ConfigFile? config = JsonSerializer.Deserialize<ConfigFile>(json, new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true
        });
        if (config == null) return;

        ApiBaseUrl = string.IsNullOrWhiteSpace(config.ApiBaseUrl) ? ApiBaseUrl : config.ApiBaseUrl;
        JwtToken = string.IsNullOrWhiteSpace(config.JwtToken) ? JwtToken : config.JwtToken;
        ProjectId = string.IsNullOrWhiteSpace(config.ProjectId) ? ProjectId : config.ProjectId;
        RevitModelId = string.IsNullOrWhiteSpace(config.RevitModelId) ? RevitModelId : config.RevitModelId;
        HttpTimeoutSeconds = NormalizeHttpTimeoutSeconds(config.HttpTimeoutSeconds ?? HttpTimeoutSeconds);
    }

    public static void Save()
    {
        string? directory = Path.GetDirectoryName(ConfigPath);
        if (!string.IsNullOrWhiteSpace(directory))
        {
            Directory.CreateDirectory(directory);
        }

        var config = new ConfigFile(ApiBaseUrl, JwtToken, ProjectId, RevitModelId, HttpTimeoutSeconds);
        string json = JsonSerializer.Serialize(config, new JsonSerializerOptions { WriteIndented = true });
        File.WriteAllText(ConfigPath, json);
    }

    private static int ParseHttpTimeoutSeconds(string? value, int fallback)
    {
        if (!int.TryParse(value, out int parsed)) return NormalizeHttpTimeoutSeconds(fallback);
        return NormalizeHttpTimeoutSeconds(parsed);
    }

    private static int NormalizeHttpTimeoutSeconds(int value)
    {
        if (value <= 0) return DefaultHttpTimeoutSeconds;
        return Math.Clamp(value, MinimumHttpTimeoutSeconds, MaximumHttpTimeoutSeconds);
    }

    private sealed record ConfigFile(
        string? ApiBaseUrl,
        string? JwtToken,
        string? ProjectId,
        string? RevitModelId,
        int? HttpTimeoutSeconds);
}
