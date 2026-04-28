import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { ProjectsService } from "../projects/projects.service";
import { toPhotoResponse } from "../photos/photos.service";
import { RevitConnectDto, SyncRoomsDto } from "./dto";

@Injectable()
export class RevitService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    private readonly config: ConfigService
  ) {}

  async connect(user: { sub: string; companyId: string; role: string }, dto: RevitConnectDto) {
    if (!["BIM_MANAGER", "PROJECT_ADMIN", "COMPANY_ADMIN"].includes(user.role)) throw new ForbiddenException();
    await this.projects.assertProjectAccess(user.sub, user.companyId, dto.project_id);
    const model = await this.prisma.revitModel.create({
      data: { projectId: dto.project_id, modelName: dto.model_name, documentGuid: dto.document_guid }
    });
    return { data: { revit_model_id: model.id, project_id: model.projectId, model_name: model.modelName } };
  }

  async syncRooms(user: { sub: string; companyId: string; role: string }, dto: SyncRoomsDto) {
    if (!["BIM_MANAGER", "PROJECT_ADMIN", "COMPANY_ADMIN"].includes(user.role)) throw new ForbiddenException();
    await this.projects.assertProjectAccess(user.sub, user.companyId, dto.project_id);
    const mappings: Array<{
      room_id: string;
      bim_photo_room_id: string;
      revit_unique_id: string | null;
      revit_element_id: string | null;
    }> = [];
    for (const incoming of dto.rooms) {
      const bimPhotoRoomId = incoming.bim_photo_room_id || `rm_${randomUUID()}`;
      const room = await this.prisma.room.upsert({
        where: { revitUniqueId: incoming.revit_unique_id },
        create: {
          projectId: dto.project_id,
          revitModelId: dto.revit_model_id,
          bimPhotoRoomId,
          revitUniqueId: incoming.revit_unique_id,
          revitElementId: incoming.revit_element_id,
          roomNumber: incoming.room_number,
          roomName: incoming.room_name,
          levelName: incoming.level_name
        },
        update: {
          revitModelId: dto.revit_model_id,
          revitElementId: incoming.revit_element_id,
          roomNumber: incoming.room_number,
          roomName: incoming.room_name,
          levelName: incoming.level_name
        }
      });
      mappings.push({
        room_id: room.id,
        bim_photo_room_id: room.bimPhotoRoomId,
        revit_unique_id: room.revitUniqueId,
        revit_element_id: room.revitElementId
      });
    }
    return { data: { project_id: dto.project_id, room_mappings: mappings } };
  }

  async roomPhotos(user: { sub: string; companyId: string }, bimPhotoRoomId: string) {
    const room = await this.prisma.room.findUnique({ where: { bimPhotoRoomId }, include: { project: true } });
    if (!room) throw new NotFoundException("Room mapping not found.");
    await this.projects.assertProjectAccess(user.sub, user.companyId, room.projectId);
    const photos = await this.prisma.photo.findMany({
      where: { roomId: room.id, status: "ACTIVE" },
      include: { analyses: { orderBy: { createdAt: "desc" }, take: 1 } },
      orderBy: [{ workDate: "desc" }, { uploadedAt: "desc" }],
      take: 100
    });
    return {
      data: {
        room: {
          id: room.id,
          bim_photo_room_id: room.bimPhotoRoomId,
          room_number: room.roomNumber,
          room_name: room.roomName,
          level_name: room.levelName
        },
        photos: photos.map((photo) => toPhotoResponse(photo, this.config))
      }
    };
  }
}
