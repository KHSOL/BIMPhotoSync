import { Type } from "class-transformer";
import { IsArray, IsNotEmpty, IsOptional, IsString, IsUUID, ValidateNested } from "class-validator";

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

