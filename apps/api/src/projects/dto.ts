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
  @IsNotEmpty()
  project_code!: string;

  @IsString()
  @IsNotEmpty()
  access_key!: string;
}

