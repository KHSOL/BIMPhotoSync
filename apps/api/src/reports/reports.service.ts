import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ProjectsService } from "../projects/projects.service";
import { GenerateReportDto, ReportQueryDto } from "./dto";

type PhotoForReport = Prisma.PhotoGetPayload<{
  include: { room: true; analyses: { orderBy: { createdAt: "desc" }; take: 1 } };
}>;

type ReportContent = {
  title: string;
  generated_at: string;
  generated_by: string;
  filters: Record<string, string | null>;
  situation: {
    project_id: string;
    room: string | null;
    work_surface: string | null;
    trade: string | null;
    date_range: string | null;
    worker_name: string | null;
  };
  comparison_photos: Array<{
    photo_id: string;
    work_date: string;
    room: string;
    work_surface: string;
    trade: string;
    worker_name: string | null;
    description: string | null;
    ai_description: string | null;
  }>;
  progress_timeline: string[];
  analysis_result: string;
  memo: string | null;
};

@Injectable()
export class ReportsService {
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

  async list(user: { sub: string; companyId: string }, query: ReportQueryDto) {
    const where: Prisma.GeneratedReportWhereInput = {};
    if (query.project_id) {
      await this.projects.assertProjectAccess(user.sub, user.companyId, query.project_id);
      where.projectId = query.project_id;
    } else {
      where.project = {
        companyId: user.companyId,
        OR: [{ members: { some: { userId: user.sub } } }, { company: { users: { some: { id: user.sub, role: "COMPANY_ADMIN" } } } }]
      };
    }

    const reports = await this.prisma.generatedReport.findMany({
      where,
      include: { project: true, createdBy: { select: { id: true, name: true, email: true, role: true } } },
      orderBy: { createdAt: "desc" },
      take: 100
    });
    return { data: reports.map(toReportResponse) };
  }

  async get(user: { sub: string; companyId: string }, reportId: string) {
    const report = await this.prisma.generatedReport.findUnique({
      where: { id: reportId },
      include: { project: true, createdBy: { select: { id: true, name: true, email: true, role: true } } }
    });
    if (!report) throw new NotFoundException("Report not found.");
    await this.projects.assertProjectAccess(user.sub, user.companyId, report.projectId);
    return { data: toReportResponse(report) };
  }

  async generate(user: { sub: string; companyId: string; role: string; email?: string }, dto: GenerateReportDto) {
    await this.projects.assertProjectRole(user, dto.project_id, ["PROJECT_ADMIN", "BIM_MANAGER", "COMPANY_ADMIN"]);

    const photos = await this.findPhotos(dto);
    const creator = await this.prisma.user.findUnique({ where: { id: user.sub }, select: { name: true } });
    const generatedBy = creator?.name ?? user.email ?? "관리자";
    const title = dto.title?.trim() || buildTitle(dto, photos);
    const gemini = await this.tryGenerateWithGemini(title, generatedBy, dto, photos);
    const content = gemini.content ?? buildHeuristicReport(title, generatedBy, dto, photos);

    const report = await this.prisma.generatedReport.create({
      data: {
        projectId: dto.project_id,
        createdById: user.sub,
        title,
        format: dto.format ?? "JSON",
        filters: reportFilters(dto) as Prisma.InputJsonValue,
        content: content as Prisma.InputJsonValue,
        summary: content.analysis_result,
        photoIds: photos.map((photo) => photo.id),
        modelProvider: gemini.provider,
        modelName: gemini.modelName,
        errorMessage: gemini.errorMessage
      },
      include: { project: true, createdBy: { select: { id: true, name: true, email: true, role: true } } }
    });

    return { data: toReportResponse(report) };
  }

  private async findPhotos(dto: GenerateReportDto) {
    const where: Prisma.PhotoWhereInput = {
      projectId: dto.project_id,
      status: "ACTIVE",
      ...(dto.room_id ? { roomId: dto.room_id } : {}),
      ...(dto.work_surface ? { workSurface: dto.work_surface } : {}),
      ...(dto.trade ? { trade: dto.trade } : {}),
      ...(dto.worker_name ? { workerName: { contains: dto.worker_name, mode: "insensitive" } } : {}),
      ...(dto.date_from || dto.date_to
        ? {
            workDate: {
              ...(dto.date_from ? { gte: new Date(dto.date_from) } : {}),
              ...(dto.date_to ? { lte: new Date(dto.date_to) } : {})
            }
          }
        : {})
    };

    return this.prisma.photo.findMany({
      where,
      include: { room: true, analyses: { orderBy: { createdAt: "desc" }, take: 1 } },
      orderBy: [{ workDate: "asc" }, { takenAt: "asc" }, { uploadedAt: "asc" }],
      take: 80
    });
  }

