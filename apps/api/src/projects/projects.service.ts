import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { CreateProjectDto } from "./dto";

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: { sub: string; companyId: string; role: string }) {
    const projects = await this.prisma.project.findMany({
      where: {
        companyId: user.companyId,
        OR: [
          { members: { some: { userId: user.sub } } },
          ...(user.role === "COMPANY_ADMIN" ? [{}] : [])
        ]
      },
      orderBy: { createdAt: "desc" }
    });
    return { data: projects.map(toProjectResponse) };
  }

  async create(user: { sub: string; companyId: string; role: string }, dto: CreateProjectDto) {
    if (!["COMPANY_ADMIN", "PROJECT_ADMIN"].includes(user.role)) throw new ForbiddenException();
    const code = dto.code ?? dto.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const project = await this.prisma.project.create({
      data: {
        companyId: user.companyId,
        name: dto.name,
        code,
        members: { create: { userId: user.sub, role: "PROJECT_ADMIN" } }
      }
    });
    return { data: toProjectResponse(project) };
  }

  async createAccessKey(user: { companyId: string; role: string }, projectId: string) {
    if (!["COMPANY_ADMIN", "PROJECT_ADMIN"].includes(user.role)) throw new ForbiddenException();
    const project = await this.prisma.project.findFirst({ where: { id: projectId, companyId: user.companyId } });
    if (!project) throw new NotFoundException("Project not found.");
    const accessKey = `bps_${randomBytes(18).toString("base64url")}`;
    const accessKeyHash = await bcrypt.hash(accessKey, 12);
    await this.prisma.project.update({ where: { id: projectId }, data: { accessKeyHash } });
    return { data: { project_id: projectId, access_key: accessKey } };
  }

  async assertProjectAccess(userId: string, companyId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: {
        id: projectId,
        companyId,
        OR: [{ members: { some: { userId } } }]
      }
    });
    if (!project) throw new ForbiddenException("No project access.");
    return project;
  }
}

function toProjectResponse(project: { id: string; companyId: string; name: string; code: string; createdAt: Date }) {
  return {
    id: project.id,
    company_id: project.companyId,
    name: project.name,
    code: project.code,
    created_at: project.createdAt
  };
}

