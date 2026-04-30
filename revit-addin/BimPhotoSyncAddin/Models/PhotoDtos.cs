namespace BimPhotoSyncAddin.Models;

using System.Text.Json.Serialization;

public sealed record LoginRequest(
    [property: JsonPropertyName("email")] string Email,
    [property: JsonPropertyName("password")] string Password);

public sealed record AuthResponse([property: JsonPropertyName("data")] AuthData Data);

public sealed record AuthData(
    [property: JsonPropertyName("access_token")] string Access_Token,
    [property: JsonPropertyName("user")] AuthUser User);

public sealed record AuthUser(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("email")] string Email,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("role")] string Role);

public sealed record ProjectListResponse([property: JsonPropertyName("data")] IReadOnlyList<ProjectListItem> Data);

public sealed record ProjectResponse([property: JsonPropertyName("data")] ProjectListItem Data);

public sealed record ProjectListItem(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("code")] string Code,
    [property: JsonPropertyName("member_role")] string? Member_Role);

public sealed record CreateProjectRequest(
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("code")] string? Code);

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

public sealed record SyncFloorPlanRequest(
    [property: JsonPropertyName("project_id")] string Project_Id,
    [property: JsonPropertyName("revit_model_id")] string? Revit_Model_Id,
    [property: JsonPropertyName("level_name")] string Level_Name,
    [property: JsonPropertyName("view_name")] string View_Name,
    [property: JsonPropertyName("source_view_id")] string? Source_View_Id,
    [property: JsonPropertyName("bounds")] PlanBoundsDto Bounds,
    [property: JsonPropertyName("rooms")] IReadOnlyList<FloorPlanRoomDto> Rooms);

public sealed record PlanPointDto(
    [property: JsonPropertyName("x")] double X,
    [property: JsonPropertyName("y")] double Y);

public sealed record PlanBoundsDto(
    [property: JsonPropertyName("min_x")] double Min_X,
    [property: JsonPropertyName("min_y")] double Min_Y,
    [property: JsonPropertyName("max_x")] double Max_X,
    [property: JsonPropertyName("max_y")] double Max_Y,
    [property: JsonPropertyName("width")] double Width,
    [property: JsonPropertyName("height")] double Height);

public sealed record FloorPlanRoomDto(
    [property: JsonPropertyName("room_id")] string? Room_Id,
    [property: JsonPropertyName("bim_photo_room_id")] string Bim_Photo_Room_Id,
    [property: JsonPropertyName("revit_unique_id")] string Revit_Unique_Id,
    [property: JsonPropertyName("revit_element_id")] string Revit_Element_Id,
    [property: JsonPropertyName("room_number")] string? Room_Number,
    [property: JsonPropertyName("room_name")] string Room_Name,
    [property: JsonPropertyName("level_name")] string? Level_Name,
    [property: JsonPropertyName("area_m2")] double? Area_M2,
    [property: JsonPropertyName("center")] PlanPointDto Center,
    [property: JsonPropertyName("polygon")] IReadOnlyList<PlanPointDto> Polygon);

public sealed record SyncFloorPlanResponse([property: JsonPropertyName("data")] SyncedFloorPlanDto Data);

public sealed record SyncedFloorPlanDto(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("project_id")] string Project_Id,
    [property: JsonPropertyName("level_name")] string Level_Name,
    [property: JsonPropertyName("view_name")] string View_Name);

public sealed record PresignDrawingAssetRequest(
    [property: JsonPropertyName("project_id")] string Project_Id,
    [property: JsonPropertyName("mime_type")] string Mime_Type,
    [property: JsonPropertyName("file_size")] long File_Size,
    [property: JsonPropertyName("sheet_number")] string? Sheet_Number,
    [property: JsonPropertyName("checksum_sha256")] string? Checksum_Sha256);

public sealed record PresignDrawingAssetResponse(
    [property: JsonPropertyName("data")] PresignDrawingAssetData Data);

