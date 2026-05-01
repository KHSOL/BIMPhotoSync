import { Type } from "class-transformer";
import { IsArray, IsNotEmpty, IsNumber, IsOptional, IsString, IsUUID, ValidateNested } from "class-validator";

export class RevitConnectDto {
  @IsUUID()
  project_id!: string;

  @IsString()
  @IsNotEmpty()
  model_name!: string;

  @IsOptional()
  @IsString()
  document_guid?: string;
}

export class SyncRoomDto {
  @IsOptional()
  @IsString()
  bim_photo_room_id?: string;

  @IsString()
  @IsNotEmpty()
  revit_unique_id!: string;

  @IsString()
  @IsNotEmpty()
  revit_element_id!: string;

  @IsOptional()
  @IsString()
  room_number?: string;

  @IsString()
  @IsNotEmpty()
  room_name!: string;

  @IsOptional()
  @IsString()
  level_name?: string;
}

export class SyncRoomsDto {
  @IsUUID()
  project_id!: string;

  @IsOptional()
  @IsUUID()
  revit_model_id?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SyncRoomDto)
  rooms!: SyncRoomDto[];
}

export class PlanPointDto {
  @IsNumber()
  x!: number;

  @IsNumber()
  y!: number;
}

export class PlanBoundsDto {
  @IsNumber()
  min_x!: number;

  @IsNumber()
  min_y!: number;

  @IsNumber()
  max_x!: number;

  @IsNumber()
  max_y!: number;

  @IsNumber()
  width!: number;

  @IsNumber()
  height!: number;
}

export class FloorPlanRoomDto {
  @IsOptional()
  @IsUUID()
  room_id?: string;

  @IsString()
  @IsNotEmpty()
  bim_photo_room_id!: string;

  @IsString()
  @IsNotEmpty()
  revit_unique_id!: string;

  @IsString()
  @IsNotEmpty()
  revit_element_id!: string;

  @IsOptional()
  @IsString()
  room_number?: string;

  @IsString()
  @IsNotEmpty()
  room_name!: string;

  @IsOptional()
  @IsString()
  level_name?: string;

  @IsOptional()
  @IsNumber()
  area_m2?: number;

  @ValidateNested()
  @Type(() => PlanPointDto)
  center!: PlanPointDto;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlanPointDto)
  polygon!: PlanPointDto[];
}

export class SheetAssetDto {
  @IsOptional()
  @IsString()
  object_key?: string;

  @IsOptional()
  @IsString()
  mime_type?: string;

  @IsOptional()
  @IsNumber()
  width_px?: number;

  @IsOptional()
  @IsNumber()
  height_px?: number;
}

export class SyncFloorPlanDto {
  @IsUUID()
  project_id!: string;

  @IsOptional()
  @IsUUID()
  revit_model_id?: string;

  @IsString()
  @IsNotEmpty()
  level_name!: string;

  @IsString()
  @IsNotEmpty()
  view_name!: string;

  @IsOptional()
  @IsString()
  source_view_id?: string;

  @ValidateNested()
  @Type(() => PlanBoundsDto)
  bounds!: PlanBoundsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => SheetAssetDto)
  asset?: SheetAssetDto;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FloorPlanRoomDto)
  rooms!: FloorPlanRoomDto[];
}

export class ViewportBoxDto {
  @IsNumber()
  min_x!: number;

  @IsNumber()
  min_y!: number;

  @IsNumber()
  max_x!: number;

  @IsNumber()
  max_y!: number;

  @IsNumber()
  center_x!: number;

  @IsNumber()
  center_y!: number;

  @IsOptional()
  @IsString()
  rotation?: string;
}

export class RevitSheetViewDto {
  @IsString()
  @IsNotEmpty()
  source_view_id!: string;

  @IsOptional()
  @IsString()
  viewport_element_id?: string;

  @IsString()
  @IsNotEmpty()
  view_name!: string;

  @IsString()
  @IsNotEmpty()
  view_type!: string;

  @IsOptional()
  @IsNumber()
  scale?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => ViewportBoxDto)
  viewport_box?: ViewportBoxDto;
}

export class RevitRoomOverlayDto {
  @IsOptional()
  @IsUUID()
  room_id?: string;

  @IsString()
  @IsNotEmpty()
  bim_photo_room_id!: string;

  @IsOptional()
  @IsString()
  source_view_id?: string;

  @IsOptional()
  @IsString()
  viewport_element_id?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlanPointDto)
  polygon!: PlanPointDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlanPointDto)
  normalized_polygon!: PlanPointDto[];

  @ValidateNested()
  @Type(() => PlanBoundsDto)
  bbox!: PlanBoundsDto;
}

export class RevitSheetDto {
  @IsOptional()
  @IsString()
  revit_unique_id?: string;

  @IsOptional()
  @IsString()
  revit_element_id?: string;

  @IsString()
  @IsNotEmpty()
  sheet_number!: string;

  @IsString()
  @IsNotEmpty()
  sheet_name!: string;

  @IsOptional()
  @IsNumber()
  width_mm?: number;

  @IsOptional()
  @IsNumber()
  height_mm?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => SheetAssetDto)
  asset?: SheetAssetDto;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RevitSheetViewDto)
  views!: RevitSheetViewDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RevitRoomOverlayDto)
  overlays!: RevitRoomOverlayDto[];
}

export class SyncSheetsDto {
  @IsUUID()
  project_id!: string;

  @IsOptional()
  @IsUUID()
  revit_model_id?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RevitSheetDto)
  sheets!: RevitSheetDto[];
}

