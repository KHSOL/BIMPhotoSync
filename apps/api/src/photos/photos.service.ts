import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { InjectQueue } from "@nestjs/bullmq";
import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Photo, Prisma, ProgressStatus } from "@prisma/client";
import { Queue } from "bullmq";
import { PrismaService } from "../prisma/prisma.service";
import { ProjectsService } from "../projects/projects.service";
import { RoomsService } from "../rooms/rooms.service";
import { CommitPhotoDto, PhotoQueryDto, ReviewAnalysisDto } from "./dto";

@Injectable()
export class PhotosService {
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly rooms: RoomsService,
    private readonly projects: ProjectsService,
    private readonly config: ConfigService,
    @InjectQueue("photo-ai") private readonly aiQueue: Queue
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

  async commit(user: { sub: string; companyId: string }, dto: CommitPhotoDto) {
    const project = await this.projects.assertProjectAccess(user.sub, user.companyId, dto.project_id);
    await this.rooms.assertRoomInProject(dto.room_id, dto.project_id);
    const tradeCategory = dto.trade_category_id
      ? await this.prisma.tradeCategory.findFirst({
          where: { id: dto.trade_category_id, projectId: dto.project_id, companyId: project.companyId, isActive: true }
        })
      : null;
    if (dto.trade_category_id && !tradeCategory) throw new BadRequestException("Trade category not found.");
    const upload = await this.prisma.photoUpload.findFirst({
      where: { id: dto.upload_id, projectId: dto.project_id, committedAt: null }
    });
    if (!upload) throw new NotFoundException("Upload not found.");
    if (upload.expiresAt < new Date()) throw new BadRequestException("Upload expired.");

    const photo = await this.prisma.$transaction(async (tx) => {
      const created = await tx.photo.create({
        data: {
          projectId: dto.project_id,
          roomId: dto.room_id,
          uploadedById: user.sub,
          workSurface: dto.work_surface,
          trade: dto.trade,
          tradeCategoryId: tradeCategory?.id,
          workDate: new Date(dto.work_date),
          workerName: dto.worker_name,
          description: dto.description,
          progressStatus: inferInitialProgressStatus(dto.description),
          takenAt: dto.taken_at ? new Date(dto.taken_at) : undefined,
          objectKey: upload.objectKey,
          mimeType: upload.mimeType,
          fileSize: upload.fileSize,
          checksumSha256: upload.checksumSha256
        }
      });
      await tx.photoUpload.update({ where: { id: upload.id }, data: { committedAt: new Date() } });
      return created;
    });

    const job = await this.aiQueue.add("analyze-photo", { photoId: photo.id }, { attempts: 3, backoff: { type: "exponential", delay: 5000 } });
    await this.projects.recordAuditEvent({
      companyId: project.companyId,
      projectId: dto.project_id,
      actorUserId: user.sub,
      action: "CREATE",
      resourceType: "PHOTO",
      resourceId: photo.id,
      detail: "사진 업로드"
    });
    return { data: { ...toPhotoResponse(photo, this.config), analysis_job: { job_id: job.id, status: "QUEUED" } } };
  }

