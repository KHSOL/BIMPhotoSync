namespace BimPhotoSyncAddin.Services;

using System.IO;
using System.Text.Json;

public static class AddinSettings
{
    public static string ApiBaseUrl { get; set; } = "http://localhost:4000/api/v1";
    public static string JwtToken { get; set; } = "";
    public static string ProjectId { get; set; } = "";
    public static string? RevitModelId { get; set; }

    public static string ConfigPath =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "BimPhotoSync", "config.json");

    public static void Load()
    {
        ApiBaseUrl = Environment.GetEnvironmentVariable("BIM_PHOTO_SYNC_API_BASE_URL") ?? ApiBaseUrl;
        JwtToken = Environment.GetEnvironmentVariable("BIM_PHOTO_SYNC_JWT") ?? JwtToken;
        ProjectId = Environment.GetEnvironmentVariable("BIM_PHOTO_SYNC_PROJECT_ID") ?? ProjectId;
        RevitModelId = Environment.GetEnvironmentVariable("BIM_PHOTO_SYNC_REVIT_MODEL_ID") ?? RevitModelId;

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
    }

    private sealed record ConfigFile(string? ApiBaseUrl, string? JwtToken, string? ProjectId, string? RevitModelId);
}
