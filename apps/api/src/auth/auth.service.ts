import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { UserRole } from "@prisma/client";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../prisma/prisma.service";
import { LoginDto, RegisterDto } from "./dto";

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService
  ) {}

  async register(dto: RegisterDto) {
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

    return this.authResponse(user);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
      include: { company: true }
    });
    if (!user) throw new UnauthorizedException("Invalid credentials.");
    const ok = await bcrypt.compare(dto.password, user.passwordHash);
    if (!ok) throw new UnauthorizedException("Invalid credentials.");
    return this.authResponse(user);
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, role: true, company: true }
    });
    if (!user) throw new UnauthorizedException();
    return { data: user };
  }

  private authResponse(user: { id: string; companyId: string; email: string; name: string; role: UserRole; company?: unknown }) {
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
          email: user.email,
          name: user.name,
          role: user.role
        }
      }
    };
  }
}

