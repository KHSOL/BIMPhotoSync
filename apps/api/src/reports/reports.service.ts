import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { ProjectsService } from "../projects/projects.service";
import { GenerateReportDto, ReportChatDto, ReportQueryDto } from "./dto";

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

type ExportFile = {
  filename: string;
  contentType: string;
  buffer: Buffer;
};

type GeminiResult = {
  provider: "GEMINI" | "HEURISTIC";
  modelName: string;
  content: ReportContent | null;
  errorMessage: string | null;
};

type ZipEntry = {
  path: string;
  content: Buffer;
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

  async export(user: { sub: string; companyId: string }, reportId: string, format = "JSON"): Promise<ExportFile> {
    const report = await this.prisma.generatedReport.findUnique({
      where: { id: reportId },
      include: { project: true, createdBy: { select: { id: true, name: true, email: true, role: true } } }
    });
    if (!report) throw new NotFoundException("Report not found.");
    await this.projects.assertProjectAccess(user.sub, user.companyId, report.projectId);

    const response = toReportResponse(report);
    const content = normalizeStoredContent(response.content, response.title, response.created_by.name);
    const safeTitle = safeFilename(response.title);
    const normalizedFormat = format.toUpperCase();

    if (normalizedFormat === "XLSX") {
      return {
        filename: `${safeTitle}.xlsx`,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: renderXlsx(content)
      };
    }
    if (normalizedFormat === "DOCX") {
      return {
        filename: `${safeTitle}.docx`,
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        buffer: renderDocx(content)
      };
    }
    if (normalizedFormat === "PDF") {
      return {
        filename: `${safeTitle}.pdf`,
        contentType: "application/pdf",
        buffer: renderPdf(content)
      };
    }
    if (normalizedFormat === "HWP") {
      return {
        filename: `${safeTitle}.hwpx`,
        contentType: "application/vnd.hancom.hwpx",
        buffer: renderHwpx(content)
      };
    }
    return {
      filename: `${safeTitle}.json`,
      contentType: "application/json; charset=utf-8",
      buffer: Buffer.from(JSON.stringify(content, null, 2), "utf8")
    };
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

    await this.projects.recordAuditEvent({
      companyId: user.companyId,
      projectId: dto.project_id,
      actorUserId: user.sub,
      action: "CREATE",
      resourceType: "REPORT",
      resourceId: report.id,
      detail: `${title} 보고서 생성`
    });

    return { data: toReportResponse(report) };
  }

  async chat(user: { sub: string; companyId: string; role: string; email?: string }, dto: ReportChatDto) {
    await this.projects.assertProjectRole(user, dto.project_id, ["PROJECT_ADMIN", "BIM_MANAGER", "COMPANY_ADMIN"]);
    const photos = await this.findPhotos(dto);
    const prompt = dto.message.trim();
    const apiKey = this.config.get<string>("GEMINI_API_KEY");
    const modelName = this.config.get<string>("GEMINI_REPORT_MODEL", "gemini-3.1-flash-lite");

    if (!apiKey) {
      return {
        data: {
          provider: "HEURISTIC",
          model_name: "bim-photo-sync-report-chat-v1",
          answer: buildHeuristicChatAnswer(prompt, dto, photos),
          suggested_prompt: prompt
        }
      };
    }

    try {
      const text = [
        "너는 BIM 현장 사진 보고서 작성 보조 AI다.",
        "관리자의 요청을 보고서 생성 지시문으로 정리하고, 적용할 분류 기준과 주의할 비교 포인트를 한국어로 답한다.",
        "방(실) → 공사면 → 일자 → 공종 → 작성자 순서로 분석 관점을 유지한다.",
        `관리자 요청: ${prompt}`,
        `현재 필터: ${JSON.stringify(reportFilters(dto))}`,
        `사진 메타데이터: ${JSON.stringify(photos.slice(0, 30).map(photoSummary))}`
      ].join("\n");
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text }] }] })
      });
      if (!res.ok) throw new Error(`Gemini report chat failed: ${res.status}`);
      const json = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      const answer = json.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
      return {
        data: {
          provider: "GEMINI",
          model_name: modelName,
          answer: answer || buildHeuristicChatAnswer(prompt, dto, photos),
          suggested_prompt: prompt
        }
      };
    } catch (error) {
      return {
        data: {
          provider: "HEURISTIC",
          model_name: "bim-photo-sync-report-chat-v1",
          answer: buildHeuristicChatAnswer(prompt, dto, photos),
          suggested_prompt: prompt,
          error_message: error instanceof Error ? error.message : "Gemini report chat failed."
        }
      };
    }
  }

  private async findPhotos(dto: GenerateReportDto | ReportChatDto) {
    const where: Prisma.PhotoWhereInput = {
      projectId: dto.project_id,
      status: "ACTIVE",
      ...(dto.room_id ? { roomId: dto.room_id } : {}),
      ...(dto.work_surface ? { workSurface: dto.work_surface } : {}),
      ...(dto.trade ? { trade: dto.trade } : {}),
      ...(dto.trade_category_id ? { tradeCategoryId: dto.trade_category_id } : {}),
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
      take: 120
    });
  }

  private async tryGenerateWithGemini(title: string, generatedBy: string, dto: GenerateReportDto, photos: PhotoForReport[]): Promise<GeminiResult> {
    const apiKey = this.config.get<string>("GEMINI_API_KEY");
    const modelName = this.config.get<string>("GEMINI_REPORT_MODEL", "gemini-3.1-flash-lite");
    if (!apiKey) return { provider: "HEURISTIC", modelName: "bim-photo-sync-report-v1", content: null, errorMessage: null };

    try {
      const parts: Array<Record<string, unknown>> = [
        {
          text: [
            "너는 BIM 현장 사진 분석 보고서 작성자다.",
            "아래 사진과 메타데이터를 근거로 한국어 JSON 보고서를 작성한다.",
            "반드시 JSON만 반환한다. Markdown은 금지한다.",
            "JSON 필드: title, generated_at, generated_by, filters, situation, comparison_photos, progress_timeline, analysis_result, memo.",
            "분류와 분석 순서는 프로젝트 → 방(실) → 공사면 → 작업일자 → 공종 → 작성자(작업자) 순서를 따른다.",
            "비교 사진은 같은 방/공사면 안에서 날짜순 변화가 드러나도록 설명한다.",
            `제목: ${title}`,
            `생성자: ${generatedBy}`,
            `필터: ${JSON.stringify(reportFilters(dto))}`,
            dto.ai_prompt ? `관리자 추가 지시: ${dto.ai_prompt}` : "",
            `사진 메타데이터: ${JSON.stringify(photos.map(photoSummary))}`
          ].filter(Boolean).join("\n")
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
  ].filter((part): part is string => typeof part === "string" && part.length > 0);
  const generatedDate = new Date().toISOString().slice(0, 10);
  return `${parts.join("_") || "현장"}_분석보고서(${generatedDate})`;
}

function buildHeuristicReport(title: string, generatedBy: string, dto: GenerateReportDto, photos: PhotoForReport[]): ReportContent {
  const sorted = sortPhotosForReport(photos);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const groups = new Map<string, number>();
  for (const photo of sorted) {
    const key = `${roomLabel(photo)} / ${photo.workSurface} / ${photo.workDate.toISOString().slice(0, 10)} / ${photo.trade} / ${photo.workerName ?? "-"}`;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  const timeline = sorted.map((photo) => {
    return `${photo.workDate.toISOString().slice(0, 10)} ${roomLabel(photo)} ${photo.workSurface}/${photo.trade}: ${photo.aiDescription ?? photo.description ?? "분석 대기"}`;
  });
  const analysis =
    sorted.length === 0
      ? "선택한 조건에 해당하는 사진이 없어 공정 변화 분석을 생성할 수 없습니다."
      : [
          `${sorted.length}장의 사진을 기준으로 현장 상황을 분석했습니다.`,
          first && last && first.id !== last.id
            ? `초기 사진(${first.workDate.toISOString().slice(0, 10)})부터 최근 사진(${last.workDate.toISOString().slice(0, 10)})까지의 변화 흐름을 시간순으로 정리했습니다.`
            : "단일 시점 사진 기준으로 현재 상태를 정리했습니다.",
          "분류 기준은 프로젝트 → 방(실) → 공사면 → 작업일자 → 공종 → 작성자(작업자) 순서입니다.",
          `주요 분류는 ${Array.from(groups.entries()).map(([key, count]) => `${key} ${count}건`).join(", ")}입니다.`,
          dto.ai_prompt ? `관리자 지시사항(${dto.ai_prompt})을 보고서 관점에 반영했습니다.` : ""
        ].filter(Boolean).join(" ");

  return {
    title,
    generated_at: new Date().toISOString(),
    generated_by: generatedBy,
    filters: reportFilters(dto),
    situation: {
      project_id: dto.project_id,
      room: first ? roomLabel(first) : null,
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

function buildHeuristicChatAnswer(message: string, dto: ReportChatDto, photos: PhotoForReport[]) {
  const dateText = dto.date_from || dto.date_to ? `${dto.date_from ?? "시작"}부터 ${dto.date_to ?? "현재"}까지` : "전체 기간";
  const scope = [
    dto.room_id ? "선택한 실" : "현장 전체",
    dto.work_surface ? `${dto.work_surface} 공사면` : null,
    dto.trade ? `${dto.trade} 공종` : null,
    dto.worker_name ? `${dto.worker_name} 작업자` : null
  ].filter((item): item is string => !!item).join(" / ");
  return [
    `요청을 보고서 지시문으로 정리했습니다: ${message}`,
    `적용 범위는 ${scope || "현장 전체"}이며, 기간은 ${dateText}입니다.`,
    `${photos.length}장의 사진 메타데이터를 기준으로 방(실) → 공사면 → 일자 → 공종 → 작성자 순서로 비교하면 됩니다.`,
    "보고서 생성 시 전후 사진 근거, 완료/미완료 근거, 지연 또는 누락 가능성이 있는 공사면을 명시하도록 지시문에 반영하세요."
  ].join("\n");
}

function sortPhotosForReport(photos: PhotoForReport[]) {
  return [...photos].sort((a, b) => {
    return (
      roomLabel(a).localeCompare(roomLabel(b), "ko-KR") ||
      a.workSurface.localeCompare(b.workSurface) ||
      a.workDate.getTime() - b.workDate.getTime() ||
      a.trade.localeCompare(b.trade) ||
      (a.workerName ?? "").localeCompare(b.workerName ?? "", "ko-KR") ||
      a.uploadedAt.getTime() - b.uploadedAt.getTime()
    );
  });
}

function reportFilters(dto: GenerateReportDto | ReportChatDto) {
  return {
    project_id: dto.project_id,
    room_id: dto.room_id ?? null,
    work_surface: dto.work_surface ?? null,
    trade: dto.trade ?? null,
    trade_category_id: dto.trade_category_id ?? null,
    date_from: dto.date_from ?? null,
    date_to: dto.date_to ?? null,
    worker_name: dto.worker_name ?? null,
    ai_prompt: "ai_prompt" in dto ? dto.ai_prompt ?? null : null
  };
}

function photoSummary(photo: PhotoForReport) {
  return {
    photo_id: photo.id,
    work_date: photo.workDate.toISOString().slice(0, 10),
    room: roomLabel(photo),
    work_surface: photo.workSurface,
    trade: photo.trade,
    worker_name: photo.workerName,
    description: photo.description,
    ai_description: photo.aiDescription ?? photo.analyses[0]?.summary ?? null
  };
}

function roomLabel(photo: PhotoForReport) {
  return `${photo.room.roomNumber ?? ""} ${photo.room.roomName}`.trim();
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
  const comparisonPhotos = Array.isArray(value.comparison_photos)
    ? value.comparison_photos.map((photo, index) => normalizeComparisonPhoto(photo, fallback.comparison_photos[index])).filter((photo): photo is ReportContent["comparison_photos"][number] => Boolean(photo))
    : [];
  const timeline = Array.isArray(value.progress_timeline)
    ? value.progress_timeline.map((line) => stringifyReportValue(line)).filter((line) => line.length > 0)
    : [];
  return {
    ...fallback,
    title: stringifyReportValue(value.title) || fallback.title,
    generated_at: stringifyReportValue(value.generated_at) || fallback.generated_at,
    generated_by: stringifyReportValue(value.generated_by) || fallback.generated_by,
    filters: isRecord(value.filters) ? normalizeStringRecord(value.filters) : fallback.filters,
    situation: isRecord(value.situation) ? { ...fallback.situation, ...normalizeStringRecord(value.situation) } : fallback.situation,
    comparison_photos: comparisonPhotos.length ? comparisonPhotos : fallback.comparison_photos,
    progress_timeline: timeline.length ? timeline : fallback.progress_timeline,
    analysis_result: stringifyReportValue(value.analysis_result) || fallback.analysis_result,
    memo: value.memo === null ? null : stringifyReportValue(value.memo) || fallback.memo
  };
}

function normalizeStoredContent(value: unknown, title: string, generatedBy: string): ReportContent {
  if (!isRecord(value)) return emptyReportContent(title, generatedBy);
  return {
    title: stringifyReportValue(value.title) || title,
    generated_at: stringifyReportValue(value.generated_at) || new Date().toISOString(),
    generated_by: stringifyReportValue(value.generated_by) || generatedBy,
    filters: isRecord(value.filters) ? normalizeStringRecord(value.filters) : {},
    situation: {
      project_id: stringifyReportValue(isRecord(value.situation) ? value.situation.project_id : "") || "",
      room: stringifyNullableReportValue(isRecord(value.situation) ? value.situation.room : null),
      work_surface: stringifyNullableReportValue(isRecord(value.situation) ? value.situation.work_surface : null),
      trade: stringifyNullableReportValue(isRecord(value.situation) ? value.situation.trade : null),
      date_range: stringifyNullableReportValue(isRecord(value.situation) ? value.situation.date_range : null),
      worker_name: stringifyNullableReportValue(isRecord(value.situation) ? value.situation.worker_name : null)
    },
    comparison_photos: Array.isArray(value.comparison_photos)
      ? value.comparison_photos.map((photo) => normalizeComparisonPhoto(photo, undefined)).filter((photo): photo is ReportContent["comparison_photos"][number] => Boolean(photo))
      : [],
    progress_timeline: Array.isArray(value.progress_timeline) ? value.progress_timeline.map(stringifyReportValue).filter(Boolean) : [],
    analysis_result: stringifyReportValue(value.analysis_result),
    memo: stringifyNullableReportValue(value.memo)
  };
}

function emptyReportContent(title: string, generatedBy: string): ReportContent {
  return {
    title,
    generated_at: new Date().toISOString(),
    generated_by: generatedBy,
    filters: {},
    situation: { project_id: "", room: null, work_surface: null, trade: null, date_range: null, worker_name: null },
    comparison_photos: [],
    progress_timeline: [],
    analysis_result: "",
    memo: null
  };
}

function normalizeComparisonPhoto(
  value: unknown,
  fallback: ReportContent["comparison_photos"][number] | undefined
): ReportContent["comparison_photos"][number] | null {
  if (!isRecord(value)) return fallback ?? null;
  return {
    photo_id: stringifyReportValue(value.photo_id) || fallback?.photo_id || "",
    work_date: stringifyReportValue(value.work_date ?? value.date) || fallback?.work_date || "",
    room: stringifyReportValue(value.room) || fallback?.room || "",
    work_surface: stringifyReportValue(value.work_surface) || fallback?.work_surface || "",
    trade: stringifyReportValue(value.trade) || fallback?.trade || "",
    worker_name: stringifyNullableReportValue(value.worker_name ?? value.worker),
    description: stringifyNullableReportValue(value.description),
    ai_description: stringifyNullableReportValue(value.ai_description ?? value.summary)
  };
}

function stringifyNullableReportValue(value: unknown) {
  const text = stringifyReportValue(value);
  return text.length > 0 ? text : null;
}

function stringifyReportValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((item) => stringifyReportValue(item)).filter(Boolean).join(" ");
  if (isRecord(value)) {
    return Object.entries(value)
      .map(([key, item]) => `${key}: ${stringifyReportValue(item)}`)
      .filter((line) => !line.endsWith(": "))
      .join(" / ");
  }
  return "";
}

function normalizeStringRecord(value: Record<string, unknown>): Record<string, string | null> {
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, stringifyNullableReportValue(item)]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function renderDocx(content: ReportContent) {
  const body = [
    paragraph(content.title, "Title"),
    paragraph(`생성일: ${content.generated_at}`),
    paragraph(`생성자: ${content.generated_by}`),
    paragraph("상황분석", "Heading1"),
    paragraph(content.analysis_result),
    paragraph("변화 과정", "Heading1"),
    ...content.progress_timeline.map((line) => paragraph(line)),
    paragraph("비교 사진 근거", "Heading1"),
    tableXml([
      ["작업일자", "Room", "공사면", "공종", "작업자", "내용", "AI 요약"],
      ...content.comparison_photos.map((photo) => [
        photo.work_date,
        photo.room,
        photo.work_surface,
        photo.trade,
        photo.worker_name ?? "",
        photo.description ?? "",
        photo.ai_description ?? ""
      ])
    ]),
    content.memo ? paragraph(`메모: ${content.memo}`) : ""
  ].join("");
  return zipStore([
    { path: "[Content_Types].xml", content: textBuffer(contentTypesDocx()) },
    { path: "_rels/.rels", content: textBuffer(rootRels("officeDocument", "word/document.xml")) },
    { path: "word/document.xml", content: textBuffer(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="850" w:bottom="1134" w:left="850"/></w:sectPr></w:body></w:document>`) },
    { path: "word/styles.xml", content: textBuffer(wordStyles()) }
  ]);
}

function renderXlsx(content: ReportContent) {
  const rows = [
    ["제목", content.title],
    ["생성일", content.generated_at],
    ["생성자", content.generated_by],
    ["상황분석", content.analysis_result],
    ["메모", content.memo ?? ""],
    [],
    ["작업일자", "Room", "공사면", "공종", "작업자", "내용", "AI 요약"],
    ...content.comparison_photos.map((photo) => [
      photo.work_date,
      photo.room,
      photo.work_surface,
      photo.trade,
      photo.worker_name ?? "",
      photo.description ?? "",
      photo.ai_description ?? ""
    ])
  ];
  return zipStore([
    { path: "[Content_Types].xml", content: textBuffer(contentTypesXlsx()) },
    { path: "_rels/.rels", content: textBuffer(rootRels("officeDocument", "xl/workbook.xml")) },
    { path: "xl/workbook.xml", content: textBuffer(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="보고서" sheetId="1" r:id="rId1"/></sheets></workbook>`) },
    { path: "xl/_rels/workbook.xml.rels", content: textBuffer(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`) },
    { path: "xl/worksheets/sheet1.xml", content: textBuffer(worksheetXml(rows)) }
  ]);
}

function renderHwpx(content: ReportContent) {
  const text = [
    content.title,
    `생성일: ${content.generated_at}`,
    `생성자: ${content.generated_by}`,
    "",
    "상황분석",
    content.analysis_result,
    "",
    "변화 과정",
    ...content.progress_timeline,
    "",
    "비교 사진 근거",
    ...content.comparison_photos.map((photo) => `${photo.work_date} / ${photo.room} / ${photo.work_surface} / ${photo.trade} / ${photo.worker_name ?? ""} / ${photo.description ?? photo.ai_description ?? ""}`),
    content.memo ? `메모: ${content.memo}` : ""
  ].join("\n");
  return zipStore([
    { path: "mimetype", content: textBuffer("application/hwp+zip") },
    { path: "version.xml", content: textBuffer(`<?xml version="1.0" encoding="UTF-8"?><version app="BIM Photo Sync" version="1.0"/>`) },
    { path: "META-INF/container.xml", content: textBuffer(`<?xml version="1.0" encoding="UTF-8"?><container><rootfiles><rootfile full-path="Contents/section0.xml" media-type="application/xml"/></rootfiles></container>`) },
    { path: "Contents/header.xml", content: textBuffer(`<?xml version="1.0" encoding="UTF-8"?><head><title>${xmlEscape(content.title)}</title></head>`) },
    { path: "Contents/section0.xml", content: textBuffer(`<?xml version="1.0" encoding="UTF-8"?><section>${text.split("\n").map((line) => `<p>${xmlEscape(line)}</p>`).join("")}</section>`) },
    { path: "Preview/PrvText.txt", content: textBuffer(text) }
  ]);
}

function renderPdf(content: ReportContent) {
  const lines = [
    content.title,
    `생성일: ${content.generated_at}`,
    `생성자: ${content.generated_by}`,
    "",
    "상황분석",
    content.analysis_result,
    "",
    "변화 과정",
    ...content.progress_timeline.slice(0, 18),
    "",
    "비교 사진 근거",
    ...content.comparison_photos.slice(0, 18).map((photo) => `${photo.work_date} ${photo.room} ${photo.work_surface}/${photo.trade} ${photo.description ?? photo.ai_description ?? ""}`),
    content.memo ? `메모: ${content.memo}` : ""
  ].flatMap((line) => wrapText(line, 54)).slice(0, 58);
  const stream = [
    "BT",
    "/F1 10 Tf",
    "50 790 Td",
    "14 TL",
    ...lines.map((line, index) => `${index === 0 ? "" : "T*"} ${pdfHexText(line)} Tj`),
    "ET"
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream, "binary")} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type0 /BaseFont /HYSMyeongJoStd-Medium /Encoding /UniKS-UCS2-H /DescendantFonts [6 0 R] >>",
    "<< /Type /Font /Subtype /CIDFontType0 /BaseFont /HYSMyeongJoStd-Medium /CIDSystemInfo << /Registry (Adobe) /Ordering (Korea1) /Supplement 2 >> >>"
  ];
  return buildPdf(objects);
}

function worksheetXml(rows: string[][]) {
  const body = rows.map((row, rowIndex) => {
    const cells = row.map((cell, colIndex) => {
      const ref = `${columnName(colIndex + 1)}${rowIndex + 1}`;
      return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(cell)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

function columnName(index: number) {
  let value = "";
  let current = index;
  while (current > 0) {
    const mod = (current - 1) % 26;
    value = String.fromCharCode(65 + mod) + value;
    current = Math.floor((current - mod) / 26);
  }
  return value;
}

function paragraph(text: string, style?: "Title" | "Heading1") {
  const styleXml = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
  return `<w:p>${styleXml}<w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
}

function tableXml(rows: string[][]) {
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>${rows.map((row) => `<w:tr>${row.map((cell) => `<w:tc><w:p><w:r><w:t xml:space="preserve">${xmlEscape(cell)}</w:t></w:r></w:p></w:tc>`).join("")}</w:tr>`).join("")}</w:tbl>`;
}

function contentTypesDocx() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;
}

function contentTypesXlsx() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;
}

function rootRels(kind: string, target: string) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${kind}" Target="${target}"/></Relationships>`;
}

function wordStyles() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style></w:styles>`;
}

function zipStore(entries: ZipEntry[]) {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = textBuffer(entry.path);
    const crc = crc32(entry.content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.content.length, 18);
    local.writeUInt32LE(entry.content.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, entry.content);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(entry.content.length, 20);
    central.writeUInt32LE(entry.content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + entry.content.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

function crc32(buffer: Buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildPdf(objects: string[]) {
  const parts: Buffer[] = [textBuffer("%PDF-1.7\n")];
  const offsets: number[] = [];
  let offset = parts[0].length;
  objects.forEach((object, index) => {
    offsets.push(offset);
    const part = textBuffer(`${index + 1} 0 obj\n${object}\nendobj\n`);
    parts.push(part);
    offset += part.length;
  });
  const xrefOffset = offset;
  const xref = [
    `xref\n0 ${objects.length + 1}`,
    "0000000000 65535 f ",
    ...offsets.map((item) => `${String(item).padStart(10, "0")} 00000 n `),
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>`,
    `startxref\n${xrefOffset}\n%%EOF`
  ].join("\n");
  parts.push(textBuffer(xref));
  return Buffer.concat(parts);
}

function pdfHexText(text: string) {
  return `<${Buffer.from(`\ufeff${text}`, "utf16le").swap16().toString("hex")}>`;
}

function wrapText(text: string, maxLength: number) {
  if (text.length <= maxLength) return [text];
  const lines: string[] = [];
  let current = text;
  while (current.length > maxLength) {
    lines.push(current.slice(0, maxLength));
    current = current.slice(maxLength);
  }
  if (current) lines.push(current);
  return lines;
}

function textBuffer(value: string) {
  return Buffer.from(value, "utf8");
}

function xmlEscape(value: unknown) {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function safeFilename(value: string) {
  return value.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 120) || "report";
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
