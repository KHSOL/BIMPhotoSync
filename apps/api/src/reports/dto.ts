import { ReportFormat, Trade, WorkSurface } from "@prisma/client";
import { IsDateString, IsEnum, IsOptional, IsString, IsUUID, MaxLength } from "class-validator";

export class ReportQueryDto {
  @IsOptional()
  @IsUUID()
  project_id?: string;
}

export class GenerateReportDto {
  @IsUUID()
  project_id!: string;

  @IsOptional()
  @IsUUID()
  room_id?: string;

  @IsOptional()
  @IsEnum(WorkSurface)
  work_surface?: WorkSurface;

  @IsOptional()
  @IsEnum(Trade)
  trade?: Trade;

  @IsOptional()
  @IsDateString()
  date_from?: string;

  @IsOptional()
  @IsDateString()
  date_to?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  worker_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsEnum(ReportFormat)
  format?: ReportFormat;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  memo?: string;
}
