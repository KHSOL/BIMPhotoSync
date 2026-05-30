import { Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { Prisma, ProgressStatus, WorkSurface } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ProjectsService } from "../projects/projects.service";
import { CreateRoomDto, UpdateRoomDto } from "./dto";

const workSurfaces = [
  WorkSurface.FLOOR,
  WorkSurface.WALL,
  WorkSurface.CEILING,
  WorkSurface.WINDOW,
  WorkSurface.DOOR,
  WorkSurface.PIPE,
  WorkSurface.ELECTRIC,
  WorkSurface.OTHER
] as const;

type SurfaceProgressStatus = "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
type RoomWithProgressPhotos = Prisma.RoomGetPayload<{
  include: {
    photos: {
      select: {
        workSurface: true;
        description: true;
        aiDescription: true;
        progressStatus: true;
      };
    };
  };
}>;

@Injectable()
export class RoomsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService
  ) {}

  async list(user: { sub: string; companyId: string }, projectId: string, query?: { q?: string }) {
    await this.projects.assertProjectAccess(user.sub, user.companyId, projectId);
    const rooms = await this.prisma.room.findMany({
      where: {
        projectId,
        status: "ACTIVE",
        ...(query?.q
          ? {
              OR: [
                { roomName: { contains: query.q, mode: "insensitive" } },
                { roomNumber: { contains: query.q, mode: "insensitive" } },
                { levelName: { contains: query.q, mode: "insensitive" } }
              ]
            }
          : {})
      },
      include: {
        photos: {
          where: { status: "ACTIVE" },
          select: {
            workSurface: true,
            description: true,
            aiDescription: true,
            progressStatus: true
          }
        }
      },
      orderBy: [{ levelName: "asc" }, { roomNumber: "asc" }, { roomName: "asc" }]
    });
    return { data: rooms.map(toRoomResponse) };
  }

  async create(user: { sub: string; companyId: string; role: string }, projectId: string, dto: CreateRoomDto) {
    await this.projects.assertProjectRole(user, projectId, ["MANAGER", "PROJECT_ADMIN", "BIM_MANAGER", "COMPANY_ADMIN"]);
    const room = await this.prisma.room.create({
      data: {
        projectId,
        bimPhotoRoomId: `rm_${randomUUID()}`,
        roomNumber: dto.room_number,
        roomName: dto.room_name,
        levelName: dto.level_name,
        locationText: dto.location_text
      }
    });
    return { data: toRoomResponse(room) };
  }

  async update(user: { sub: string; companyId: string; role: string }, roomId: string, dto: UpdateRoomDto) {
    const room = await this.prisma.room.findUnique({ where: { id: roomId }, include: { project: true } });
    if (!room || room.project.companyId !== user.companyId) throw new NotFoundException("Room not found.");
    await this.projects.assertProjectRole(user, room.projectId, ["MANAGER", "PROJECT_ADMIN", "BIM_MANAGER", "COMPANY_ADMIN"]);
    const updated = await this.prisma.room.update({
      where: { id: roomId },
      data: {
        roomNumber: dto.room_number,
        roomName: dto.room_name,
        levelName: dto.level_name,
        locationText: dto.location_text
      }
    });
    return { data: toRoomResponse(updated) };
  }

  async assertRoomInProject(roomId: string, projectId: string) {
    const room = await this.prisma.room.findFirst({ where: { id: roomId, projectId } });
    if (!room) throw new NotFoundException("Room not found in project.");
    return room;
  }
}

export function toRoomResponse(room: {
  id: string;
  projectId: string;
  bimPhotoRoomId: string;
  revitUniqueId: string | null;
  revitElementId: string | null;
  roomNumber: string | null;
  roomName: string;
  levelName: string | null;
  locationText: string | null;
  status: string;
  photos?: Array<{
    workSurface: WorkSurface;
    description: string | null;
    aiDescription: string | null;
    progressStatus: ProgressStatus;
  }>;
}) {
  const progressBySurface = room.photos ? buildSurfaceProgress(room.photos) : undefined;
  return {
    id: room.id,
    project_id: room.projectId,
    bim_photo_room_id: room.bimPhotoRoomId,
    revit_unique_id: room.revitUniqueId,
    revit_element_id: room.revitElementId,
    room_number: room.roomNumber,
    room_name: room.roomName,
    level_name: room.levelName,
    location_text: room.locationText,
    status: room.status,
    ...(progressBySurface ? { progress_by_surface: progressBySurface } : {})
  };
}

function buildSurfaceProgress(photos: RoomWithProgressPhotos["photos"]) {
  return workSurfaces.reduce<Record<string, { status: SurfaceProgressStatus; photo_count: number }>>((result, surface) => {
    const surfacePhotos = photos.filter((photo) => photo.workSurface === surface);
    const completed = surfacePhotos.some((photo) => {
      const note = `${photo.description ?? ""} ${photo.aiDescription ?? ""}`;
      return photo.progressStatus === ProgressStatus.COMPLETED || note.includes("완료");
    });
    result[surface] = {
      status: completed ? "COMPLETED" : surfacePhotos.length > 0 ? "IN_PROGRESS" : "NOT_STARTED",
      photo_count: surfacePhotos.length
    };
    return result;
  }, {});
}

