import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "crypto";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ProjectsService } from "../projects/projects.service";
import { toPhotoResponse } from "../photos/photos.service";
import { RevitRoomOverlayDto, RevitSheetViewDto, RevitConnectDto, SyncFloorPlanDto, SyncRoomsDto, SyncSheetsDto } from "./dto";

type RevitSheetWithRelations = Prisma.RevitSheetGetPayload<{ include: { views: true; overlays: true } }>;

@Injectable()
export class RevitService {
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
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

  async connect(user: { sub: string; companyId: string; role: string }, dto: RevitConnectDto) {
    await this.projects.assertProjectRole(user, dto.project_id, ["BIM_MANAGER", "PROJECT_ADMIN", "COMPANY_ADMIN"]);
    const model = await this.prisma.revitModel.create({
      data: { projectId: dto.project_id, modelName: dto.model_name, documentGuid: dto.document_guid }
    });
    return { data: { revit_model_id: model.id, project_id: model.projectId, model_name: model.modelName } };
  }

  async syncRooms(user: { sub: string; companyId: string; role: string }, dto: SyncRoomsDto) {
    await this.projects.assertProjectRole(user, dto.project_id, ["BIM_MANAGER", "PROJECT_ADMIN", "COMPANY_ADMIN"]);
    const mappings: Array<{
      room_id: string;
      bim_photo_room_id: string;
      revit_unique_id: string | null;
      revit_element_id: string | null;
    }> = [];
    for (const incoming of dto.rooms) {
      const existingByBimPhotoRoomId = incoming.bim_photo_room_id
        ? await this.prisma.room.findUnique({ where: { bimPhotoRoomId: incoming.bim_photo_room_id } })
        : null;
      const existingByProjectRoomId =
        existingByBimPhotoRoomId?.projectId === dto.project_id ? existingByBimPhotoRoomId : null;
      const existingByProjectRevitId =
        existingByProjectRoomId ??
        (await this.prisma.room.findFirst({
          where: { projectId: dto.project_id, revitUniqueId: incoming.revit_unique_id }
        }));
      const canReuseIncomingBimPhotoRoomId =
        Boolean(incoming.bim_photo_room_id) &&
        (!existingByBimPhotoRoomId || existingByBimPhotoRoomId.projectId === dto.project_id);
      const bimPhotoRoomId =
        existingByProjectRevitId?.bimPhotoRoomId ??
        (canReuseIncomingBimPhotoRoomId && incoming.bim_photo_room_id ? incoming.bim_photo_room_id : `rm_${randomUUID()}`);

      const room = existingByProjectRevitId
        ? await this.prisma.room.update({
            where: { id: existingByProjectRevitId.id },
            data: {
              revitModelId: dto.revit_model_id,
              revitUniqueId: incoming.revit_unique_id,
              revitElementId: incoming.revit_element_id,
              roomNumber: incoming.room_number,
              roomName: incoming.room_name,
              levelName: incoming.level_name
            }
          })
        : await this.prisma.room.create({
            data: {
              projectId: dto.project_id,
              revitModelId: dto.revit_model_id,
              bimPhotoRoomId,
              revitUniqueId: incoming.revit_unique_id,
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

  async syncFloorPlan(user: { sub: string; companyId: string; role: string }, dto: SyncFloorPlanDto) {
    await this.projects.assertProjectRole(user, dto.project_id, ["BIM_MANAGER", "PROJECT_ADMIN", "COMPANY_ADMIN"]);

    const floorPlan = await this.prisma.revitFloorPlan.create({
      data: {
        projectId: dto.project_id,
        revitModelId: dto.revit_model_id,
        levelName: dto.level_name,
        viewName: dto.view_name,
        sourceViewId: dto.source_view_id,
        bounds: dto.bounds as unknown as Prisma.InputJsonValue,
        rooms: dto.rooms as unknown as Prisma.InputJsonValue
      }
    });

    return { data: toFloorPlanResponse(floorPlan) };
  }

  async floorPlans(user: { sub: string; companyId: string }, projectId: string) {
    await this.projects.assertProjectAccess(user.sub, user.companyId, projectId);
    const plans = await this.prisma.revitFloorPlan.findMany({
      where: { projectId },
      orderBy: [{ createdAt: "desc" }],
      take: 20
    });
    return { data: plans.map(toFloorPlanResponse) };
  }

  async syncSheets(user: { sub: string; companyId: string; role: string }, dto: SyncSheetsDto) {
    await this.projects.assertProjectRole(user, dto.project_id, ["BIM_MANAGER", "PROJECT_ADMIN", "COMPANY_ADMIN"]);

    const results = await this.prisma.$transaction(async (tx) => {
      const syncedSheets: RevitSheetWithRelations[] = [];
      for (const incoming of dto.sheets) {
        const existingSheet = await findExistingSheet(tx, dto.project_id, incoming.revit_unique_id, incoming.sheet_number);
        const sheetData = {
          projectId: dto.project_id,
          revitModelId: dto.revit_model_id,
          revitUniqueId: incoming.revit_unique_id,
          revitElementId: incoming.revit_element_id,
          sheetNumber: incoming.sheet_number,
          sheetName: incoming.sheet_name,
          widthMm: incoming.width_mm,
          heightMm: incoming.height_mm,
          assetObjectKey: incoming.asset?.object_key,
          assetMimeType: incoming.asset?.mime_type,
          assetWidthPx: incoming.asset?.width_px,
          assetHeightPx: incoming.asset?.height_px,
          syncedAt: new Date()
        };
        const sheet = existingSheet
          ? await tx.revitSheet.update({ where: { id: existingSheet.id }, data: sheetData })
          : await tx.revitSheet.create({ data: sheetData });

        await tx.revitRoomOverlay.deleteMany({ where: { sheetId: sheet.id } });
        await tx.revitView.deleteMany({ where: { sheetId: sheet.id } });

        const viewIdByKey = new Map<string, string>();
        for (const view of incoming.views) {
          const createdView = await tx.revitView.create({
            data: {
              projectId: dto.project_id,
              revitModelId: dto.revit_model_id,
              sheetId: sheet.id,
              sourceViewId: view.source_view_id,
              viewportElementId: view.viewport_element_id,
              viewName: view.view_name,
              viewType: view.view_type,
              scale: view.scale,
              viewportBox: view.viewport_box ? (view.viewport_box as unknown as Prisma.InputJsonValue) : undefined
            }
          });
          viewIdByKey.set(viewKey(view), createdView.id);
        }

        const bimPhotoRoomIds = Array.from(new Set(incoming.overlays.map((overlay) => overlay.bim_photo_room_id)));
        const rooms = await tx.room.findMany({
          where: { projectId: dto.project_id, bimPhotoRoomId: { in: bimPhotoRoomIds } },
          select: { id: true, bimPhotoRoomId: true }
        });
        const roomIdByBimPhotoRoomId = new Map(rooms.map((room) => [room.bimPhotoRoomId, room.id]));

        for (const overlay of incoming.overlays) {
          const resolvedRoomId = overlay.room_id ?? roomIdByBimPhotoRoomId.get(overlay.bim_photo_room_id);
          await tx.revitRoomOverlay.create({
            data: {
              projectId: dto.project_id,
              sheetId: sheet.id,
              viewId: viewIdByKey.get(overlayKey(overlay)),
              roomId: resolvedRoomId,
              bimPhotoRoomId: overlay.bim_photo_room_id,
              polygon: overlay.polygon as unknown as Prisma.InputJsonValue,
              normalizedPolygon: overlay.normalized_polygon as unknown as Prisma.InputJsonValue,
              bbox: overlay.bbox as unknown as Prisma.InputJsonValue
            }
          });
        }

        const hydrated = await tx.revitSheet.findUnique({
          where: { id: sheet.id },
          include: { views: true, overlays: true }
        });
        if (hydrated) syncedSheets.push(hydrated);
      }
      return syncedSheets;
    });

    return { data: results.map((sheet) => toSheetResponse(sheet, this.config)) };
  }

  async sheets(user: { sub: string; companyId: string }, projectId: string) {
    await this.projects.assertProjectAccess(user.sub, user.companyId, projectId);
    const sheets = await this.prisma.revitSheet.findMany({
      where: { projectId },
      include: { views: true, overlays: true },
      orderBy: [{ sheetNumber: "asc" }, { syncedAt: "desc" }]
    });
    return { data: sheets.map((sheet) => toSheetResponse(sheet, this.config)) };
  }

  async sheetAsset(user: { sub: string; companyId: string }, sheetId: string) {
    const sheet = await this.prisma.revitSheet.findUnique({ where: { id: sheetId } });
    if (!sheet || !sheet.assetObjectKey) throw new NotFoundException("Sheet asset not found.");
    await this.projects.assertProjectAccess(user.sub, user.companyId, sheet.projectId);
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: sheet.assetObjectKey });
    const object = await this.s3.send(command);
    const chunks: Buffer[] = [];
    for await (const chunk of object.Body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
    return {
      buffer: Buffer.concat(chunks),
      contentType: object.ContentType ?? sheet.assetMimeType ?? "application/octet-stream"
    };
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

function viewKey(view: Pick<RevitSheetViewDto, "source_view_id" | "viewport_element_id">) {
  return `${view.source_view_id}:${view.viewport_element_id ?? ""}`;
}

function overlayKey(overlay: Pick<RevitRoomOverlayDto, "source_view_id" | "viewport_element_id">) {
  return `${overlay.source_view_id ?? ""}:${overlay.viewport_element_id ?? ""}`;
}

async function findExistingSheet(
  tx: Prisma.TransactionClient,
  projectId: string,
  revitUniqueId: string | undefined,
  sheetNumber: string
) {
  if (revitUniqueId) {
    const byUniqueId = await tx.revitSheet.findFirst({
      where: { projectId, revitUniqueId }
    });
    if (byUniqueId) return byUniqueId;
  }

  return tx.revitSheet.findFirst({
    where: { projectId, sheetNumber }
  });
}

function toFloorPlanResponse(plan: {
  id: string;
  projectId: string;
  revitModelId: string | null;
  levelName: string;
  viewName: string;
  sourceViewId: string | null;
  bounds: Prisma.JsonValue;
  rooms: Prisma.JsonValue;
  createdAt: Date;
}) {
  return {
    id: plan.id,
    project_id: plan.projectId,
    revit_model_id: plan.revitModelId,
    level_name: plan.levelName,
    view_name: plan.viewName,
    source_view_id: plan.sourceViewId,
    bounds: plan.bounds,
    rooms: plan.rooms,
    created_at: plan.createdAt
  };
}

function toSheetResponse(sheet: {
  id: string;
  projectId: string;
  revitModelId: string | null;
  revitUniqueId: string | null;
  revitElementId: string | null;
  sheetNumber: string;
  sheetName: string;
  widthMm: Prisma.Decimal | null;
  heightMm: Prisma.Decimal | null;
  assetObjectKey: string | null;
  assetMimeType: string | null;
  assetWidthPx: number | null;
  assetHeightPx: number | null;
  syncedAt: Date;
  createdAt: Date;
  views?: Array<{
    id: string;
    sourceViewId: string;
    viewportElementId: string | null;
    viewName: string;
    viewType: string;
    scale: number | null;
    viewportBox: Prisma.JsonValue | null;
  }>;
  overlays?: Array<{
    id: string;
    viewId: string | null;
    roomId: string | null;
    bimPhotoRoomId: string;
    polygon: Prisma.JsonValue;
    normalizedPolygon: Prisma.JsonValue;
    bbox: Prisma.JsonValue;
    coordinateVersion: string;
  }>;
}, config: ConfigService) {
  const publicBase = config.get<string>("API_PUBLIC_URL", "http://localhost:4000");
  return {
    id: sheet.id,
    project_id: sheet.projectId,
    revit_model_id: sheet.revitModelId,
    revit_unique_id: sheet.revitUniqueId,
    revit_element_id: sheet.revitElementId,
    sheet_number: sheet.sheetNumber,
    sheet_name: sheet.sheetName,
    width_mm: sheet.widthMm ? Number(sheet.widthMm) : null,
    height_mm: sheet.heightMm ? Number(sheet.heightMm) : null,
    asset: sheet.assetObjectKey
      ? {
          object_key: sheet.assetObjectKey,
          mime_type: sheet.assetMimeType,
          width_px: sheet.assetWidthPx,
          height_px: sheet.assetHeightPx,
          url: `${publicBase}/api/v1/revit/sheets/${sheet.id}/asset`
        }
      : null,
    views:
      sheet.views?.map((view) => ({
        id: view.id,
        source_view_id: view.sourceViewId,
        viewport_element_id: view.viewportElementId,
        view_name: view.viewName,
        view_type: view.viewType,
        scale: view.scale,
        viewport_box: view.viewportBox
      })) ?? [],
    overlays:
      sheet.overlays?.map((overlay) => ({
        id: overlay.id,
        view_id: overlay.viewId,
        room_id: overlay.roomId,
        bim_photo_room_id: overlay.bimPhotoRoomId,
        polygon: overlay.polygon,
        normalized_polygon: overlay.normalizedPolygon,
        bbox: overlay.bbox,
        coordinate_version: overlay.coordinateVersion
      })) ?? [],
    synced_at: sheet.syncedAt,
    created_at: sheet.createdAt
  };
}
