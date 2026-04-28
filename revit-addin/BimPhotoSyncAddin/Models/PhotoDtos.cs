namespace BimPhotoSyncAddin.Models;

using System.Text.Json.Serialization;

public sealed record RevitRoomPhotoResponse(
    [property: JsonPropertyName("room")] RoomDto Room,
    [property: JsonPropertyName("photos")] IReadOnlyList<PhotoDto> Photos);

public sealed record ConnectProjectRequest(
    [property: JsonPropertyName("project_id")] string Project_Id,
    [property: JsonPropertyName("model_name")] string Model_Name,
    [property: JsonPropertyName("document_guid")] string? Document_Guid);

public sealed record ConnectProjectResponse([property: JsonPropertyName("data")] ConnectProjectData Data);

public sealed record ConnectProjectData(
    [property: JsonPropertyName("revit_model_id")] string Revit_Model_Id,
    [property: JsonPropertyName("project_id")] string Project_Id,
    [property: JsonPropertyName("model_name")] string Model_Name);

public sealed record RoomDto(
    [property: JsonPropertyName("id")]
    string Id,
    [property: JsonPropertyName("bim_photo_room_id")]
    string Bim_Photo_Room_Id,
    [property: JsonPropertyName("room_number")]
    string? Room_Number,
    [property: JsonPropertyName("room_name")]
    string Room_Name,
    [property: JsonPropertyName("level_name")]
    string? Level_Name);

public sealed record PhotoDto(
    [property: JsonPropertyName("id")]
    string Id,
    [property: JsonPropertyName("work_surface")]
    string Work_Surface,
    [property: JsonPropertyName("trade")]
    string Trade,
    [property: JsonPropertyName("work_date")]
    string Work_Date,
    [property: JsonPropertyName("worker_name")]
    string? Worker_Name,
    [property: JsonPropertyName("description")]
    string? Description,
    [property: JsonPropertyName("ai_description")]
    string? Ai_Description,
    [property: JsonPropertyName("progress_status")]
    string Progress_Status,
    [property: JsonPropertyName("photo_url")]
    string Photo_Url);

public sealed record SyncRoomsRequest(
    [property: JsonPropertyName("project_id")] string Project_Id,
    [property: JsonPropertyName("revit_model_id")] string? Revit_Model_Id,
    [property: JsonPropertyName("rooms")] IReadOnlyList<SyncRoomDto> Rooms);

public sealed record SyncRoomDto(
    [property: JsonPropertyName("bim_photo_room_id")]
    string? Bim_Photo_Room_Id,
    [property: JsonPropertyName("revit_unique_id")]
    string Revit_Unique_Id,
    [property: JsonPropertyName("revit_element_id")]
    string Revit_Element_Id,
    [property: JsonPropertyName("room_number")]
    string? Room_Number,
    [property: JsonPropertyName("room_name")]
    string Room_Name,
    [property: JsonPropertyName("level_name")]
    string? Level_Name);

public sealed record SyncRoomsResponse([property: JsonPropertyName("data")] SyncRoomsData Data);

public sealed record SyncRoomsData(
    [property: JsonPropertyName("project_id")] string Project_Id,
    [property: JsonPropertyName("room_mappings")] IReadOnlyList<RoomMappingDto> Room_Mappings);

public sealed record RoomMappingDto(
    [property: JsonPropertyName("room_id")] string Room_Id,
    [property: JsonPropertyName("bim_photo_room_id")] string Bim_Photo_Room_Id,
    [property: JsonPropertyName("revit_unique_id")] string Revit_Unique_Id,
    [property: JsonPropertyName("revit_element_id")] string Revit_Element_Id);

