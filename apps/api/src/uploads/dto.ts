import { IsInt, IsMimeType, IsOptional, IsString, IsUUID, Min } from "class-validator";

export class PresignPhotoDto {
  @IsUUID()
  project_id!: string;

  @IsMimeType()
  mime_type!: string;

  @IsInt()
  @Min(1)
  file_size!: number;

  @IsOptional()
  @IsString()
  checksum_sha256?: string;
}

export class PresignDrawingAssetDto {
  @IsUUID()
  project_id!: string;

  @IsMimeType()
  mime_type!: string;

  @IsInt()
  @Min(1)
  file_size!: number;

  @IsOptional()
  @IsString()
  sheet_number?: string;

  @IsOptional()
  @IsString()
  checksum_sha256?: string;
}

