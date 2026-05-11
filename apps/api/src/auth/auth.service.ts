import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { BadRequestException, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { UserRole } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../prisma/prisma.service";
import { LoginDto, RegisterDto, UpdateAvatarDto } from "./dto";

@Injectable()
export class AuthService {
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService
  ) {
    this.bucket = config.get<string>("S3_BUCKET", "bim-photo-sync");
    this.s3 = new S3Client({
      endpoint: config.get<string>("S3_ENDPOINT"),
      region: config.get<string>("S3_REGION", "us-east-1"),
      forcePathStyle: config.get<string>("S3_FORCE_PATH_STYLE", "true") === "true",
      credentials: {
        accessKeyId: config.get<string>("S3_ACCESS_KEY_ID", "minio"),
        secretAccessKey: config.get<string>("S3_SECRET_ACCESS_KEY", "minio123")
      }
    });
  }

  async register(dto: RegisterDto, meta?: { ipAddress?: string | null; userAgent?: string | null }) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    if (existing) throw new BadRequestException("Email already registered.");

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.$transaction(async (tx) => {
      const existingCompany = await tx.company.findFirst({
        where: { name: { equals: dto.company_name, mode: "insensitive" } }
      });
      const company = existingCompany ?? (await tx.company.create({ data: { name: dto.company_name } }));
      const requestedRole = existingCompany ? UserRole.WORKER : (dto.role ?? UserRole.COMPANY_ADMIN);
      return tx.user.create({
        data: {
          companyId: company.id,
          email: dto.email.toLowerCase(),
          passwordHash,
          name: dto.name,
          role: requestedRole
        },
        include: { company: true }
      });
    });

    await this.recordAuthEvent({
      companyId: user.companyId,
      userId: user.id,
      email: user.email,
      eventType: "REGISTER",
      success: true,
      meta
    });
    return this.authResponse(user);
  }

  async login(dto: LoginDto, meta?: { ipAddress?: string | null; userAgent?: string | null }) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
      include: { company: true }
    });
    if (!user) {
      await this.recordAuthEvent({ email: dto.email.toLowerCase(), eventType: "LOGIN", success: false, meta });
      throw new UnauthorizedException("Invalid credentials.");
    }
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) {
      await this.recordAuthEvent({
        companyId: user.companyId,
        userId: user.id,
        email: user.email,
        eventType: "LOGIN",
        success: false,
        meta
      });
      throw new UnauthorizedException("Invalid credentials.");
    }
    await this.recordAuthEvent({
      companyId: user.companyId,
      userId: user.id,
      email: user.email,
      eventType: "LOGIN",
      success: true,
      meta
    });
    return this.authResponse(user);
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, role: true, company: true, companyId: true, avatarObjectKey: true }
    });
    if (!user) throw new UnauthorizedException();
    return { data: { ...user, avatar_url: this.avatarUrl(user.id, user.avatarObjectKey) } };
  }

  async updateAvatar(userId: string, dto: UpdateAvatarDto) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { avatarObjectKey: dto.object_key },
      include: { company: true }
    });
    return this.authResponse(user);
  }

  async avatarFile(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { avatarObjectKey: true } });
    if (!user?.avatarObjectKey) throw new NotFoundException("Avatar not found.");
    const object = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: user.avatarObjectKey }));
    const chunks: Buffer[] = [];
    for await (const chunk of object.Body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
    return { buffer: Buffer.concat(chunks), contentType: object.ContentType ?? "image/jpeg" };
  }

  private authResponse(user: { id: string; companyId: string; email: string; name: string; role: UserRole; avatarObjectKey?: string | null; company?: { name: string } | null }) {
    const access_token = this.jwt.sign({
      sub: user.id,
      companyId: user.companyId,
      email: user.email,
      role: user.role
    });
    return {
      data: {
        access_token,
        user: {
          id: user.id,
          company_id: user.companyId,
          company_name: user.company?.name ?? null,
          email: user.email,
          name: user.name,
          role: user.role,
          avatar_url: this.avatarUrl(user.id, user.avatarObjectKey ?? null)
        }
      }
    };
  }

  private avatarUrl(userId: string, objectKey?: string | null) {
    if (!objectKey) return null;
    const publicBase = this.config.get<string>("API_PUBLIC_URL", "http://localhost:4000");
    return `${publicBase}/api/v1/auth/users/${userId}/avatar`;
  }

  private async recordAuthEvent(input: {
    companyId?: string;
    userId?: string;
    email: string;
    eventType: string;
    success: boolean;
    meta?: { ipAddress?: string | null; userAgent?: string | null };
  }) {
    await this.prisma.authEvent.create({
      data: {
        companyId: input.companyId,
        userId: input.userId,
        email: input.email,
        eventType: input.eventType,
        success: input.success,
        ipAddress: input.meta?.ipAddress ?? null,
        userAgent: input.meta?.userAgent ?? null
      }
    });
  }
}

