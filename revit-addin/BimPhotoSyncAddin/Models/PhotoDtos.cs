namespace BimPhotoSyncAddin.Models;

public sealed record RevitRoomPhotoResponse(RoomDto Room, IReadOnlyList<PhotoDto> Photos);

public sealed record RoomDto(
    string Id,
    string Bim_Photo_Room_Id,
    string? Room_Number,
    string Room_Name,
    string? Level_Name);

public sealed record PhotoDto(
    string Id,
    string Work_Surface,
    string Trade,
    string Work_Date,
    string? Worker_Name,
    string? Description,
    string? Ai_Description,
    string Progress_Status,
    string Photo_Url);

public sealed record SyncRoomsRequest(string Project_Id, string? Revit_Model_Id, IReadOnlyList<SyncRoomDto> Rooms);

public sealed record SyncRoomDto(
    string? Bim_Photo_Room_Id,
    string Revit_Unique_Id,
    string Revit_Element_Id,
    string? Room_Number,
    string Room_Name,
    string? Level_Name);

public sealed record SyncRoomsResponse(SyncRoomsData Data);

public sealed record SyncRoomsData(string Project_Id, IReadOnlyList<RoomMappingDto> Room_Mappings);

public sealed record RoomMappingDto(string Room_Id, string Bim_Photo_Room_Id, string Revit_Unique_Id, string Revit_Element_Id);

