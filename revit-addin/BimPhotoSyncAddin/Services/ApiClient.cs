using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json.Serialization;
using BimPhotoSyncAddin.Models;

namespace BimPhotoSyncAddin.Services;

public sealed class ApiClient
{
    private readonly HttpClient _http = new();

    public ApiClient()
    {
        _http.Timeout = TimeSpan.FromSeconds(20);
    }

    public async Task<RevitRoomPhotoResponse?> GetRoomPhotosAsync(string bimPhotoRoomId)
    {
        PrepareHeaders();
        var response = await _http.GetFromJsonAsync<ApiEnvelope<RevitRoomPhotoResponse>>(
            $"{AddinSettings.ApiBaseUrl}/revit/rooms/{Uri.EscapeDataString(bimPhotoRoomId)}/photos")
            .ConfigureAwait(false);
        return response?.Data;
    }

    public async Task<AuthResponse?> LoginAsync(LoginRequest request)
    {
        var response = await _http.PostAsJsonAsync($"{AddinSettings.ApiBaseUrl}/auth/login", request)
            .ConfigureAwait(false);
        await EnsureSuccessAsync(response).ConfigureAwait(false);
        return await response.Content.ReadFromJsonAsync<AuthResponse>().ConfigureAwait(false);
    }

    public async Task<ProjectListResponse?> GetProjectsAsync()
    {
        PrepareHeaders();
        return await _http.GetFromJsonAsync<ProjectListResponse>($"{AddinSettings.ApiBaseUrl}/projects")
            .ConfigureAwait(false);
    }

    public async Task<ProjectListItem?> CreateProjectAsync(CreateProjectRequest request)
    {
        PrepareHeaders();
        var response = await _http.PostAsJsonAsync($"{AddinSettings.ApiBaseUrl}/projects", request)
            .ConfigureAwait(false);
        await EnsureSuccessAsync(response).ConfigureAwait(false);
        ProjectResponse? envelope = await response.Content.ReadFromJsonAsync<ProjectResponse>().ConfigureAwait(false);
        return envelope?.Data;
    }

    public async Task<ConnectProjectResponse?> ConnectProjectAsync(ConnectProjectRequest request)
    {
        PrepareHeaders();
        var response = await _http.PostAsJsonAsync($"{AddinSettings.ApiBaseUrl}/revit/connect", request)
            .ConfigureAwait(false);
        await EnsureSuccessAsync(response).ConfigureAwait(false);
        return await response.Content.ReadFromJsonAsync<ConnectProjectResponse>().ConfigureAwait(false);
    }

    public async Task<byte[]?> GetPhotoBytesAsync(string photoUrl)
    {
        PrepareHeaders();
        try
        {
            return await _http.GetByteArrayAsync(photoUrl).ConfigureAwait(false);
        }
        catch
        {
            return null;
        }
    }

    public async Task<SyncRoomsResponse?> SyncRoomsAsync(SyncRoomsRequest request)
    {
        PrepareHeaders();
        var response = await _http.PostAsJsonAsync($"{AddinSettings.ApiBaseUrl}/revit/sync-rooms", request)
            .ConfigureAwait(false);
        await EnsureSuccessAsync(response).ConfigureAwait(false);
        return await response.Content.ReadFromJsonAsync<SyncRoomsResponse>().ConfigureAwait(false);
    }

    public async Task<SyncFloorPlanResponse?> SyncFloorPlanAsync(SyncFloorPlanRequest request)
    {
        PrepareHeaders();
        var response = await _http.PostAsJsonAsync($"{AddinSettings.ApiBaseUrl}/revit/floor-plans", request)
            .ConfigureAwait(false);
        await EnsureSuccessAsync(response).ConfigureAwait(false);
        return await response.Content.ReadFromJsonAsync<SyncFloorPlanResponse>().ConfigureAwait(false);
    }

    public async Task<PresignDrawingAssetResponse?> PresignDrawingAssetAsync(PresignDrawingAssetRequest request)
    {
        PrepareHeaders();
        var response = await _http.PostAsJsonAsync($"{AddinSettings.ApiBaseUrl}/uploads/drawings/presign", request)
            .ConfigureAwait(false);
        await EnsureSuccessAsync(response).ConfigureAwait(false);
        return await response.Content.ReadFromJsonAsync<PresignDrawingAssetResponse>().ConfigureAwait(false);
    }

    public async Task UploadBytesAsync(string presignedUrl, string mimeType, byte[] bytes)
    {
        _http.DefaultRequestHeaders.Authorization = null;
        using ByteArrayContent content = new(bytes);
        content.Headers.ContentType = new MediaTypeHeaderValue(mimeType);
        using HttpRequestMessage request = new(HttpMethod.Put, presignedUrl) { Content = content };
        using HttpResponseMessage response = await _http.SendAsync(request).ConfigureAwait(false);
        await EnsureSuccessAsync(response).ConfigureAwait(false);
    }

    public async Task<SyncSheetsResponse?> SyncSheetsAsync(SyncSheetsRequest request)
    {
        PrepareHeaders();
        var response = await _http.PostAsJsonAsync($"{AddinSettings.ApiBaseUrl}/revit/sheets", request)
            .ConfigureAwait(false);
        await EnsureSuccessAsync(response).ConfigureAwait(false);
        return await response.Content.ReadFromJsonAsync<SyncSheetsResponse>().ConfigureAwait(false);
    }

    private static async Task EnsureSuccessAsync(HttpResponseMessage response)
    {
        if (response.IsSuccessStatusCode) return;

        string body = await response.Content.ReadAsStringAsync().ConfigureAwait(false);
        string message = $"HTTP {(int)response.StatusCode} {response.ReasonPhrase}";
        if (!string.IsNullOrWhiteSpace(body))
        {
            message += $": {body}";
        }

        throw new HttpRequestException(message, null, response.StatusCode);
    }

    private void PrepareHeaders()
    {
        _http.DefaultRequestHeaders.Authorization = null;
        if (!string.IsNullOrWhiteSpace(AddinSettings.JwtToken))
        {
            _http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", AddinSettings.JwtToken);
        }
    }

    private sealed record ApiEnvelope<T>([property: JsonPropertyName("data")] T Data);
}

