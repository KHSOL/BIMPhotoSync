import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { CreateProjectDto, CreateTradeCategoryDto, JoinProjectDto, PreviewProjectAccessKeyDto } from "./dto";

type ProjectActor = { sub: string; companyId: string; role: string };

@Injectable()
export class ProjectsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(user: ProjectActor) {
    const projects = await this.prisma.project.findMany({
      where: user.role === "SUPER_ADMIN"
        ? {}
        : {
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
    if (!["SUPER_ADMIN", "COMPANY_ADMIN", "PROJECT_ADMIN"].includes(user.role)) throw new ForbiddenException();
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
    const project = await this.findProjectByAccessKey(user, dto.access_key, dto.project_code);
    if (!project) throw new NotFoundException("Project not found.");

    const member =
      project.members[0] ??
      (await this.prisma.projectMember.create({
        data: { projectId: project.id, userId: user.sub, role: "WORKER" }
      }));

    return { data: { ...toProjectResponse(project), member_role: member.role } };
  }

  async previewAccessKey(user: ProjectActor, dto: PreviewProjectAccessKeyDto) {
    const project = await this.findProjectByAccessKey(user, dto.access_key);
    if (!project) throw new NotFoundException("Project not found.");
    return { data: toProjectResponse(project) };
  }

  async createAccessKey(user: ProjectActor, projectId: string) {
    const project = await this.assertProjectRole(user, projectId, ["PROJECT_ADMIN", "BIM_MANAGER", "COMPANY_ADMIN", "SUPER_ADMIN"]);
    const accessKey = `bps_${randomBytes(18).toString("base64url")}`;
    const accessKeyHash = await bcrypt.hash(accessKey, 12);
    await this.prisma.project.update({ where: { id: projectId }, data: { accessKeyHash } });
    return { data: { project_id: projectId, access_key: accessKey } };
  }

  async members(user: ProjectActor, projectId: string) {
    await this.assertProjectRole(user, projectId, ["MANAGER", "PROJECT_ADMIN", "BIM_MANAGER", "COMPANY_ADMIN", "SUPER_ADMIN"]);
    const members = await this.prisma.projectMember.findMany({
      where: { projectId },
      include: { user: { include: { company: true } } },
      orderBy: { createdAt: "desc" }
    });
    return {
      data: members.map((member) => ({
        id: member.id,
        role: member.role,
        created_at: member.createdAt,
        user: {
          id: member.user.id,
          company_id: member.user.companyId,
          company_name: member.user.company.name,
          email: member.user.email,
          name: member.user.name,
          role: member.user.role,
          avatar_url: null
        }
      }))
    };
  }

  async tradeCategories(user: ProjectActor, projectId: string) {
    const project = await this.assertProjectAccess(user.sub, user.companyId, projectId);
    await this.ensureSystemTradeCategories(project.companyId, projectId);
    const categories = await this.prisma.tradeCategory.findMany({
      where: { companyId: project.companyId, projectId, isActive: true },
      orderBy: [{ isSystem: "desc" }, { label: "asc" }]
    });
    return { data: categories.map(toTradeCategoryResponse) };
  }

  async createTradeCategory(user: ProjectActor, projectId: string, dto: CreateTradeCategoryDto) {
    const project = await this.assertProjectRole(user, projectId, ["PROJECT_ADMIN", "BIM_MANAGER", "COMPANY_ADMIN", "SUPER_ADMIN"]);
    const label = dto.label.trim();
    const code = customTradeCode(label);
    const category = await this.prisma.tradeCategory.upsert({
      where: { companyId_projectId_code: { companyId: project.companyId, projectId, code } },
      create: { companyId: project.companyId, projectId, code, label, isSystem: false, isActive: true },
      update: { label, isActive: true }
    });
    await this.recordAuditEvent({
      companyId: project.companyId,
      projectId,
      actorUserId: user.sub,
      action: "CREATE",
      resourceType: "TRADE_CATEGORY",
      resourceId: category.id,
      detail: `${label} 공종 분류 추가`
    });
    return { data: toTradeCategoryResponse(category) };
  }

  async deleteTradeCategory(user: ProjectActor, projectId: string, categoryId: string) {
    const project = await this.assertProjectRole(user, projectId, ["PROJECT_ADMIN", "BIM_MANAGER", "COMPANY_ADMIN", "SUPER_ADMIN"]);
    const category = await this.prisma.tradeCategory.findFirst({ where: { id: categoryId, projectId, companyId: project.companyId } });
    if (!category) throw new NotFoundException("Trade category not found.");
    if (category.isSystem) throw new ForbiddenException("System trade categories cannot be deleted.");
    const updated = await this.prisma.tradeCategory.update({ where: { id: categoryId }, data: { isActive: false } });
    await this.recordAuditEvent({
      companyId: project.companyId,
      projectId,
      actorUserId: user.sub,
      action: "DELETE",
      resourceType: "TRADE_CATEGORY",
      resourceId: categoryId,
      detail: `${category.label} 공종 분류 삭제`
    });
    return { data: toTradeCategoryResponse(updated) };
  }

  async auditEvents(user: ProjectActor, projectId: string, limit = 50) {
    await this.assertProjectRole(user, projectId, ["MANAGER", "PROJECT_ADMIN", "BIM_MANAGER", "COMPANY_ADMIN", "SUPER_ADMIN"]);
    const events = await this.prisma.auditEvent.findMany({
      where: { projectId },
      include: { actor: { select: { id: true, name: true, email: true, role: true } }, project: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take: Math.min(100, Math.max(1, limit))
    });
    return { data: events.map(toAuditEventResponse) };
  }

  async authEvents(user: ProjectActor, projectId: string, limit = 20) {
    const project = await this.assertProjectRole(user, projectId, ["MANAGER", "PROJECT_ADMIN", "BIM_MANAGER", "COMPANY_ADMIN", "SUPER_ADMIN"]);
    const memberUserIds = await this.prisma.projectMember.findMany({ where: { projectId }, select: { userId: true } });
    const userIds = memberUserIds.map((member) => member.userId);
    const events = await this.prisma.authEvent.findMany({
      where: { companyId: project.companyId, eventType: "LOGIN", userId: { in: userIds } },
      include: { user: { select: { id: true, name: true, email: true, role: true } } },
      orderBy: { createdAt: "desc" },
      take: Math.min(100, Math.max(1, limit))
    });
    return { data: events.map(toAuthEventResponse) };
  }

  async recordAuditEvent(input: {
    companyId: string;
    projectId?: string | null;
    actorUserId?: string | null;
    action: string;
    resourceType: string;
    resourceId?: string | null;
    detail?: string | null;
    metadata?: Record<string, string | number | boolean | null>;
    ipAddress?: string | null;
  }) {
    await this.prisma.auditEvent.create({
      data: {
        companyId: input.companyId,
        projectId: input.projectId ?? null,
        actorUserId: input.actorUserId ?? null,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId ?? null,
        detail: input.detail ?? null,
        metadata: input.metadata ?? undefined,
        ipAddress: input.ipAddress ?? null
      }
    });
  }

  private async ensureSystemTradeCategories(companyId: string, projectId: string) {
    await seedSystemTrades(this.prisma, companyId, projectId);
  }

  async assertProjectAccess(userId: string, companyId: string, projectId: string) {
    const actor = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (actor?.role === "SUPER_ADMIN") {
      const project = await this.prisma.project.findUnique({ where: { id: projectId } });
      if (!project) throw new ForbiddenException("No project access.");
      return project;
    }

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
    if (user.role === "SUPER_ADMIN") {
      const project = await this.prisma.project.findUnique({ where: { id: projectId } });
      if (!project) throw new NotFoundException("Project not found.");
      return project;
    }

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

  private async findProjectByAccessKey(user: ProjectActor, accessKey: string, projectCode?: string) {
    const trimmedKey = accessKey.trim();
    const trimmedCode = projectCode?.trim();
    if (!trimmedKey) return null;

    const candidates = await this.prisma.project.findMany({
      where: {
        accessKeyHash: { not: null },
        ...(user.role === "SUPER_ADMIN" ? {} : { companyId: user.companyId }),
        ...(trimmedCode ? { code: trimmedCode } : {})
      },
      include: { members: { where: { userId: user.sub } } },
      orderBy: { createdAt: "desc" }
    });

    for (const candidate of candidates) {
      if (candidate.accessKeyHash && (await bcrypt.compare(trimmedKey, candidate.accessKeyHash))) return candidate;
    }

    return null;
  }
}

const systemTrades = [
  ["WATERPROOF", "방수"],
  ["TILE", "타일"],
  ["PAINT", "도장"],
  ["ELECTRIC", "전기"],
  ["MEP", "기계/설비"],
  ["WINDOW", "창호"],
  ["CONCRETE", "콘크리트"],
  ["OTHER", "기타"]
] as const;

async function seedSystemTrades(prisma: PrismaService, companyId: string, projectId: string) {
  await Promise.all(
    systemTrades.map(([code, label]) =>
      prisma.tradeCategory.upsert({
        where: { companyId_projectId_code: { companyId, projectId, code } },
        create: { companyId, projectId, code, label, isSystem: true, isActive: true },
        update: { label, isSystem: true, isActive: true }
      })
    )
  );
}

function customTradeCode(label: string) {
  return `CUSTOM_${label.toUpperCase().replace(/[^A-Z0-9가-힣]+/g, "_").replace(/(^_|_$)/g, "")}`;
}

function toTradeCategoryResponse(category: { id: string; code: string; label: string; isSystem: boolean; isActive: boolean }) {
  return { id: category.id, code: category.code, label: category.label, is_system: category.isSystem, is_active: category.isActive };
}

function toAuditEventResponse(event: {
  id: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  detail: string | null;
  ipAddress: string | null;
  createdAt: Date;
  actor?: { id: string; name: string; email: string; role: string } | null;
  project?: { id: string; name: string } | null;
}) {
  return {
    id: event.id,
    action: event.action,
    resource_type: event.resourceType,
    resource_id: event.resourceId,
    detail: event.detail,
    ip_address: event.ipAddress,
    created_at: event.createdAt,
    actor: event.actor,
    project: event.project
  };
}

function toAuthEventResponse(event: {
  id: string;
  email: string;
  eventType: string;
  success: boolean;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  user?: { id: string; name: string; email: string; role: string } | null;
}) {
  return {
    id: event.id,
    email: event.email,
    event_type: event.eventType,
    success: event.success,
    ip_address: event.ipAddress,
    user_agent: event.userAgent,
    created_at: event.createdAt,
    user: event.user
  };
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
