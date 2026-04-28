import { IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from "class-validator";

export class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  company_name!: string;
}

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;
}

export class JoinProjectDto {
  @IsString()
  @IsNotEmpty()
  project_code!: string;

  @IsString()
  @IsNotEmpty()
  access_key!: string;

  @IsOptional()
  @IsString()
  company_id?: string;
}

