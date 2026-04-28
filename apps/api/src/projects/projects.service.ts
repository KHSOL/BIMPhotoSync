import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { CreateProjectDto, JoinProjectDto } from "./dto";

type ProjectActor = { sub: string; companyId: string; role: string };

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: ProjectActor) {
    const projects = await this.prisma.project.findMany({
      where: {
        companyId: user.companyId,
        OR: [
          { members: { some: { userId: user.sub } } },
          ...(user.role === "COMPANY_ADMIN" ? [{}] : [])
        ]
      },
      include: { members: { where: { userId: user.sub }, select: { role: true } } },
      orderBy: { createdAt: "desc" }
    });
    return { data: projects.map(toProjectResponse) };
  }

  async create(user: ProjectActor, dto: CreateProjectDto) {
    if (!["COMPANY_ADMIN", "PROJECT_ADMIN"].includes(user.role)) throw new ForbiddenException();
    const code = dto.code ?? dto.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    const project = await this.prisma.project.create({
      data: {
        companyId: user.companyId,
        name: dto.name,
        code,
        members: { create: { userId: user.sub, role: "PROJECT_ADMIN" } }
      },
      include: { members: { where: { userId: user.sub }, select: { role: true } } }
    });
    return { data: toProjectResponse(project) };
  }

  async join(user: ProjectActor, dto: JoinProjectDto) {
    const project = await this.prisma.project.findFirst({
      where: { companyId: user.companyId, code: dto.project_code },
      include: { members: { where: { userId: user.sub } } }
    });
    if (!project || !project.accessKeyHash) throw new NotFoundException("Project not found.");
    const ok = await bcrypt.compare(dto.access_key, project.accessKeyHash);
    if (!ok) throw new ForbiddenException("Invalid project access key.");

    const member =
      project.members[0] ??
      (await this.prisma.projectMember.create({
        data: { projectId: project.id, userId: user.sub, role: "WORKER" }
      }));

    return { data: { ...toProjectResponse(project), member_role: member.role } };
  }

  async createAccessKey(user: ProjectActor, projectId: string) {
    const project = await this.assertProjectRole(user, projectId, ["PROJECT_ADMIN", "BIM_MANAGER", "COMPANY_ADMIN"]);
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
        OR: [{ members: { some: { userId } } }, { company: { users: { some: { id: userId, role: "COMPANY_ADMIN" } } } }]
      }
    });
    if (!project) throw new ForbiddenException("No project access.");
    return project;
  }

  async assertProjectRole(user: ProjectActor, projectId: string, allowedRoles: string[]) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, companyId: user.companyId },
      include: { members: { where: { userId: user.sub }, select: { role: true } } }
    });
    if (!project) throw new NotFoundException("Project not found.");
    const memberRole = project.members[0]?.role;
    if (!allowedRoles.includes(user.role) && (!memberRole || !allowedRoles.includes(memberRole))) {
      throw new ForbiddenException("Insufficient project role.");
    }
    return project;
  }
}

function toProjectResponse(project: {
  id: string;
  companyId: string;
  name: string;
  code: string;
  createdAt: Date;
  members?: Array<{ role: string }>;
}) {
  return {
    id: project.id,
    company_id: project.companyId,
    name: project.name,
    code: project.code,
    member_role: project.members?.[0]?.role ?? null,
    created_at: project.createdAt
  };
}

