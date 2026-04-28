import { ProgressStatus, Trade, WorkSurface } from "@prisma/client";
import { Type } from "class-transformer";
import { IsDateString, IsEnum, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";

export class CommitPhotoDto {
  @IsUUID()
  project_id!: string;

  @IsUUID()
  room_id!: string;

  @IsUUID()
  upload_id!: string;

  @IsEnum(WorkSurface)
  work_surface!: WorkSurface;

  @IsEnum(Trade)
  trade!: Trade;

  @IsDateString()
  work_date!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  worker_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @IsOptional()
  @IsDateString()
  taken_at?: string;
}

export class PhotoQueryDto {
  @IsUUID()
  project_id!: string;

  @IsOptional()
  @IsUUID()
  room_id?: string;

  @IsOptional()
  @IsEnum(Trade)
  trade?: Trade;

  @IsOptional()
  @IsEnum(WorkSurface)
  work_surface?: WorkSurface;

  @IsOptional()
  @IsDateString()
  date_from?: string;

  @IsOptional()
  @IsDateString()
  date_to?: string;

  @IsOptional()
  @Type(() => Number)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  page_size?: number;
}

export class ReviewAnalysisDto {
  @IsOptional()
  @IsString()
  summary?: string;

  @IsOptional()
  @IsEnum(Trade)
  detected_trade?: Trade;

  @IsOptional()
  @IsEnum(WorkSurface)
  detected_surface?: WorkSurface;

  @IsOptional()
  @IsEnum(ProgressStatus)
  progress_status?: ProgressStatus;
}