  private async tryGenerateWithGemini(title: string, generatedBy: string, dto: GenerateReportDto, photos: PhotoForReport[]) {
    const apiKey = this.config.get<string>("GEMINI_API_KEY");
    const modelName = this.config.get<string>("GEMINI_REPORT_MODEL", "gemini-3.1-flash-lite-preview");
    if (!apiKey) return { provider: "HEURISTIC", modelName: "bim-photo-sync-report-v1", content: null, errorMessage: null };

    try {
      const parts: Array<Record<string, unknown>> = [
        {
          text: [
            "너는 BIM 현장 사진 분석 보고서 작성자다.",
            "아래 사진과 메타데이터를 근거로 한국어 JSON 보고서를 작성한다.",
            "반드시 JSON만 반환한다. Markdown 금지.",
            "JSON 필드: title, generated_at, generated_by, filters, situation, comparison_photos, progress_timeline, analysis_result, memo.",
            `제목: ${title}`,
            `생성자: ${generatedBy}`,
            `필터: ${JSON.stringify(reportFilters(dto))}`,
            `사진 메타데이터: ${JSON.stringify(photos.map(photoSummary))}`
          ].join("\n")
        }
      ];

      for (const photo of photos.slice(0, 8)) {
        const image = await this.getPhotoInlineData(photo).catch(() => null);
        if (image) parts.push({ inline_data: image });
      }

      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts }] })
      });

      if (!res.ok) throw new Error(`Gemini report generation failed: ${res.status} ${await res.text()}`);
      const json = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      const text = json.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
      const parsed = parseReportJson(text);
      return { provider: "GEMINI", modelName, content: normalizeReportContent(parsed, title, generatedBy, dto, photos), errorMessage: null };
    } catch (error) {
      return {
        provider: "HEURISTIC",
        modelName: "bim-photo-sync-report-v1",
        content: null,
        errorMessage: error instanceof Error ? error.message : "Gemini report generation failed."
      };
    }
  }

  private async getPhotoInlineData(photo: PhotoForReport) {
    const object = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: photo.objectKey }));
    const chunks: Buffer[] = [];
    for await (const chunk of object.Body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
    return {
      mime_type: object.ContentType ?? photo.mimeType,
      data: Buffer.concat(chunks).toString("base64")
    };
  }
}

function buildTitle(dto: GenerateReportDto, photos: PhotoForReport[]) {
  const firstRoom = photos[0]?.room;
  const parts = [
    firstRoom ? `${firstRoom.roomNumber ?? ""}${firstRoom.roomName}`.trim() : "현장전체",
    dto.work_surface ?? null,
    dto.trade ?? null,
    dto.date_from || dto.date_to ? `${dto.date_from ?? "시작"}~${dto.date_to ?? "현재"}` : null,
    dto.worker_name ?? null
  ].filter(Boolean);
  const generatedDate = new Date().toISOString().slice(0, 10);
  return `${parts.join("_") || "현장"}_분석보고서(${generatedDate})`;
}

