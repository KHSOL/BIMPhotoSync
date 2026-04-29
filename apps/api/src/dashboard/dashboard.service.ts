import { ForbiddenException, Injectable } from "@nestjs/common";
import { Prisma, ProgressStatus, RowStatus } from "@prisma/client";
import { JwtUser } from "../common/current-user";
import { PrismaService } from "../prisma/prisma.service";

type ProjectSummary = {
  id: string;
  name: string;
  code: string;
};

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async summary(user: JwtUser, projectId?: string) {
    const projects = await this.accessibleProjects(user);
    const projectIds = projects.map((project) => project.id);
    const selectedProjectIds = this.selectedProjectIds(projectIds, projectId);

    if (projectId && selectedProjectIds.length === 0) {
      throw new ForbiddenException("No project access.");
    }

    const projectWhere = selectedProjectIds.length > 0 ? { id: { in: selectedProjectIds } } : { id: { in: [] as string[] } };
    const roomWhere: Prisma.RoomWhereInput = { projectId: { in: selectedProjectIds }, status: RowStatus.ACTIVE };
    const photoWhere: Prisma.PhotoWhereInput = { projectId: { in: selectedProjectIds }, status: RowStatus.ACTIVE };

    const [
      roomsTotal,
      photosTotal,
      analyzedPhotos,
      reportsTotal,
      revitModelsTotal,
      recentPhotos,
      recentReports,
      photoStatusGroups,
      tradeGroups,
      levelGroups
    ] = await Promise.all([
      this.prisma.room.count({ where: roomWhere }),
      this.prisma.photo.count({ where: photoWhere }),
      this.prisma.photo.count({ where: { ...photoWhere, aiDescription: { not: null } } }),
      this.prisma.generatedReport.count({ where: { projectId: { in: selectedProjectIds } } }),
      this.prisma.revitModel.count({ where: { projectId: { in: selectedProjectIds } } }),
      this.prisma.photo.findMany({
        where: photoWhere,
        include: {
          room: { select: { roomName: true, roomNumber: true, levelName: true } },
          uploadedBy: { select: { name: true } }
        },
        orderBy: [{ workDate: "desc" }, { uploadedAt: "desc" }],
        take: 6
      }),
      this.prisma.generatedReport.findMany({
        where: { projectId: { in: selectedProjectIds } },
        include: { createdBy: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: 5
      }),
      this.prisma.photo.groupBy({
        by: ["progressStatus"],
        where: photoWhere,
        _count: { _all: true }
      }),
      this.prisma.photo.groupBy({
        by: ["trade"],
        where: photoWhere,
        _count: { _all: true }
      }),
      this.prisma.room.groupBy({
        by: ["levelName"],
        where: roomWhere,
        _count: { _all: true }
      })
    ]);

    const completedPhotos = this.countProgress(photoStatusGroups, ProgressStatus.COMPLETED);
    const issuePhotos = this.countProgress(photoStatusGroups, ProgressStatus.BLOCKED);
    const inProgressPhotos = this.countProgress(photoStatusGroups, ProgressStatus.IN_PROGRESS);
    const pendingPhotos = this.countProgress(photoStatusGroups, ProgressStatus.PENDING_REVIEW);

    return {
      data: {
        projects,
        selected_project_id: projectId ?? null,
        totals: {
          rooms: roomsTotal,
          photos: photosTotal,
          analyzed_photos: analyzedPhotos,
          reports: reportsTotal,
          revit_models: revitModelsTotal,
          completed_photos: completedPhotos,
          issue_photos: issuePhotos,
          in_progress_photos: inProgressPhotos,
          pending_photos: pendingPhotos
        },
        trade_distribution: tradeGroups.map((group) => ({
          trade: group.trade,
          count: group._count._all
        })),
        level_distribution: levelGroups.map((group) => ({
          level_name: group.levelName ?? "No Level",
          count: group._count._all
        })),
        recent_photos: recentPhotos.map((photo) => ({
          id: photo.id,
          room_name: photo.room.roomName,
          room_number: photo.room.roomNumber,
          level_name: photo.room.levelName,
          trade: photo.trade,
          work_surface: photo.workSurface,
          work_date: photo.workDate.toISOString().slice(0, 10),
          uploaded_at: photo.uploadedAt,
          uploaded_by: photo.uploadedBy.name
        })),
        recent_reports: recentReports.map((report) => ({
          id: report.id,
          title: report.title,
          status: report.status,
          created_at: report.createdAt,
          created_by: report.createdBy.name
        }))
      }
    };
  }

  private async accessibleProjects(user: JwtUser): Promise<ProjectSummary[]> {
    const projects = await this.prisma.project.findMany({
      where:
        user.role === "SUPER_ADMIN"
          ? {}
          : {
              companyId: user.companyId,
              OR: [{ members: { some: { userId: user.sub } } }, ...(user.role === "COMPANY_ADMIN" ? [{}] : [])]
            },
      select: { id: true, name: true, code: true },
      orderBy: { createdAt: "desc" }
    });
    return projects;
  }

  private selectedProjectIds(projectIds: string[], projectId?: string) {
    if (!projectId) return projectIds;
    return projectIds.includes(projectId) ? [projectId] : [];
  }

  private countProgress(groups: Array<{ progressStatus: ProgressStatus; _count: { _all: number } }>, status: ProgressStatus) {
    return groups.find((group) => group.progressStatus === status)?._count._all ?? 0;
  }
}
