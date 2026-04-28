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

    public async Task<ConnectProjectResponse?> ConnectProjectAsync(ConnectProjectRequest request)
    {
        PrepareHeaders();
        var response = await _http.PostAsJsonAsync($"{AddinSettings.ApiBaseUrl}/revit/connect", request)
            .ConfigureAwait(false);
        response.EnsureSuccessStatusCode();
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
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<SyncRoomsResponse>().ConfigureAwait(false);
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