public sealed record PresignDrawingAssetData(
    [property: JsonPropertyName("upload_id")] string Upload_Id,
    [property: JsonPropertyName("presigned_url")] string Presigned_Url,
    [property: JsonPropertyName("method")] string Method,
    [property: JsonPropertyName("object_key")] string Object_Key,
    [property: JsonPropertyName("expires_at")] string Expires_At);

public sealed record SyncSheetsRequest(
    [property: JsonPropertyName("project_id")] string Project_Id,
    [property: JsonPropertyName("revit_model_id")] string? Revit_Model_Id,
    [property: JsonPropertyName("sheets")] IReadOnlyList<RevitSheetDto> Sheets);

public sealed record RevitSheetDto(
    [property: JsonPropertyName("revit_unique_id")] string? Revit_Unique_Id,
    [property: JsonPropertyName("revit_element_id")] string? Revit_Element_Id,
    [property: JsonPropertyName("sheet_number")] string Sheet_Number,
    [property: JsonPropertyName("sheet_name")] string Sheet_Name,
    [property: JsonPropertyName("width_mm")] double? Width_Mm,
    [property: JsonPropertyName("height_mm")] double? Height_Mm,
    [property: JsonPropertyName("asset")] SheetAssetDto? Asset,
    [property: JsonPropertyName("views")] IReadOnlyList<RevitSheetViewDto> Views,
    [property: JsonPropertyName("overlays")] IReadOnlyList<RevitRoomOverlayDto> Overlays);

public sealed record SheetAssetDto(
    [property: JsonPropertyName("object_key")] string Object_Key,
    [property: JsonPropertyName("mime_type")] string Mime_Type,
    [property: JsonPropertyName("width_px")] int? Width_Px,
    [property: JsonPropertyName("height_px")] int? Height_Px);

public sealed record RevitSheetViewDto(
    [property: JsonPropertyName("source_view_id")] string Source_View_Id,
    [property: JsonPropertyName("viewport_element_id")] string? Viewport_Element_Id,
    [property: JsonPropertyName("view_name")] string View_Name,
    [property: JsonPropertyName("view_type")] string View_Type,
    [property: JsonPropertyName("scale")] int? Scale,
    [property: JsonPropertyName("viewport_box")] ViewportBoxDto? Viewport_Box);

public sealed record ViewportBoxDto(
    [property: JsonPropertyName("min_x")] double Min_X,
    [property: JsonPropertyName("min_y")] double Min_Y,
    [property: JsonPropertyName("max_x")] double Max_X,
    [property: JsonPropertyName("max_y")] double Max_Y,
    [property: JsonPropertyName("center_x")] double Center_X,
    [property: JsonPropertyName("center_y")] double Center_Y,
    [property: JsonPropertyName("rotation")] string? Rotation);

public sealed record RevitRoomOverlayDto(
    [property: JsonPropertyName("room_id")] string? Room_Id,
    [property: JsonPropertyName("bim_photo_room_id")] string Bim_Photo_Room_Id,
    [property: JsonPropertyName("source_view_id")] string? Source_View_Id,
    [property: JsonPropertyName("viewport_element_id")] string? Viewport_Element_Id,
    [property: JsonPropertyName("polygon")] IReadOnlyList<PlanPointDto> Polygon,
    [property: JsonPropertyName("normalized_polygon")] IReadOnlyList<PlanPointDto> Normalized_Polygon,
    [property: JsonPropertyName("bbox")] PlanBoundsDto Bbox);

public sealed record SyncSheetsResponse(
    [property: JsonPropertyName("data")] IReadOnlyList<SyncedSheetDto> Data);

public sealed record SyncedSheetDto(
    [property: JsonPropertyName("id")] string Id,
    [property: JsonPropertyName("sheet_number")] string Sheet_Number,
    [property: JsonPropertyName("sheet_name")] string Sheet_Name);