function buildHeuristicReport(title: string, generatedBy: string, dto: GenerateReportDto, photos: PhotoForReport[]): ReportContent {
  const sorted = [...photos].sort((a, b) => a.workDate.getTime() - b.workDate.getTime() || a.uploadedAt.getTime() - b.uploadedAt.getTime());
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const groups = new Map<string, number>();
  for (const photo of sorted) {
    const key = `${photo.room.roomNumber ?? ""} ${photo.room.roomName} / ${photo.workSurface} / ${photo.trade}`;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  const timeline = sorted.map((photo) => {
    const room = `${photo.room.roomNumber ?? ""} ${photo.room.roomName}`.trim();
    return `${photo.workDate.toISOString().slice(0, 10)} ${room} ${photo.workSurface}/${photo.trade}: ${photo.aiDescription ?? photo.description ?? "분석 대기"}`;
  });
  const analysis =
    sorted.length === 0
      ? "선택한 조건에 해당하는 사진이 없어 공정 변화 분석을 생성할 수 없습니다."
      : [
          `${sorted.length}장의 사진을 기준으로 현장 상황을 분석했습니다.`,
          first && last && first.id !== last.id
            ? `초기 사진(${first.workDate.toISOString().slice(0, 10)})부터 최근 사진(${last.workDate.toISOString().slice(0, 10)})까지의 변화 흐름을 시간순으로 정리했습니다.`
            : "단일 시점 사진 기준으로 현재 상태를 정리했습니다.",
          `주요 분류는 ${Array.from(groups.entries()).map(([key, count]) => `${key} ${count}건`).join(", ")}입니다.`
        ].join(" ");

  return {
    title,
    generated_at: new Date().toISOString(),
    generated_by: generatedBy,
    filters: reportFilters(dto),
    situation: {
      project_id: dto.project_id,
      room: first ? `${first.room.roomNumber ?? ""} ${first.room.roomName}`.trim() : null,
      work_surface: dto.work_surface ?? null,
      trade: dto.trade ?? null,
      date_range: dto.date_from || dto.date_to ? `${dto.date_from ?? "시작"} ~ ${dto.date_to ?? "현재"}` : null,
      worker_name: dto.worker_name ?? null
    },
    comparison_photos: sorted.map(photoSummary),
    progress_timeline: timeline,
    analysis_result: analysis,
    memo: dto.memo ?? null
  };
}

function reportFilters(dto: GenerateReportDto) {
  return {
    project_id: dto.project_id,
    room_id: dto.room_id ?? null,
    work_surface: dto.work_surface ?? null,
    trade: dto.trade ?? null,
    date_from: dto.date_from ?? null,
    date_to: dto.date_to ?? null,
    worker_name: dto.worker_name ?? null
  };
}

function photoSummary(photo: PhotoForReport) {
  return {
    photo_id: photo.id,
    work_date: photo.workDate.toISOString().slice(0, 10),
    room: `${photo.room.roomNumber ?? ""} ${photo.room.roomName}`.trim(),
    work_surface: photo.workSurface,
    trade: photo.trade,
    worker_name: photo.workerName,
    description: photo.description,
    ai_description: photo.aiDescription ?? photo.analyses[0]?.summary ?? null
  };
}

function parseReportJson(text: string) {
  const cleaned = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  return JSON.parse(cleaned) as Partial<ReportContent>;
}

function normalizeReportContent(
  value: Partial<ReportContent>,
  title: string,
  generatedBy: string,
  dto: GenerateReportDto,
  photos: PhotoForReport[]
): ReportContent {
  const fallback = buildHeuristicReport(title, generatedBy, dto, photos);
  return {
    ...fallback,
    ...value,
    title: value.title || fallback.title,
    generated_at: value.generated_at || fallback.generated_at,
    generated_by: value.generated_by || fallback.generated_by,
    filters: value.filters || fallback.filters,
    situation: value.situation || fallback.situation,
    comparison_photos: value.comparison_photos?.length ? value.comparison_photos : fallback.comparison_photos,
    progress_timeline: value.progress_timeline?.length ? value.progress_timeline : fallback.progress_timeline,
    analysis_result: value.analysis_result || fallback.analysis_result,
    memo: value.memo ?? fallback.memo
  };
}

function toReportResponse(report: Prisma.GeneratedReportGetPayload<{
  include: { project: true; createdBy: { select: { id: true; name: true; email: true; role: true } } };
}>) {
  return {
    id: report.id,
    project_id: report.projectId,
    project: report.project,
    title: report.title,
    format: report.format,
    status: report.status,
    filters: report.filters,
    content: report.content,
    summary: report.summary,
    photo_ids: report.photoIds,
    model_provider: report.modelProvider,
    model_name: report.modelName,
    error_message: report.errorMessage,
    created_by: report.createdBy,
    created_at: report.createdAt,
    updated_at: report.updatedAt
  };
}
