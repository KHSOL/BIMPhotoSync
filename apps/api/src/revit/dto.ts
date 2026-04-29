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

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FloorPlanRoomDto)
  rooms!: FloorPlanRoomDto[];
}

