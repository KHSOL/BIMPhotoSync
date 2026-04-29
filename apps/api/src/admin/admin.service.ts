import { ForbiddenException, Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

type AdminActor = { role: string };

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async overview(user: AdminActor) {
    if (user.role !== "SUPER_ADMIN") throw new ForbiddenException("SUPER_ADMIN only.");

    const [companies, recentPhotos, totals] = await Promise.all([
      this.prisma.company.findMany({
        include: {
          _count: { select: { users: true, projects: true } },
          projects: {
            orderBy: { createdAt: "desc" },
            take: 8,
            include: {
              _count: { select: { rooms: true, photos: true, revitModels: true, floorPlans: true } }
            }
          }
        },
        orderBy: { createdAt: "desc" }
      }),
      this.prisma.photo.findMany({
        take: 12,
        orderBy: { uploadedAt: "desc" },
        include: {
          project: { select: { id: true, name: true, code: true, company: { select: { id: true, name: true } } } },
          room: { select: { id: true, roomName: true, roomNumber: true, levelName: true } },
          uploadedBy: { select: { id: true, name: true, email: true } }
        }
      }),
      Promise.all([
        this.prisma.company.count(),
        this.prisma.project.count(),
        this.prisma.user.count(),
        this.prisma.room.count(),
        this.prisma.photo.count(),
        this.prisma.revitModel.count()
      ])
    ]);

    const [companyCount, projectCount, userCount, roomCount, photoCount, revitModelCount] = totals;

    return {
      data: {
        totals: {
          companies: companyCount,
          projects: projectCount,
          users: userCount,
          rooms: roomCount,
          photos: photoCount,
          revit_models: revitModelCount
        },
        companies: companies.map((company) => ({
          id: company.id,
          name: company.name,
          user_count: company._count.users,
          project_count: company._count.projects,
          created_at: company.createdAt,
          projects: company.projects.map((project) => ({
            id: project.id,
            name: project.name,
            code: project.code,
            room_count: project._count.rooms,
            photo_count: project._count.photos,
            revit_model_count: project._count.revitModels,
            floor_plan_count: project._count.floorPlans,
            created_at: project.createdAt
          }))
        })),
        recent_photos: recentPhotos.map((photo) => ({
          id: photo.id,
          project: photo.project,
          room: photo.room,
          uploaded_by: photo.uploadedBy,
          work_surface: photo.workSurface,
          trade: photo.trade,
          work_date: photo.workDate,
          uploaded_at: photo.uploadedAt
        }))
      }
    };
  }
}
