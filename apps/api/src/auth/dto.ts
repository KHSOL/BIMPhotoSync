import { IsEmail, IsIn, IsNotEmpty, IsOptional, IsString, IsUUID, MinLength } from "class-validator";

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
  @IsOptional()
  @IsNotEmpty()
  company_name?: string;

  @IsOptional()
  @IsUUID()
  company_id?: string;

  @IsOptional()
  @IsIn(["WORKER", "COMPANY_ADMIN"])
  role?: "WORKER" | "COMPANY_ADMIN";
}

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;
}

export class UpdateAvatarDto {
  @IsString()
  @IsNotEmpty()
  object_key!: string;
}