  async list(user: { sub: string; companyId: string }, query: PhotoQueryDto) {
    const room = query.room_id ? await this.prisma.room.findFirst({ where: { id: query.room_id, projectId: query.project_id } }) : null;
    if (query.room_id && !room) throw new NotFoundException("Room not found in project.");
    await this.projects.assertProjectAccess(user.sub, user.companyId, query.project_id);

    const where: Prisma.PhotoWhereInput = {
      projectId: query.project_id,
      status: "ACTIVE",
      ...(query.room_id ? { roomId: query.room_id } : {}),
      ...(query.trade ? { trade: query.trade } : {}),
      ...(query.trade_category_id ? { tradeCategoryId: query.trade_category_id } : {}),
      ...(query.work_surface ? { workSurface: query.work_surface } : {}),
      ...(query.date_from || query.date_to
        ? {
            workDate: {
              ...(query.date_from ? { gte: new Date(query.date_from) } : {}),
              ...(query.date_to ? { lte: new Date(query.date_to) } : {})
            }
          }
        : {})
    };
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.page_size ?? 30));
    const [total, photos] = await this.prisma.$transaction([
      this.prisma.photo.count({ where }),
      this.prisma.photo.findMany({
        where,
        include: { room: true, tradeCategory: true, analyses: { orderBy: { createdAt: "desc" }, take: 1 } },
        orderBy: [{ workDate: "desc" }, { uploadedAt: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize
      })
    ]);
    return {
      data: photos.map((photo) => toPhotoResponse(photo, this.config)),
      page,
      page_size: pageSize,
      total,
      has_next: page * pageSize < total
    };
  }

  async get(user: { sub: string; companyId: string }, photoId: string) {
    const photo = await this.prisma.photo.findUnique({
      where: { id: photoId },
      include: { room: true, tradeCategory: true, analyses: { orderBy: { createdAt: "desc" }, take: 1 } }
    });
    if (!photo) throw new NotFoundException("Photo not found.");
    await this.projects.assertProjectAccess(user.sub, user.companyId, photo.projectId);
    return { data: toPhotoResponse(photo, this.config) };
  }

  async getAnalysis(user: { sub: string; companyId: string }, photoId: string) {
    const photo = await this.prisma.photo.findUnique({ where: { id: photoId } });
    if (!photo) throw new NotFoundException("Photo not found.");
    await this.projects.assertProjectAccess(user.sub, user.companyId, photo.projectId);
    const analysis = await this.prisma.photoAiAnalysis.findFirst({ where: { photoId }, orderBy: { createdAt: "desc" } });
    if (!analysis) throw new NotFoundException("Analysis not found.");
    return { data: analysis };
  }

  async objectFile(user: { sub: string; companyId: string }, photoId: string) {
    const photo = await this.prisma.photo.findUnique({ where: { id: photoId } });
    if (!photo) throw new NotFoundException("Photo not found.");
    await this.projects.assertProjectAccess(user.sub, user.companyId, photo.projectId);
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: photo.objectKey });
    const object = await this.s3.send(command);
    const chunks: Buffer[] = [];
    for await (const chunk of object.Body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
    return {
      buffer: Buffer.concat(chunks),
      contentType: object.ContentType ?? photo.mimeType
    };
  }

  async reviewAnalysis(user: { sub: string; companyId: string; role: string }, photoId: string, dto: ReviewAnalysisDto) {
    const photo = await this.prisma.photo.findUnique({ where: { id: photoId } });
    if (!photo) throw new NotFoundException("Photo not found.");
    await this.projects.assertProjectRole(user, photo.projectId, ["MANAGER", "PROJECT_ADMIN", "BIM_MANAGER", "COMPANY_ADMIN"]);
    const analysis = await this.prisma.photoAiAnalysis.findFirst({ where: { photoId }, orderBy: { createdAt: "desc" } });
    if (!analysis) throw new NotFoundException("Analysis not found.");
    const updated = await this.prisma.photoAiAnalysis.update({
      where: { id: analysis.id },
      data: {
        summary: dto.summary,
        detectedTrade: dto.detected_trade,
        detectedSurface: dto.detected_surface,
        progressStatus: dto.progress_status,
        requiresHumanReview: false,
        reviewedById: user.sub,
        reviewedAt: new Date()
      }
    });
    if (dto.summary || dto.progress_status) {
      await this.prisma.photo.update({
        where: { id: photoId },
        data: { aiDescription: dto.summary, progressStatus: dto.progress_status }
      });
    }
    return { data: updated };
  }
}

function inferInitialProgressStatus(description: string | undefined) {
  return description?.includes("완료") ? ProgressStatus.COMPLETED : ProgressStatus.PENDING_REVIEW;
}

export function toPhotoResponse(photo: Photo & { room?: unknown; tradeCategory?: { id: string; code: string; label: string } | null; analyses?: unknown[] }, config: ConfigService) {
  const railwayDomain = config.get<string>("RAILWAY_PUBLIC_DOMAIN");
  const publicBase =
    config.get<string>("API_PUBLIC_URL") ??
    (railwayDomain ? `https://${railwayDomain}` : config.get<string>("RENDER_EXTERNAL_URL", "http://localhost:4000"));
  return {
    id: photo.id,
    project_id: photo.projectId,
    room_id: photo.roomId,
    work_surface: photo.workSurface,
    trade: photo.trade,
    trade_category_id: photo.tradeCategoryId,
    trade_category: photo.tradeCategory
      ? { id: photo.tradeCategory.id, code: photo.tradeCategory.code, label: photo.tradeCategory.label }
      : null,
    work_date: photo.workDate.toISOString().slice(0, 10),
    worker_name: photo.workerName,
    description: photo.description,
    ai_description: photo.aiDescription,
    progress_status: photo.progressStatus,
    object_key: photo.objectKey,
    photo_url: `${publicBase}/api/v1/photos/${photo.id}/object`,
    uploaded_at: photo.uploadedAt,
    room: photo.room,
    latest_analysis: photo.analyses?.[0] ?? null
  };
}
