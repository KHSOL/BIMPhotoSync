import { IsNotEmpty, IsOptional, IsString } from "class-validator";

export class CreateRoomDto {
  @IsString()
  @IsOptional()
  room_number?: string;

  @IsString()
  @IsNotEmpty()
  room_name!: string;

  @IsString()
  @IsOptional()
  level_name?: string;

  @IsString()
  @IsOptional()
  location_text?: string;
}

export class UpdateRoomDto {
  @IsString()
  @IsOptional()
  room_number?: string;

  @IsString()
  @IsOptional()
  room_name?: string;

  @IsString()
  @IsOptional()
  level_name?: string;

  @IsString()
  @IsOptional()
  location_text?: string;
}

