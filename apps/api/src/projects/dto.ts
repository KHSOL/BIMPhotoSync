import { IsNotEmpty, IsOptional, IsString } from "class-validator";

export class CreateProjectDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  code?: string;
}

export class JoinProjectDto {
  @IsString()
  @IsOptional()
  project_code?: string;

  @IsString()
  @IsNotEmpty()
  access_key!: string;
}

export class PreviewProjectAccessKeyDto {
  @IsString()
  @IsNotEmpty()
  access_key!: string;
}

export class CreateTradeCategoryDto {
  @IsString()
  @IsNotEmpty()
  label!: string;
}
