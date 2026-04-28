using System.Net.Http.Headers;
using System.Net.Http.Json;
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
            $"{AddinSettings.ApiBaseUrl}/revit/rooms/{Uri.EscapeDataString(bimPhotoRoomId)}/photos");
        return response?.Data;
    }

    public async Task<SyncRoomsResponse?> SyncRoomsAsync(SyncRoomsRequest request)
    {
        PrepareHeaders();
        var response = await _http.PostAsJsonAsync($"{AddinSettings.ApiBaseUrl}/revit/sync-rooms", request);
        response.EnsureSuccessStatusCode();
        return await response.Content.ReadFromJsonAsync<SyncRoomsResponse>();
    }

    private void PrepareHeaders()
    {
        _http.DefaultRequestHeaders.Authorization = null;
        if (!string.IsNullOrWhiteSpace(AddinSettings.JwtToken))
        {
            _http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", AddinSettings.JwtToken);
        }
    }

    private sealed record ApiEnvelope<T>(T Data);
}

