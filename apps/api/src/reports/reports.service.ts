import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { PrismaService } from "../prisma/prisma.service";
import { ProjectsService } from "../projects/projects.service";
import { GenerateReportDto, ReportChatDto, ReportQueryDto } from "./dto";

type PhotoForReport = Prisma.PhotoGetPayload<{
  include: { room: true; tradeCategory: true; analyses: { orderBy: { createdAt: "desc" }; take: 1 } };
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
  work_log?: ReportWorkLogEntry[];
  judgment?: ReportJudgment;
  progress_timeline: string[];
  analysis_result: string;
  memo: string | null;
};

type ReportWorkLogEntry = {
  photo_id: string;
  date: string;
  work_item: string;
  work_detail: string;
  note: string;
};

type ReportJudgment = {
  quality_status: string;
  special_notes: string;
  overall_opinion: string;
};

type ExportFile = {
  filename: string;
  contentType: string;
  buffer: Buffer;
};

type ReportModelResult = {
  provider: ReportModelProvider;
  modelName: string;
  content: ReportContent | null;
  errorMessage: string | null;
};

type ReportModelProvider = "GEMINI" | "OPENAI" | "ANTHROPIC" | "HEURISTIC";

const reportManagerRoles = ["MANAGER", "PROJECT_ADMIN", "BIM_MANAGER", "COMPANY_ADMIN", "SUPER_ADMIN"];

type ZipEntry = {
  path: string;
  content: Buffer;
};

type SheetDefinition = {
  name: string;
  rows: string[][];
  merges: string[];
  columnWidths: number[];
};

type TemplateCellPatch = {
  sheetPath: string;
  cells: Record<string, string>;
  rowHeights?: Record<number, number>;
  styleOverrides?: Record<string, number>;
};

type ReportImage = {
  photoId: string;
  buffer: Buffer;
  extension: "jpg" | "png";
  mediaPath: string;
};

type ReportImageAnchor = {
  sheetPath: string;
  image: ReportImage;
  fromCol: number;
  fromRow: number;
  toCol: number;
  toRow: number;
};

type ReportImageSheet = {
  sheetPath: string;
  drawingPath: string;
  relPath: string;
  sheetRelPath: string;
  anchors: ReportImageAnchor[];
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

  async export(user: { sub: string; companyId: string }, reportId: string, format = "DOCX"): Promise<ExportFile> {
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

    if (normalizedFormat === "DOCX") {
      const images = await this.getReportImages(content);
      return {
        filename: `${safeTitle}.docx`,
        contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        buffer: renderDocx(content, images)
      };
    }
    const images = await this.getReportImages(content);
    return {
      filename: `${safeTitle}.docx`,
      contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: renderDocx(content, images)
    };
  }

  async generate(user: { sub: string; companyId: string; role: string; email?: string }, dto: GenerateReportDto) {
    await this.projects.assertProjectRole(user, dto.project_id, reportManagerRoles);

    const photos = await this.findPhotos(dto);
    const creator = await this.prisma.user.findUnique({ where: { id: user.sub }, select: { name: true } });
    const generatedBy = creator?.name ?? user.email ?? "관리자";
    const title = dto.title?.trim() || buildTitle(dto, photos);
    const generated = await this.tryGenerateWithConfiguredModel(title, generatedBy, dto, photos);
    const content = generated.content ?? buildHeuristicReport(title, generatedBy, dto, photos);

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
        modelProvider: generated.provider,
        modelName: generated.modelName,
        errorMessage: generated.errorMessage
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
    await this.projects.assertProjectRole(user, dto.project_id, reportManagerRoles);
    const photos = await this.findPhotos(dto);
    const prompt = dto.message.trim();
    const apiKey = this.config.get<string>("GEMINI_API_KEY");
    const modelName = this.config.get<string>("GEMINI_REPORT_MODEL", "gemini-3.5-flash");

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

  async delete(user: { sub: string; companyId: string; role: string }, reportId: string) {
    const report = await this.prisma.generatedReport.findUnique({
      where: { id: reportId },
      include: { project: true, createdBy: { select: { id: true, name: true, email: true, role: true } } }
    });
    if (!report) throw new NotFoundException("Report not found.");
    const project = await this.projects.assertProjectRole(user, report.projectId, reportManagerRoles);

    await this.prisma.generatedReport.delete({ where: { id: reportId } });
    await this.projects.recordAuditEvent({
      companyId: project.companyId,
      projectId: report.projectId,
      actorUserId: user.sub,
      action: "DELETE",
      resourceType: "REPORT",
      resourceId: report.id,
      detail: `${report.title} 보고서 삭제`
    });

    return { data: toReportResponse({ ...report, project }) };
  }

  private async findPhotos(dto: GenerateReportDto | ReportChatDto) {
    const inferredRange = inferDateRange(dto);
    const where: Prisma.PhotoWhereInput = {
      projectId: dto.project_id,
      status: "ACTIVE",
      ...(dto.room_id ? { roomId: dto.room_id } : {}),
      ...(dto.work_surface ? { workSurface: dto.work_surface } : {}),
      ...(dto.trade_category_id ? {} : dto.trade ? { trade: dto.trade } : {}),
      ...(dto.trade_category_id ? { tradeCategoryId: dto.trade_category_id } : {}),
      ...(dto.worker_name ? { workerName: { contains: dto.worker_name, mode: "insensitive" } } : {}),
      ...(inferredRange.from || inferredRange.to
        ? {
            workDate: {
              ...(inferredRange.from ? { gte: inferredRange.from } : {}),
              ...(inferredRange.to ? { lte: inferredRange.to } : {})
            }
          }
        : {})
    };

    return this.prisma.photo.findMany({
      where,
      include: { room: true, tradeCategory: true, analyses: { orderBy: { createdAt: "desc" }, take: 1 } },
      orderBy: [{ workDate: "asc" }, { takenAt: "asc" }, { uploadedAt: "asc" }, { id: "asc" }],
      take: 120
    });
  }

  private async tryGenerateWithConfiguredModel(title: string, generatedBy: string, dto: GenerateReportDto, photos: PhotoForReport[]): Promise<ReportModelResult> {
    const configuredProvider = this.config.get<"GEMINI" | "OPENAI" | "ANTHROPIC">("REPORT_MODEL_PROVIDER", "GEMINI");
    const provider = dto.model_provider ?? configuredProvider;
    if (provider === "OPENAI") return this.tryGenerateWithOpenAI(title, generatedBy, dto, photos);
    if (provider === "ANTHROPIC") return this.tryGenerateWithAnthropic(title, generatedBy, dto, photos);
    return this.tryGenerateWithGemini(title, generatedBy, dto, photos);
  }

  private async tryGenerateWithGemini(title: string, generatedBy: string, dto: GenerateReportDto, photos: PhotoForReport[]): Promise<ReportModelResult> {
    const apiKey = this.config.get<string>("GEMINI_API_KEY");
    const modelName = this.config.get<string>("GEMINI_REPORT_MODEL", "gemini-3.5-flash");
    if (!apiKey) return { provider: "HEURISTIC", modelName: "bim-photo-sync-report-v1", content: null, errorMessage: null };

    try {
      const parts: Array<Record<string, unknown>> = [{ text: buildReportGenerationPrompt(title, generatedBy, dto, photos) }];

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

  private async tryGenerateWithOpenAI(title: string, generatedBy: string, dto: GenerateReportDto, photos: PhotoForReport[]): Promise<ReportModelResult> {
    const apiKey = this.config.get<string>("OPENAI_API_KEY");
    const modelName = this.config.get<string>("OPENAI_REPORT_MODEL", "gpt-5.5-2026-04-23");
    if (!apiKey) return { provider: "HEURISTIC", modelName: "bim-photo-sync-report-v1", content: null, errorMessage: null };

    try {
      const content: Array<Record<string, unknown>> = [{ type: "input_text", text: buildReportGenerationPrompt(title, generatedBy, dto, photos) }];
      for (const photo of photos.slice(0, 8)) {
        const image = await this.getPhotoInlineData(photo).catch(() => null);
        if (image) content.push({ type: "input_image", image_url: `data:${image.mime_type};base64,${image.data}` });
      }

      const res = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: modelName,
          input: [{ role: "user", content }],
          text: { format: { type: "json_object" } },
          max_output_tokens: 3500
        })
      });

      if (!res.ok) throw new Error(`OpenAI report generation failed: ${res.status} ${await res.text()}`);
      const json = (await res.json()) as unknown;
      const text = openAIResponseText(json);
      const parsed = parseReportJson(text);
      return { provider: "OPENAI", modelName, content: normalizeReportContent(parsed, title, generatedBy, dto, photos), errorMessage: null };
    } catch (error) {
      return {
        provider: "HEURISTIC",
        modelName: "bim-photo-sync-report-v1",
        content: null,
        errorMessage: error instanceof Error ? error.message : "OpenAI report generation failed."
      };
    }
  }

  private async tryGenerateWithAnthropic(title: string, generatedBy: string, dto: GenerateReportDto, photos: PhotoForReport[]): Promise<ReportModelResult> {
    const apiKey = this.config.get<string>("ANTHROPIC_API_KEY");
    const modelName = this.config.get<string>("ANTHROPIC_REPORT_MODEL", "claude-opus-4-8");
    if (!apiKey) return { provider: "HEURISTIC", modelName: "bim-photo-sync-report-v1", content: null, errorMessage: null };

    try {
      const content: Array<Record<string, unknown>> = [{ type: "text", text: buildReportGenerationPrompt(title, generatedBy, dto, photos) }];
      for (const photo of photos.slice(0, 8)) {
        const image = await this.getPhotoInlineData(photo).catch(() => null);
        if (image) {
          content.push({
            type: "image",
            source: {
              type: "base64",
              media_type: image.mime_type,
              data: image.data
            }
          });
        }
      }

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: modelName,
          max_tokens: 2500,
          tools: [
            {
              name: "generate_report",
              description: "Return the BIM construction photo report as a structured JSON object.",
              input_schema: reportToolInputSchema()
            }
          ],
          tool_choice: { type: "tool", name: "generate_report" },
          messages: [
            {
              role: "user",
              content
            }
          ]
        })
      });

      if (!res.ok) throw new Error(`Anthropic report generation failed: ${res.status} ${await res.text()}`);
      const json = (await res.json()) as { content?: Array<{ type?: string; text?: string; name?: string; input?: unknown }> };
      const toolInput = json.content?.find((part) => part.type === "tool_use" && part.name === "generate_report")?.input;
      const text = json.content?.map((part) => part.type === "text" ? part.text ?? "" : "").join("").trim() ?? "";
      const parsed = isRecord(toolInput) ? toolInput : parseReportJson(text);
      return { provider: "ANTHROPIC", modelName, content: normalizeReportContent(parsed, title, generatedBy, dto, photos), errorMessage: null };
    } catch (error) {
      return {
        provider: "HEURISTIC",
        modelName: "bim-photo-sync-report-v1",
        content: null,
        errorMessage: error instanceof Error ? error.message : "Anthropic report generation failed."
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

  private async getReportImages(content: ReportContent): Promise<ReportImage[]> {
    const photoIds = content.comparison_photos.map((photo) => photo.photo_id).filter((photoId) => photoId.length > 0);
    if (photoIds.length === 0) return [];

    const photos = await this.prisma.photo.findMany({
      where: { id: { in: photoIds }, status: "ACTIVE" },
      select: { id: true, objectKey: true, mimeType: true }
    });
    const photoById = new Map(photos.map((photo) => [photo.id, photo]));
    const images: ReportImage[] = [];

    for (const photoId of photoIds) {
      const photo = photoById.get(photoId);
      if (!photo) continue;
      const extension = imageExtension(photo.mimeType);
      if (!extension) continue;
      try {
        const object = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: photo.objectKey }));
        const chunks: Buffer[] = [];
        for await (const chunk of object.Body as AsyncIterable<Uint8Array>) {
          chunks.push(Buffer.from(chunk));
        }
        images.push({
          photoId,
          buffer: Buffer.concat(chunks),
          extension,
          mediaPath: `xl/media/report-photo-${images.length + 1}.${extension}`
        });
      } catch {
        // Missing image objects should not block report export; the text evidence remains in the template.
      }
    }

    return images;
  }
}

function buildTitle(dto: GenerateReportDto, photos: PhotoForReport[]) {
  const firstRoom = photos[0]?.room;
  const parts = [
    firstRoom ? `${firstRoom.roomNumber ?? ""}${firstRoom.roomName}`.trim() : "현장전체",
    dto.work_surface ?? null,
    dto.trade ?? null,
    dateRangeLabel(dto)?.replace(/\s/g, "") ?? null,
    dto.worker_name ?? null
  ].filter((part): part is string => typeof part === "string" && part.length > 0);
  const generatedDate = new Date().toISOString().slice(0, 10);
  return `${parts.join("_") || "현장"}_분석보고서(${generatedDate})`;
}

function buildReportGenerationPrompt(title: string, generatedBy: string, dto: GenerateReportDto, photos: PhotoForReport[]) {
  return [
    "Priority instruction: follow this structured schema even if any later legacy instruction conflicts.",
    "Return strict JSON only, with Korean user-facing values.",
    "Required JSON fields: title, generated_at, generated_by, filters, situation, comparison_photos, work_log, judgment, progress_timeline, analysis_result, memo.",
    "comparison_photos must keep the same photo_id values and count as the input photos.",
    "work_log must contain exactly one row per input photo; do not create rows for dates with no photos.",
    "work_log fields: photo_id, date, work_item, work_detail, note.",
    "work_item must be '<work surface label> / <actual task name>', for example '바닥 / 에폭시 프라이머 도포'.",
    "work_detail must be a construction-log detail sentence based on both the image and the worker-written description.",
    "note must be a caution, check item, or site note for that task. Do not put the worker name in note.",
    "judgment fields: quality_status, special_notes, overall_opinion.",
    "judgment must summarize the whole workflow and final judgement, not describe each photo one by one.",
    "analysis_result must be a short overall Korean summary; detailed table text belongs in work_log and judgment.",
    "너는 BIM 현장 사진 분석 보고서 작성자다.",
    "아래 사진과 메타데이터를 근거로 한국어 JSON 보고서를 작성한다.",
    "반드시 JSON만 반환한다. Markdown은 금지한다.",
    "JSON 필드: title, generated_at, generated_by, filters, situation, comparison_photos, progress_timeline, analysis_result, memo.",
    "comparison_photos는 입력 사진 수와 같은 수로 작성하고, 입력 photo_id를 그대로 유지한다.",
    "분류와 분석 순서는 프로젝트 → 방(실) → 공사면 → 작업일자 → 공종 → 작성자(작업자) 순서를 따른다.",
    "비교 사진은 같은 방/공사면 안에서 날짜순 변화가 드러나도록 설명한다.",
    "analysis_result는 work_items, details, precautions, judgment 값을 포함하는 간결한 한국어 문장으로 작성한다.",
    `제목: ${title}`,
    `생성자: ${generatedBy}`,
    `필터: ${JSON.stringify(reportFilters(dto))}`,
    dto.ai_prompt ? `관리자 추가 지시: ${dto.ai_prompt}` : "",
    `사진 메타데이터: ${JSON.stringify(photos.map(photoSummary))}`
  ].filter(Boolean).join("\n");
}

function reportToolInputSchema(): Record<string, unknown> {
  const stringField = { type: "string" };
  const nullableStringField = { type: ["string", "null"] };
  return {
    type: "object",
    additionalProperties: false,
    required: ["title", "generated_at", "generated_by", "filters", "situation", "comparison_photos", "work_log", "judgment", "progress_timeline", "analysis_result", "memo"],
    properties: {
      title: stringField,
      generated_at: stringField,
      generated_by: stringField,
      filters: { type: "object", additionalProperties: { type: ["string", "null"] } },
      situation: {
        type: "object",
        additionalProperties: false,
        required: ["project_id", "room", "work_surface", "trade", "date_range", "worker_name"],
        properties: {
          project_id: stringField,
          room: nullableStringField,
          work_surface: nullableStringField,
          trade: nullableStringField,
          date_range: nullableStringField,
          worker_name: nullableStringField
        }
      },
      comparison_photos: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["photo_id", "work_date", "room", "work_surface", "trade", "worker_name", "description", "ai_description"],
          properties: {
            photo_id: stringField,
            work_date: stringField,
            room: stringField,
            work_surface: stringField,
            trade: stringField,
            worker_name: nullableStringField,
            description: nullableStringField,
            ai_description: nullableStringField
          }
        }
      },
      work_log: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["photo_id", "date", "work_item", "work_detail", "note"],
          properties: {
            photo_id: stringField,
            date: stringField,
            work_item: stringField,
            work_detail: stringField,
            note: stringField
          }
        }
      },
      judgment: {
        type: "object",
        additionalProperties: false,
        required: ["quality_status", "special_notes", "overall_opinion"],
        properties: {
          quality_status: stringField,
          special_notes: stringField,
          overall_opinion: stringField
        }
      },
      progress_timeline: { type: "array", items: stringField },
      analysis_result: stringField,
      memo: nullableStringField
    }
  };
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
      date_range: dateRangeLabel(dto),
      worker_name: dto.worker_name ?? null
    },
    comparison_photos: sorted.map(photoSummary),
    work_log: sorted.map((photo) => buildFallbackWorkLogEntry(photo)),
    judgment: buildFallbackJudgment(sorted, dto),
    progress_timeline: timeline,
    analysis_result: analysis,
    memo: dto.memo ?? null
  };
}

function buildFallbackWorkLogEntry(photo: PhotoForReport): ReportWorkLogEntry {
  const summary = photoSummary(photo);
  const description = summary.description ?? summary.ai_description ?? "";
  return {
    photo_id: photo.id,
    date: summary.work_date,
    work_item: fallbackWorkItem(summary),
    work_detail: fallbackWorkDetail(summary),
    note: fallbackWorkNote(summary)
  };
}

function buildFallbackJudgment(photos: PhotoForReport[], dto: GenerateReportDto): ReportJudgment {
  const sorted = sortPhotosForReport(photos);
  const firstDate = sorted[0]?.workDate.toISOString().slice(0, 10) ?? "";
  const lastDate = sorted[sorted.length - 1]?.workDate.toISOString().slice(0, 10) ?? "";
  const steps = uniqueText(sorted.map((photo) => extractTaskName(photo.description ?? photo.aiDescription ?? "")));
  const room = sorted[0] ? roomLabel(sorted[0]) : null;
  const scope = [room, dto.work_surface ? reportWorkSurfaceLabel(dto.work_surface) : null, dto.trade ?? sorted[0]?.tradeCategory?.label ?? sorted[0]?.trade ?? null]
    .filter((item): item is string => Boolean(item))
    .join(" / ");
  return {
    quality_status: sorted.length > 0
      ? `${scope || "현장"} 작업은 ${formatReportDateRange(`${firstDate} ~ ${lastDate}`)} 기간 동안 ${steps.join(" → ") || "등록된 작업"} 순서로 진행된 것으로 확인됩니다. 작업자 입력 내용과 사진 근거를 함께 검토했으며, 최종 품질 판정은 현장 확인과 양생/마감 상태 점검을 기준으로 확정해야 합니다.`
      : "선택한 조건에 해당하는 작업 사진이 없어 품질 상태를 판단할 수 없습니다.",
    special_notes: sorted.length > 0
      ? "작업 단계 간 건조·양생 시간, 표면 이물질, 들뜸, 기포, 미시공 구간 여부를 후속 점검에서 확인해야 합니다."
      : "기간, 방, 공종, 공사면 조건을 확인한 뒤 다시 생성해야 합니다.",
    overall_opinion: sorted.length > 0
      ? `${sorted.length}장의 사진 근거와 작업자 입력 내용을 종합하여 공정 흐름을 확인했습니다. 보고서의 작업일지와 사진 페이지를 함께 검토해 누락 공정 여부를 확인하십시오.`
      : "검토 가능한 사진 근거가 없습니다."
  };
}

function buildHeuristicChatAnswer(message: string, dto: ReportChatDto, photos: PhotoForReport[]) {
  const dateText = dateRangeLabel(dto) ?? "전체 기간";
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
    const firstTakenTime = a.takenAt?.getTime() ?? a.uploadedAt.getTime();
    const secondTakenTime = b.takenAt?.getTime() ?? b.uploadedAt.getTime();
    return (
      a.workDate.getTime() - b.workDate.getTime() ||
      firstTakenTime - secondTakenTime ||
      a.uploadedAt.getTime() - b.uploadedAt.getTime() ||
      a.id.localeCompare(b.id) ||
      roomLabel(a).localeCompare(roomLabel(b), "ko-KR") ||
      a.workSurface.localeCompare(b.workSurface) ||
      a.trade.localeCompare(b.trade) ||
      (a.workerName ?? "").localeCompare(b.workerName ?? "", "ko-KR")
    );
  });
}

function reportFilters(dto: GenerateReportDto | ReportChatDto) {
  const inferred = !dto.date_from && !dto.date_to ? inferMonthRange(promptTextForDto(dto)) : null;
  return {
    project_id: dto.project_id,
    room_id: dto.room_id ?? null,
    work_surface: dto.work_surface ?? null,
    trade: dto.trade ?? null,
    trade_category_id: dto.trade_category_id ?? null,
    date_from: dto.date_from ?? inferred?.from ?? null,
    date_to: dto.date_to ?? inferred?.to ?? null,
    worker_name: dto.worker_name ?? null,
    ai_prompt: "ai_prompt" in dto ? dto.ai_prompt ?? null : null
  };
}

function inferDateRange(dto: GenerateReportDto | ReportChatDto) {
  const promptText = promptTextForDto(dto);
  const fromText = dto.date_from ?? null;
  const toText = dto.date_to ?? null;
  const inferred = !fromText && !toText ? inferMonthRange(promptText) : null;
  return {
    from: dateAtStartOfDay(fromText ?? inferred?.from ?? null),
    to: dateAtEndOfDay(toText ?? inferred?.to ?? null)
  };
}

function promptTextForDto(dto: GenerateReportDto | ReportChatDto) {
  return "message" in dto ? dto.message : dto.ai_prompt ?? "";
}

function dateRangeLabel(dto: GenerateReportDto | ReportChatDto) {
  const filters = reportFilters(dto);
  return filters.date_from || filters.date_to ? `${filters.date_from ?? "시작"} ~ ${filters.date_to ?? "현재"}` : null;
}

function inferMonthRange(text: string) {
  const match = text.match(/(?:(20\d{2})\s*년\s*)?(\d{1,2})\s*월/);
  if (!match) return null;
  const year = match[1] ? Number(match[1]) : new Date().getFullYear();
  const month = Number(match[2]);
  if (!Number.isInteger(year) || month < 1 || month > 12) return null;
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const end = new Date(Date.UTC(year, month, 0));
  const to = `${year}-${String(month).padStart(2, "0")}-${String(end.getUTCDate()).padStart(2, "0")}`;
  return { from, to };
}

function dateAtStartOfDay(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function dateAtEndOfDay(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCHours(23, 59, 59, 999);
  return date;
}

function photoSummary(photo: PhotoForReport) {
  return {
    photo_id: photo.id,
    work_date: photo.workDate.toISOString().slice(0, 10),
    room: roomLabel(photo),
    work_surface: photo.workSurface,
    trade: photo.tradeCategory?.label ?? photo.trade,
    worker_name: photo.workerName,
    description: photo.description,
    ai_description: photo.aiDescription ?? photo.analyses[0]?.summary ?? null
  };
}

function roomLabel(photo: PhotoForReport) {
  return `${photo.room.roomNumber ?? ""} ${photo.room.roomName}`.trim();
}

function parseReportJson(text: string) {
  const withoutFence = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  const firstBrace = withoutFence.indexOf("{");
  const lastBrace = withoutFence.lastIndexOf("}");
  const cleaned = firstBrace >= 0 && lastBrace > firstBrace ? withoutFence.slice(firstBrace, lastBrace + 1) : withoutFence;
  return JSON.parse(cleaned) as Partial<ReportContent>;
}

function openAIResponseText(value: unknown) {
  if (!isRecord(value)) return "";
  const directText = stringifyReportValue(value.output_text);
  if (directText) return directText;
  const output = Array.isArray(value.output) ? value.output : [];
  return output
    .flatMap((item) => isRecord(item) && Array.isArray(item.content) ? item.content : [])
    .map((part) => {
      if (!isRecord(part)) return "";
      return stringifyReportValue(part.text ?? part.output_text);
    })
    .filter((text) => text.length > 0)
    .join("\n")
    .trim();
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
  const comparisonById = new Map(comparisonPhotos.map((photo) => [photo.photo_id, photo]));
  const mergedComparisonPhotos = fallback.comparison_photos.map((fallbackPhoto, index) => {
    const generatedPhoto = comparisonById.get(fallbackPhoto.photo_id) ?? comparisonPhotos[index];
    return generatedPhoto ? { ...fallbackPhoto, ...generatedPhoto, photo_id: fallbackPhoto.photo_id } : fallbackPhoto;
  });
  const timeline = Array.isArray(value.progress_timeline)
    ? value.progress_timeline.map((line) => stringifyReportValue(line)).filter((line) => line.length > 0)
    : [];
  const workLog = Array.isArray(value.work_log)
    ? value.work_log.map((row, index) => normalizeWorkLogEntry(row, fallback.work_log?.[index], mergedComparisonPhotos[index])).filter((row): row is ReportWorkLogEntry => row !== null)
    : [];
  return {
    ...fallback,
    title: stringifyReportValue(value.title) || fallback.title,
    generated_at: stringifyReportValue(value.generated_at) || fallback.generated_at,
    generated_by: stringifyReportValue(value.generated_by) || fallback.generated_by,
    filters: isRecord(value.filters) ? normalizeStringRecord(value.filters) : fallback.filters,
    situation: isRecord(value.situation) ? { ...fallback.situation, ...normalizeStringRecord(value.situation) } : fallback.situation,
    comparison_photos: mergedComparisonPhotos,
    work_log: workLog.length ? workLog : fallback.work_log,
    judgment: normalizeJudgment(value.judgment, fallback.judgment),
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
    work_log: Array.isArray(value.work_log)
      ? value.work_log.map((row) => normalizeWorkLogEntry(row, undefined, undefined)).filter((row): row is ReportWorkLogEntry => row !== null)
      : undefined,
    judgment: normalizeJudgment(value.judgment, undefined),
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

function normalizeWorkLogEntry(
  value: unknown,
  fallback: ReportWorkLogEntry | undefined,
  photo: ReportContent["comparison_photos"][number] | undefined
): ReportWorkLogEntry | null {
  if (!isRecord(value) && !fallback && !photo) return null;
  const record = isRecord(value) ? value : {};
  const photoId = stringifyReportValue(record.photo_id ?? record.photoId) || fallback?.photo_id || photo?.photo_id || "";
  const date = stringifyReportValue(record.date ?? record.work_date ?? record.workDate) || fallback?.date || photo?.work_date || "";
  const item = stringifyReportValue(record.work_item ?? record.item) || fallback?.work_item || fallbackWorkItem(photo) || "";
  const detail = stringifyReportValue(record.work_detail ?? record.detail) || fallback?.work_detail || photo?.description || photo?.ai_description || "";
  const note = stringifyReportValue(record.note ?? record.precautions ?? record.caution) || fallback?.note || fallbackWorkNote(photo) || "";
  if (!photoId && !date && !item && !detail && !note) return null;
  return {
    photo_id: photoId,
    date,
    work_item: item,
    work_detail: detail,
    note
  };
}

function normalizeJudgment(value: unknown, fallback: ReportJudgment | undefined): ReportJudgment | undefined {
  if (!isRecord(value)) return fallback;
  return {
    quality_status: stringifyReportValue(value.quality_status ?? value.qualityStatus) || fallback?.quality_status || "",
    special_notes: stringifyReportValue(value.special_notes ?? value.specialNotes) || fallback?.special_notes || "",
    overall_opinion: stringifyReportValue(value.overall_opinion ?? value.overallOpinion) || fallback?.overall_opinion || ""
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

function renderDocx(content: ReportContent, images: ReportImage[] = []) {
  const templateEntries = readWordTemplateEntries();
  const templateDocumentXml = templateEntries.find((entry) => entry.path === "word/document.xml")?.content.toString("utf8");
  const templateRelsXml = templateEntries.find((entry) => entry.path === "word/_rels/document.xml.rels")?.content.toString("utf8");
  if (!templateDocumentXml || !templateRelsXml) {
    throw new Error("Report template is missing Word document parts.");
  }
  const documentXml = patchWordTemplateDocument(templateDocumentXml, content, images);
  const relsXml = ensureWordImageRelationships(templateRelsXml, images);
  const mediaEntries = images.map((image, index) => ({
    path: `word/media/report-photo-${index + 1}.${image.extension}`,
    content: image.buffer
  }));
  const entries = upsertEntries(templateEntries, [
    { path: "word/document.xml", content: textBuffer(documentXml) },
    { path: "word/_rels/document.xml.rels", content: textBuffer(relsXml) },
    ...mediaEntries
  ]).map((entry) => entry.path === "[Content_Types].xml"
    ? { ...entry, content: textBuffer(ensureWordImageContentTypes(entry.content.toString("utf8"), images)) }
    : entry.path === "word/styles.xml"
      ? { ...entry, content: textBuffer(ensureWordStylesFont(entry.content.toString("utf8"))) }
    : entry);

  return zipStore(entries);
}

function patchWordTemplateDocument(xml: string, content: ReportContent, images: ReportImage[]) {
  const withText = replaceWordTextNodes(xml, wordTemplateTextReplacements(content));
  const withWorkLog = replaceTemplateWorkLogTable(withText, content);
  const withDynamicPhotoSection = replaceTemplatePhotoSection(withWorkLog, content, images);
  return ensureWordDocumentFonts(ensureWordDrawingNamespaces(withDynamicPhotoSection));
}

function replaceWordTextNodes(xml: string, replacements: Map<number, string>) {
  let index = 0;
  return xml.replace(/<w:t\b([^>]*)>([\s\S]*?)<\/w:t>/g, (_match, attributes: string) => {
    const replacement = replacements.get(index);
    index += 1;
    if (replacement === undefined) return _match;
    return `<w:t${attributes}>${xmlEscape(compactReportText(replacement))}</w:t>`;
  });
}

function wordTemplateTextReplacements(content: ReportContent) {
  const replacements = new Map<number, string>();
  const dateRange = content.situation.date_range ?? photoDateRange(content.comparison_photos) ?? content.generated_at;
  const workRows = buildWorkLogRows(content).slice(0, 6);
  const judgment = reportJudgmentContent(content, dateRange);

  replacements.set(0, reportDocumentTitle(content));
  replaceTextRunRange(replacements, [3, 4, 5], reportTradeLabel(dominantReportTrade(content)));
  replacements.set(7, formatReportDateRange(dateRange));
  replacements.set(9, formatKoreanDate(content.generated_at));
  replacements.set(11, content.generated_by);

  const rowTextNodes = [
    { date: [17], item: [18, 19, 20], detail: [21, 22, 23, 24, 25], note: [26] },
    { date: [27], item: [28, 29, 30], detail: [31, 32, 33, 34], note: [35] },
    { date: [36], item: [37, 38, 39, 40, 41], detail: [42, 43, 44, 45, 46, 47, 48, 49, 50], note: [51] },
    { date: [52], item: [53], detail: [54], note: [55] },
    { date: [56], item: [57], detail: [58, 59, 60, 61, 62], note: [63, 64] },
    { date: [65], item: [66], detail: [67, 68, 69], note: [70] }
  ];

  rowTextNodes.forEach((nodeSet, index) => {
    const row = workRows[index];
    replaceTextRunRange(replacements, nodeSet.date, row?.date ?? "");
    replaceTextRunRange(replacements, nodeSet.item, row?.item ?? "");
    replaceTextRunRange(replacements, nodeSet.detail, row?.detail ?? "");
    replaceTextRunRange(replacements, nodeSet.note, row?.note ?? "");
  });

  replaceTextRunRange(replacements, [73, 74, 75, 76, 77, 78, 79, 80, 81], judgment.scope);
  replaceTextRunRange(replacements, [83, 84, 85, 86, 87], judgment.quality);
  replacements.set(89, judgment.completedAt);
  replacements.set(91, judgment.notes);
  replaceTextRunRange(replacements, [93, 94, 95], judgment.opinion);
  replaceTextRunRange(replacements, [96, 97, 98], "※ 본 보고서는 BIM Photo Sync 현장 사진과 AI 분석 결과를 기준으로 작성되었습니다. 실제 시공 상황에 따라 일정 및 작업 내용이 변경될 수 있습니다.");
  replacements.set(99, "※ 비고란의 주의사항은 현장 조건에 따라 감독관의 지시에 따르십시오.");

  const photoNodeSets = [
    [104, 105, 106, 107, 108],
    [111, 112, 113, 114, 115],
    [118, 119, 120, 121, 122],
    [125, 126, 127, 128, 129],
    [132, 133, 134, 135, 136],
    [139, 140, 141, 142, 143]
  ];

  photoNodeSets.forEach((nodeIndexes, index) => {
    const photo = content.comparison_photos[index];
    const values = photo ? photoSlotText(photo) : ["", "", "", "", ""];
    nodeIndexes.forEach((nodeIndex, valueIndex) => replacements.set(nodeIndex, values[valueIndex] ?? ""));
  });

  return replacements;
}

function replaceTextRunRange(replacements: Map<number, string>, indexes: number[], value: string) {
  indexes.forEach((index, offset) => replacements.set(index, offset === 0 ? value : ""));
}

function replacePhotoPlaceholders(xml: string, content: ReportContent, images: ReportImage[]) {
  let index = 0;
  return xml.replace(/<w:p\b(?![^>]*\/>)(?:(?!<\/w:p>)[\s\S])*?\[ 사진(?:(?!<\/w:p>)[\s\S])*?첨부 \](?:(?!<\/w:p>)[\s\S])*?<\/w:p>/g, (match) => {
    const image = images[index];
    const replacement = image
      ? wordImageParagraph(`rIdPhoto${index + 1}`, `report-photo-${index + 1}`, 2050000, 1150000)
      : content.comparison_photos[index] ? wordParagraph("[ 사진 첨부 ]", { align: "center", color: "667085", size: 18 }) : match;
    index += 1;
    return replacement;
  });
}

function replaceTemplatePhotoSection(xml: string, content: ReportContent, images: ReportImage[]) {
  const photoSection = dynamicPhotoSectionXml(content, images);
  const pattern = /<w:p\b(?:(?!<\/w:p>)[\s\S])*?시공 현장 사진(?:(?!<\/w:p>)[\s\S])*?<\/w:p>[\s\S]*?(?=<w:sectPr\b)/;
  if (pattern.test(xml)) return xml.replace(pattern, photoSection);
  return replacePhotoPlaceholders(xml, content, images);
}

function replaceTemplateWorkLogTable(xml: string, content: ReportContent) {
  let replaced = false;
  return xml.replace(/<w:tbl\b[\s\S]*?<\/w:tbl>/g, (tableXml) => {
    if (replaced || !tableXml.includes("<w:t>날짜</w:t>") || !tableXml.includes("<w:t>작업 항목</w:t>") || !tableXml.includes("<w:t>작업 상세 내용</w:t>")) {
      return tableXml;
    }
    replaced = true;
    return compactWorkLogTable(content);
  });
}

function compactWorkLogTable(content: ReportContent) {
  const rows = buildWorkLogRows(content);
  return wordTable([
    [
      wordTextCell("날짜", 1400, { bold: true, fill: "EAF1F8", align: "center", size: 18 }),
      wordTextCell("작업 항목", 1800, { bold: true, fill: "EAF1F8", align: "center", size: 18 }),
      wordTextCell("작업 상세 내용", 5000, { bold: true, fill: "EAF1F8", align: "center", size: 18 }),
      wordTextCell("비고 / 주의사항", 1800, { bold: true, fill: "EAF1F8", align: "center", size: 18 })
    ],
    ...rows.map((row) => [
      wordTextCell(row.date, 1400, { align: "center", size: 16 }),
      wordTextCell(row.item, 1800, { size: 16 }),
      wordTextCell(row.detail, 5000, { size: 16 }),
      wordTextCell(row.note, 1800, { size: 16 })
    ])
  ], { width: 9000, columnWidths: [1400, 1800, 5000, 1800] });
}

function dynamicPhotoSectionXml(content: ReportContent, images: ReportImage[]) {
  const imageByPhotoId = new Map(images.map((image, index) => [image.photoId, { ...image, relId: `rIdPhoto${index + 1}` }]));
  return [
    `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`,
    wordParagraph("시공 현장 사진", { align: "center", bold: true, size: 32, spacingAfter: 80 }),
    wordParagraph("Construction Site Photos", { align: "center", bold: true, size: 20, spacingAfter: 180 }),
    photoGridTable(content, imageByPhotoId)
  ].join("");
}

function ensureWordImageRelationships(existing: string, images: ReportImage[]) {
  return images.reduce((xml, image, index) => {
    return ensureRelationshipXml(
      xml,
      `rIdPhoto${index + 1}`,
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
      `media/report-photo-${index + 1}.${image.extension}`
    );
  }, existing);
}

function ensureWordDrawingNamespaces(xml: string) {
  const namespaceByPrefix: Record<string, string> = {
    a: "http://schemas.openxmlformats.org/drawingml/2006/main",
    pic: "http://schemas.openxmlformats.org/drawingml/2006/picture"
  };
  return xml.replace(/<w:document\b([^>]*)>/, (match, attributes: string) => {
    const additions = Object.entries(namespaceByPrefix)
      .filter(([prefix]) => !attributes.includes(`xmlns:${prefix}=`))
      .map(([prefix, namespace]) => ` xmlns:${prefix}="${namespace}"`)
      .join("");
    return additions.length > 0 ? match.replace(">", `${additions}>`) : match;
  });
}

function reportJudgmentContent(content: ReportContent, dateRange: string) {
  const sections = reportAnalysisSections(content.analysis_result);
  const trade = reportTradeLabel(dominantReportTrade(content));
  const scope = `${content.situation.room ?? "현장 전체"} / ${trade} / ${formatReportDateRange(dateRange)}`;
  const quality = content.judgment?.quality_status || sections.judgment || sections.details || content.analysis_result || "등록된 사진 기준 분석 결과가 없습니다.";
  const notes = content.judgment?.special_notes || sections.precautions || content.memo || "현장 조건과 누락 사진 여부를 다음 점검 시 재확인합니다.";
  const opinion = content.judgment?.overall_opinion || (content.comparison_photos.length > 0
    ? `${content.comparison_photos.length}장의 사진 근거와 작업자 입력 내용을 종합하여 공정 흐름과 시공 상태를 확인했습니다.`
    : "선택한 조건에 해당하는 사진 데이터가 없습니다.");
  return {
    scope,
    quality,
    completedAt: reportLastDateText(content),
    notes,
    opinion
  };
}
function reportAnalysisSections(text: string) {
  const result = { workItems: "", details: "", precautions: "", judgment: "" };
  const matches = Array.from(text.matchAll(/(?:^| \/ )(?<key>work_items|details|precautions|judgment):\s*(?<value>.*?)(?= \/ (?:work_items|details|precautions|judgment):|$)/g));
  for (const match of matches) {
    const key = match.groups?.key;
    const value = match.groups?.value?.trim() ?? "";
    if (key === "work_items") result.workItems = value;
    if (key === "details") result.details = value;
    if (key === "precautions") result.precautions = value;
    if (key === "judgment") result.judgment = value;
  }
  return result;
}

function photoSlotText(photo: ReportContent["comparison_photos"][number]) {
  return [
    `\uBC29 ${photo.room}`,
    `\uACF5\uC885 ${reportTradeLabel(photo.trade)}`,
    `\uACF5\uC0AC\uBA74 ${reportWorkSurfaceLabel(photo.work_surface)}`,
    "\uACF5\uC0AC\uC77C",
    formatKoreanDate(photo.work_date)
  ];
}

function reportWorkLogLabel(value: string) {
  return value.split("/").map((part) => {
    const trimmed = part.trim();
    return reportWorkSurfaceLabel(reportTradeLabel(trimmed));
  }).join(" / ");
}

function reportTradeLabel(value: string) {
  const labels: Record<string, string> = {
    WATERPROOF: "\uBC29\uC218",
    TILE: "\uD0C0\uC77C",
    PAINT: "\uB3C4\uC7A5",
    ELECTRIC: "\uC804\uAE30",
    MEP: "\uAE30\uACC4/\uC124\uBE44",
    WINDOW: "\uCC3D\uD638",
    CONCRETE: "\uCF58\uD06C\uB9AC\uD2B8",
    OTHER: "\uAE30\uD0C0"
  };
  return labels[value] ?? value;
}

function reportWorkSurfaceLabel(value: string) {
  const labels: Record<string, string> = {
    FLOOR: "\uBC14\uB2E5",
    WALL: "\uBCBD",
    ENTRY_WALL: "\uC785\uAD6C\uBCBD",
    FRONT_WALL: "\uC815\uBA74\uBCBD",
    RIGHT_WALL: "\uC6B0\uCE21\uBCBD",
    LEFT_WALL: "\uC88C\uCE21\uBCBD",
    CEILING: "\uCC9C\uC7A5",
    WINDOW: "\uCC3D",
    DOOR: "\uBB38",
    PIPE: "\uBC30\uAD00",
    ELECTRIC: "\uC804\uAE30",
    OTHER: "\uAE30\uD0C0"
  };
  return labels[value] ?? value;
}

function compactReportText(value: string) {
  return value.replace(/\s*\n+\s*/g, " ").replace(/\s{2,}/g, " ").trim();
}

function reportDocumentXml(content: ReportContent, images: ReportImage[]) {
  const photoImagesById = new Map(images.map((image, index) => [image.photoId, { ...image, relId: `rIdPhoto${index + 1}` }]));
  const dateRange = content.situation.date_range ?? photoDateRange(content.comparison_photos) ?? content.generated_at;
  const body = [
    wordParagraph(reportDocumentTitle(content), { align: "center", bold: true, size: 36, spacingAfter: 260 }),
    reportInfoTable(content, dateRange),
    wordParagraph(""),
    workLogTable(content),
    wordParagraph(""),
    judgmentTable(content, dateRange),
    wordParagraph("※ 본 보고서는 BIM Photo Sync 현장 사진과 AI 분석 결과를 기준으로 작성되었습니다.", { size: 17 }),
    wordParagraph("※ 실제 시공 상황과 최종 품질 판단은 현장 감독관 검토를 기준으로 확정하십시오.", { size: 17 }),
    `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`,
    wordParagraph("시공 현장 사진", { align: "center", bold: true, size: 34, spacingAfter: 80 }),
    wordParagraph("Construction Site Photos", { align: "center", bold: true, size: 20, spacingAfter: 220 }),
    photoGridTable(content, photoImagesById)
  ].join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="850" w:right="850" w:bottom="850" w:left="850" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body>
</w:document>`;
}

function reportInfoTable(content: ReportContent, dateRange: string) {
  return wordTable([
    [
      wordTextCell("■ 공종", 1900, { bold: true, fill: "F2F6FB" }),
      wordTextCell(dominantReportTrade(content), 3300),
      wordTextCell("■ 시공 기간", 1900, { bold: true, fill: "F2F6FB" }),
      wordTextCell(formatReportDateRange(dateRange), 3600)
    ],
    [
      wordTextCell("■ 작성일", 1900, { bold: true, fill: "F2F6FB" }),
      wordTextCell(formatKoreanDate(content.generated_at), 3300),
      wordTextCell("■ 작성자", 1900, { bold: true, fill: "F2F6FB" }),
      wordTextCell(content.generated_by, 3600)
    ]
  ], { width: 11700, columnWidths: [1900, 3300, 1900, 3600] });
}

function workLogTable(content: ReportContent) {
  const rows = buildWorkLogRows(content);
  return wordTable([
    [
      wordTextCell("날짜", 1900, { bold: true, fill: "EAF1F8", align: "center" }),
      wordTextCell("작업 항목", 2500, { bold: true, fill: "EAF1F8", align: "center" }),
      wordTextCell("작업 상세 내용", 5300, { bold: true, fill: "EAF1F8", align: "center" }),
      wordTextCell("비고 / 주의사항", 2000, { bold: true, fill: "EAF1F8", align: "center" })
    ],
    ...rows.map((row) => [
      wordTextCell(row.date, 1900, { align: "center", size: 18 }),
      wordTextCell(row.item, 2500, { size: 18 }),
      wordTextCell(row.detail, 5300, { size: 18 }),
      wordTextCell(row.note, 2000, { size: 18 })
    ])
  ], { width: 11700, columnWidths: [1900, 2500, 5300, 2000] });
}

function judgmentTable(content: ReportContent, dateRange: string) {
  const judgment = reportJudgmentContent(content, dateRange);
  return wordTable([
    [wordRawCell(wordParagraph("\u25A0 \uC885\uD569 \uD310\uB2E8", { bold: true, size: 24 }), 11700, { gridSpan: 2, fill: "F8FAFC" })],
    [wordTextCell("\uC2DC\uACF5 \uBC94\uC704", 2200, { bold: true, fill: "F2F6FB" }), wordTextCell(judgment.scope, 9500)],
    [wordTextCell("\uD488\uC9C8 \uC0C1\uD0DC", 2200, { bold: true, fill: "F2F6FB" }), wordTextCell(judgment.quality, 9500)],
    [wordTextCell("\uC644\uB8CC \uC77C\uC790", 2200, { bold: true, fill: "F2F6FB" }), wordTextCell(judgment.completedAt, 9500)],
    [wordTextCell("\uD2B9\uC774 \uC0AC\uD56D", 2200, { bold: true, fill: "F2F6FB" }), wordTextCell(judgment.notes, 9500)],
    [wordTextCell("\uC885\uD569 \uC758\uACAC", 2200, { bold: true, fill: "F2F6FB" }), wordTextCell(judgment.opinion, 9500)]
  ], { width: 11700, columnWidths: [2200, 9500] });
}

function photoGridTable(
  content: ReportContent,
  imageByPhotoId: Map<string, ReportImage & { relId: string }>
) {
  const slots = content.comparison_photos.length > 0 ? content.comparison_photos : [null];
  const rows: string[][] = [];
  for (let start = 0; start < slots.length; start += 2) {
    const left = slots[start] ?? null;
    const right = slots[start + 1] ?? null;
    rows.push(right ? [photoSlotCell(left, imageByPhotoId, 4500), photoSlotCell(right, imageByPhotoId, 4500)] : [photoSlotCell(left, imageByPhotoId, 9000, 2)]);
  }
  return wordTable(rows, { width: 9000, columnWidths: [4500, 4500] });
}

function photoSlotCell(
  photo: ReportContent["comparison_photos"][number] | null,
  imageByPhotoId: Map<string, ReportImage & { relId: string }>,
  width: number,
  gridSpan?: number
) {
  const image = photo ? imageByPhotoId.get(photo.photo_id) : null;
  const imageBlock = image
    ? wordImageParagraph(image.relId, `report-photo-${photo?.photo_id ?? "empty"}`, gridSpan ? 3900000 : 1950000, gridSpan ? 2200000 : 1100000)
    : wordParagraph("[ 사진 첨부 ]", { align: "center", bold: true, color: "667085", size: 20, spacingAfter: 80 });
  const meta = photo
    ? [
        ["방", photo.room],
        ["공종", reportTradeLabel(photo.trade) || "전체 공종"],
        ["공사면", reportWorkSurfaceLabel(photo.work_surface)],
        ["공사일", formatKoreanDate(photo.work_date)],
        ["작업내용", photo.description ?? photo.ai_description ?? "내용 없음"]
      ]
    : [
        ["방", ""],
        ["공종", ""],
        ["공사면", ""],
        ["공사일", "년 - 월 - 일"],
        ["작업내용", ""]
      ];
  const metaXml = wordTable(meta.map(([label, value]) => [
    wordTextCell(label, 1200, { bold: true, fill: "F8FAFC", size: 17 }),
    wordTextCell(value, width - 1700, { size: 17 })
  ]), { width: width - 500, nested: true, columnWidths: [1200, width - 1700] });

  return wordRawCell(`${imageBlock}${metaXml}`, width, gridSpan ? { gridSpan } : {});
}

function fallbackWorkItem(photo: ReportContent["comparison_photos"][number] | undefined) {
  if (!photo) return "";
  return [reportWorkSurfaceLabel(photo.work_surface), extractTaskName(photo.description ?? photo.ai_description ?? "")]
    .filter((value) => value.length > 0)
    .join(" / ");
}

function fallbackWorkDetail(photo: ReportContent["comparison_photos"][number]) {
  const description = photo.description ?? photo.ai_description ?? "";
  const taskName = extractTaskName(description);
  if (description.length > 0) {
    return `${photo.room} \uAD6C\uC5ED\uC5D0\uC11C ${taskName || description} \uC791\uC5C5\uC774 \uAE30\uB85D\uB418\uC5C8\uC2B5\uB2C8\uB2E4. \uC0AC\uC9C4\uACFC \uC791\uC5C5\uC790 \uC785\uB825 \uB0B4\uC6A9\uC744 \uAE30\uC900\uC73C\uB85C \uD574\uB2F9 \uACF5\uC815\uC758 \uC9C4\uD589 \uC0C1\uD0DC\uB97C \uD655\uC778\uD569\uB2C8\uB2E4.`;
  }
  return `${photo.room} \uAD6C\uC5ED\uC758 ${reportWorkSurfaceLabel(photo.work_surface)} \uACF5\uC0AC\uBA74 \uC0AC\uC9C4\uC774 \uB4F1\uB85D\uB418\uC5C8\uC2B5\uB2C8\uB2E4.`;
}

function fallbackWorkNote(photo: ReportContent["comparison_photos"][number] | undefined) {
  const workItem = extractTaskName(photo?.description ?? photo?.ai_description ?? "");
  if (/(?:\uD504\uB77C\uC774\uBA38|\uD558\uB3C4)/i.test(workItem)) return "\uB3C4\uD3EC \uD6C4 \uCDA9\uBD84\uD55C \uAC74\uC870 \uC2DC\uAC04\uACFC \uD6C4\uC18D \uB3C4\uC7A5\uCE35 \uC811\uCC29 \uC0C1\uD0DC\uB97C \uD655\uC778\uD574\uC57C \uD569\uB2C8\uB2E4.";
  if (/(?:\uD37C\uD2F0|\uD06C\uB799|\uADE0\uC5F4)/i.test(workItem)) return "\uBCF4\uC218 \uBD80\uC704 \uACBD\uD654 \uC0C1\uD0DC\uC640 \uC7AC\uADE0\uC5F4 \uC5EC\uBD80\uB97C \uD655\uC778\uD574\uC57C \uD569\uB2C8\uB2E4.";
  if (/(?:\uB77C\uC774\uB2DD|\uB3C4\uC7A5|\uCF54\uD305|\uC0C1\uB3C4|\uC911\uB3C4)/i.test(workItem)) return "\uB3C4\uB9C9 \uB450\uAED8, \uAE30\uD3EC, \uD540\uD640, \uB4E4\uB72C, \uBBF8\uB3C4\uD3EC \uAD6C\uAC04 \uC5EC\uBD80\uB97C \uD655\uC778\uD574\uC57C \uD569\uB2C8\uB2E4.";
  if (/(?:\uC5F0\uC0AD|\uBC14\uD0D5|\uBA74\uCC98\uB9AC|\uAC8C\uB9C1)/i.test(workItem)) return "\uBD84\uC9C4 \uC81C\uAC70, \uD45C\uBA74 \uC774\uBB3C\uC9C8 \uC81C\uAC70, \uC811\uCC29\uB825 \uD655\uBCF4 \uC0C1\uD0DC\uB97C \uD655\uC778\uD574\uC57C \uD569\uB2C8\uB2E4.";
  return "\uD604\uC7A5 \uC870\uAC74\uACFC \uC0AC\uC9C4 \uADFC\uAC70\uB97C \uD568\uAED8 \uAC80\uD1A0\uD574 \uD6C4\uC18D \uC791\uC5C5 \uAC00\uB2A5 \uC5EC\uBD80\uB97C \uD655\uC778\uD574\uC57C \uD569\uB2C8\uB2E4.";
}

function extractTaskName(value: string) {
  return value
    .replace(/\s*(?:\uC644\uB8CC|\uC9C4\uD589\s*\uC911|\uC791\uC5C5\s*\uC911|\uC2DC\uC791\s*\uC804)\s*$/g, "")
    .replace(/[.?]+$/g, "")
    .trim();
}

type WordTextOptions = {
  align?: "left" | "center";
  bold?: boolean;
  color?: string;
  fill?: string;
  gridSpan?: number;
  size?: number;
  spacingAfter?: number;
};

function buildWorkLogRows(content: ReportContent) {
  const photoOrder = new Map(content.comparison_photos.map((photo, index) => [photo.photo_id, index]));
  const rows = content.work_log?.length
    ? content.work_log
    : content.comparison_photos.map((photo) => ({
        photo_id: photo.photo_id,
        date: photo.work_date,
        work_item: fallbackWorkItem(photo),
        work_detail: fallbackWorkDetail(photo),
        note: fallbackWorkNote(photo)
      }));
  if (rows.length === 0) {
    return [{
      date: "-",
      item: "사진 데이터 없음",
      detail: content.analysis_result || "선택한 기간에 해당하는 사진이 없습니다.",
      note: content.memo ?? "기간, 방, 공종 조건을 확인하십시오."
    }];
  }

  return rows
    .filter((row) => row.date || row.work_item || row.work_detail || row.note)
    .sort((a, b) => {
      const firstOrder = photoOrder.get(a.photo_id) ?? Number.MAX_SAFE_INTEGER;
      const secondOrder = photoOrder.get(b.photo_id) ?? Number.MAX_SAFE_INTEGER;
      return firstOrder - secondOrder || a.date.localeCompare(b.date) || a.photo_id.localeCompare(b.photo_id);
    })
    .map((row) => ({
      date: formatKoreanDateWithWeekday(row.date),
      item: row.work_item || "현장 사진 기록",
      detail: row.work_detail || "사진 근거가 등록되었습니다.",
      note: row.note || "AI 분석 및 현장 검토 필요"
    }));
}
function datesInReportRange(value: string | null) {
  const first = firstDateFromRange(value);
  const last = lastDateFromRange(value);
  if (!first && !last) return null;
  const start = new Date(first ?? last ?? "");
  const end = new Date(last ?? first ?? "");
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  start.setUTCHours(0, 0, 0, 0);
  end.setUTCHours(0, 0, 0, 0);
  if (start.getTime() > end.getTime()) return null;
  const dates: string[] = [];
  for (let current = new Date(start); current.getTime() <= end.getTime(); current.setUTCDate(current.getUTCDate() + 1)) {
    dates.push(current.toISOString().slice(0, 10));
  }
  return dates;
}

function uniqueText(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => typeof value === "string" ? value.trim() : "").filter((value) => value.length > 0)));
}

function dominantReportTrade(content: ReportContent) {
  if (content.situation.trade) return content.situation.trade;
  const counts = new Map<string, number>();
  for (const photo of content.comparison_photos) {
    if (photo.trade) counts.set(photo.trade, (counts.get(photo.trade) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "\uC804\uCCB4 \uACF5\uC885";
}

function reportDocumentTitle(content: ReportContent) {
  const dateRange = content.situation.date_range ?? photoDateRange(content.comparison_photos);
  const firstDate = firstDateFromRange(dateRange);
  if (!firstDate) return content.title;
  const date = new Date(firstDate);
  if (Number.isNaN(date.getTime())) return content.title;
  const week = Math.max(1, Math.ceil(date.getDate() / 7));
  return `${date.getFullYear()}\uB144 ${date.getMonth() + 1}\uC6D4 ${week}\uC8FC\uCC28 \uC2DC\uACF5\uC77C\uC9C0`;
}

function reportLastDateText(content: ReportContent) {
  const dates = content.comparison_photos.map((photo) => photo.work_date).filter(Boolean).sort();
  return dates.length > 0 ? `${formatKoreanDateWithWeekday(dates[dates.length - 1])} \uAE30\uC900` : "\uC644\uB8CC\uC77C \uBBF8\uD655\uC815";
}

function formatReportDateRange(value: string) {
  const first = firstDateFromRange(value);
  const last = lastDateFromRange(value);
  if (!first && !last) return value;
  if (first && last && first !== last) {
    return `${formatKoreanDate(first)} ~ ${formatKoreanDate(last)} (\uCD1D ${inclusiveDayCount(first, last)}\uC77C)`;
  }
  return formatKoreanDate(first ?? last ?? value);
}

function firstDateFromRange(value: string | null) {
  return value?.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
}

function lastDateFromRange(value: string | null) {
  const matches = value?.match(/\d{4}-\d{2}-\d{2}/g) ?? [];
  return matches[matches.length - 1] ?? null;
}

function inclusiveDayCount(from: string, to: string) {
  const fromDate = new Date(from);
  const toDate = new Date(to);
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) return 1;
  return Math.max(1, Math.round((toDate.getTime() - fromDate.getTime()) / 86400000) + 1);
}

function formatKoreanDateWithWeekday(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const weekdays = ["\uC77C", "\uC6D4", "\uD654", "\uC218", "\uBAA9", "\uAE08", "\uD1A0"];
  return `${date.getFullYear()}\uB144 ${date.getMonth() + 1}\uC6D4 ${date.getDate()}\uC77C (${weekdays[date.getDay()]})`;
}

function wordTable(rows: string[][], options: { width: number; nested?: boolean; columnWidths?: number[] }) {
  const borders = options.nested
    ? '<w:tblBorders><w:top w:val="single" w:sz="4" w:color="D8E0EA"/><w:left w:val="single" w:sz="4" w:color="D8E0EA"/><w:bottom w:val="single" w:sz="4" w:color="D8E0EA"/><w:right w:val="single" w:sz="4" w:color="D8E0EA"/><w:insideH w:val="single" w:sz="4" w:color="D8E0EA"/><w:insideV w:val="single" w:sz="4" w:color="D8E0EA"/></w:tblBorders>'
    : '<w:tblBorders><w:top w:val="single" w:sz="6" w:color="CBD5E1"/><w:left w:val="single" w:sz="6" w:color="CBD5E1"/><w:bottom w:val="single" w:sz="6" w:color="CBD5E1"/><w:right w:val="single" w:sz="6" w:color="CBD5E1"/><w:insideH w:val="single" w:sz="4" w:color="CBD5E1"/><w:insideV w:val="single" w:sz="4" w:color="CBD5E1"/></w:tblBorders>';
  const grid = `<w:tblGrid>${tableColumnWidths(rows, options).map((width) => `<w:gridCol w:w="${width}"/>`).join("")}</w:tblGrid>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="${options.width}" w:type="dxa"/><w:tblLayout w:type="fixed"/>${borders}<w:tblCellMar><w:top w:w="120" w:type="dxa"/><w:left w:w="120" w:type="dxa"/><w:bottom w:w="120" w:type="dxa"/><w:right w:w="120" w:type="dxa"/></w:tblCellMar></w:tblPr>${grid}${rows.map((row) => `<w:tr>${row.join("")}</w:tr>`).join("")}</w:tbl>`;
}

function tableColumnWidths(rows: string[][], options: { width: number; columnWidths?: number[] }) {
  if (options.columnWidths?.length) return options.columnWidths;
  const columnCount = Math.max(1, ...rows.map((row) => row.length));
  const baseWidth = Math.floor(options.width / columnCount);
  return Array.from({ length: columnCount }, (_value, index) => index === columnCount - 1
    ? options.width - baseWidth * (columnCount - 1)
    : baseWidth);
}

function wordTextCell(text: string, width: number, options: WordTextOptions = {}) {
  const paragraphs = String(text || " ").split("\n").map((line) => wordParagraph(line, options)).join("");
  return wordRawCell(paragraphs, width, options);
}

function wordRawCell(raw: string, width: number, options: WordTextOptions = {}) {
  const fill = options.fill ? `<w:shd w:fill="${options.fill}"/>` : "";
  const gridSpan = options.gridSpan ? `<w:gridSpan w:val="${options.gridSpan}"/>` : "";
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${gridSpan}${fill}<w:vAlign w:val="center"/></w:tcPr>${raw}</w:tc>`;
}

function wordParagraph(text: string, options: WordTextOptions = {}) {
  const align = options.align === "center" ? '<w:jc w:val="center"/>' : "";
  const spacing = `<w:spacing w:after="${options.spacingAfter ?? 80}" w:line="260" w:lineRule="auto"/>`;
  const bold = options.bold ? "<w:b/>" : "";
  const color = options.color ? `<w:color w:val="${options.color}"/>` : "";
  const size = `<w:sz w:val="${options.size ?? 20}"/>`;
  return `<w:p><w:pPr>${align}${spacing}</w:pPr><w:r><w:rPr>${wordRunFonts()}${bold}${color}${size}</w:rPr><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
}

function ensureWordDocumentFonts(xml: string) {
  return xml.replace(/<w:rPr\b([^>]*)>([\s\S]*?)<\/w:rPr>/g, (match, attributes: string, body: string) => {
    if (body.includes("<w:rFonts")) return match;
    return `<w:rPr${attributes}>${wordRunFonts()}${body}</w:rPr>`;
  });
}

function ensureWordStylesFont(xml: string) {
  let current = ensureWordDocumentFonts(xml);
  if (!current.includes("<w:docDefaults>")) {
    current = current.replace("<w:styles", `<w:styles`).replace(
      /(<w:styles\b[^>]*>)/,
      `$1<w:docDefaults><w:rPrDefault><w:rPr>${wordRunFonts()}<w:sz w:val="20"/></w:rPr></w:rPrDefault></w:docDefaults>`
    );
  }
  return current;
}

function wordImageParagraph(relId: string, name: string, cx: number, cy: number) {
  return `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="80"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${xmlEscape(relId.replace(/\D/g, "") || "1")}" name="${xmlEscape(name)}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="${xmlEscape(name)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

function wordDocumentRelsXml(images: ReportImage[]) {
  const relationships = images.slice(0, 6).map((image, index) => {
    return `<Relationship Id="rIdPhoto${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/report-photo-${index + 1}.${image.extension}"/>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}</Relationships>`;
}

function ensureWordImageContentTypes(xml: string, images: ReportImage[]) {
  let current = xml;
  if (images.some((image) => image.extension === "jpg") && !current.includes('Extension="jpg"')) {
    current = current.replace("</Types>", '<Default Extension="jpg" ContentType="image/jpeg"/></Types>');
  }
  if (images.some((image) => image.extension === "png") && !current.includes('Extension="png"')) {
    current = current.replace("</Types>", '<Default Extension="png" ContentType="image/png"/></Types>');
  }
  return current;
}

function readWordTemplateEntries() {
  return unzipEntries(readFileSync(wordReportTemplatePath()));
}

function wordReportTemplatePath() {
  const candidates = [
    join(process.cwd(), "apps", "api", "templates", "report-template.docx"),
    join(process.cwd(), "templates", "report-template.docx"),
    join(__dirname, "..", "..", "templates", "report-template.docx")
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error("Report template not found. Expected apps/api/templates/report-template.docx.");
  }
  return found;
}

function renderXlsx(content: ReportContent, images: ReportImage[] = []) {
  const entries = readReportTemplateEntries();
  const stylesEntry = entries.find((entry) => entry.path === "xl/styles.xml");
  const wrapStyles = stylesEntry ? buildWrapStyleOverrides(stylesEntry.content.toString("utf8"), [46, 68, 71]) : { xml: null, styleByBaseId: {} };
  const patches = buildTemplateCellPatches(content, wrapStyles.styleByBaseId);
  const patchBySheet = new Map(patches.map((patch) => [patch.sheetPath, patch]));
  const anchors = buildReportImageAnchors(content, images);
  const imageSheets = buildReportImageSheets(anchors);
  const drawingBySheet = new Map(imageSheets.map((sheet) => [sheet.sheetPath, sheet]));
  const imageEntries = anchors.map((anchor, index) => ({
    path: `xl/media/report-photo-${index + 1}.${anchor.image.extension}`,
    content: anchor.image.buffer
  }));
  const generatedEntries = [
    ...imageSheets.map((sheet) => ({
      path: sheet.drawingPath,
      content: textBuffer(drawingXml(sheet))
    })),
    ...imageSheets.map((sheet) => ({
      path: sheet.relPath,
      content: textBuffer(drawingRelationshipXml(sheet, anchors))
    }))
  ];
  const patchedEntries = entries.map((entry) => {
    if (entry.path === "xl/styles.xml" && wrapStyles.xml) {
      return { path: entry.path, content: textBuffer(wrapStyles.xml) };
    }

    const patch = patchBySheet.get(entry.path);
    const drawing = drawingBySheet.get(entry.path);
    if (!patch && !drawing) return entry;
    const patchedXml = patch ? patchWorksheetXml(entry.content.toString("utf8"), patch) : entry.content.toString("utf8");
    const xml = enhanceReportWorksheetLayout(entry.path, patchedXml);
    return {
      path: entry.path,
      content: textBuffer(drawing ? ensureWorksheetDrawing(xml, "rId2") : xml)
    };
  });
  const withSheetRels = upsertEntries(patchedEntries, buildWorksheetRelationshipEntries(patchedEntries, imageSheets));
  const withContentTypes = withSheetRels.map((entry) => entry.path === "[Content_Types].xml"
    ? { ...entry, content: textBuffer(ensureReportImageContentTypes(entry.content.toString("utf8"), imageSheets, anchors)) }
    : entry);
  return zipStore(upsertEntries(withContentTypes, [...imageEntries, ...generatedEntries]));
}

function readReportTemplateEntries() {
  const templatePath = reportTemplatePath();
  return unzipEntries(readFileSync(templatePath));
}

function reportTemplatePath() {
  const candidates = [
    join(process.cwd(), "apps", "api", "templates", "report-template.xlsx"),
    join(process.cwd(), "templates", "report-template.xlsx"),
    join(__dirname, "..", "..", "templates", "report-template.xlsx")
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error("Report template not found. Expected apps/api/templates/report-template.xlsx.");
  }
  return found;
}

function buildReportImageAnchors(content: ReportContent, images: ReportImage[]): ReportImageAnchor[] {
  const imageByPhotoId = new Map(images.map((image) => [image.photoId, image]));
  const slots = [
    { sheetPath: "xl/worksheets/sheet4.xml", drawingPath: "xl/drawings/report-photo-sheet4.xml", relPath: "xl/drawings/_rels/report-photo-sheet4.xml.rels", sheetRelPath: "xl/worksheets/_rels/sheet4.xml.rels", fromCol: 2, fromRow: 3, toCol: 7, toRow: 10 },
    { sheetPath: "xl/worksheets/sheet4.xml", drawingPath: "xl/drawings/report-photo-sheet4b.xml", relPath: "xl/drawings/_rels/report-photo-sheet4b.xml.rels", sheetRelPath: "xl/worksheets/_rels/sheet4.xml.rels", fromCol: 9, fromRow: 3, toCol: 14, toRow: 10 },
    { sheetPath: "xl/worksheets/sheet4.xml", drawingPath: "xl/drawings/report-photo-sheet4c.xml", relPath: "xl/drawings/_rels/report-photo-sheet4c.xml.rels", sheetRelPath: "xl/worksheets/_rels/sheet4.xml.rels", fromCol: 2, fromRow: 12, toCol: 7, toRow: 19 },
    { sheetPath: "xl/worksheets/sheet4.xml", drawingPath: "xl/drawings/report-photo-sheet4d.xml", relPath: "xl/drawings/_rels/report-photo-sheet4d.xml.rels", sheetRelPath: "xl/worksheets/_rels/sheet4.xml.rels", fromCol: 9, fromRow: 12, toCol: 14, toRow: 19 },
    { sheetPath: "xl/worksheets/sheet4.xml", drawingPath: "xl/drawings/report-photo-sheet4e.xml", relPath: "xl/drawings/_rels/report-photo-sheet4e.xml.rels", sheetRelPath: "xl/worksheets/_rels/sheet4.xml.rels", fromCol: 2, fromRow: 21, toCol: 7, toRow: 28 },
    { sheetPath: "xl/worksheets/sheet4.xml", drawingPath: "xl/drawings/report-photo-sheet4f.xml", relPath: "xl/drawings/_rels/report-photo-sheet4f.xml.rels", sheetRelPath: "xl/worksheets/_rels/sheet4.xml.rels", fromCol: 9, fromRow: 21, toCol: 14, toRow: 28 },
    { sheetPath: "xl/worksheets/sheet5.xml", drawingPath: "xl/drawings/report-photo-sheet5.xml", relPath: "xl/drawings/_rels/report-photo-sheet5.xml.rels", sheetRelPath: "xl/worksheets/_rels/sheet5.xml.rels", fromCol: 2, fromRow: 3, toCol: 7, toRow: 10 },
    { sheetPath: "xl/worksheets/sheet5.xml", drawingPath: "xl/drawings/report-photo-sheet5b.xml", relPath: "xl/drawings/_rels/report-photo-sheet5b.xml.rels", sheetRelPath: "xl/worksheets/_rels/sheet5.xml.rels", fromCol: 9, fromRow: 3, toCol: 14, toRow: 10 },
    { sheetPath: "xl/worksheets/sheet5.xml", drawingPath: "xl/drawings/report-photo-sheet5c.xml", relPath: "xl/drawings/_rels/report-photo-sheet5c.xml.rels", sheetRelPath: "xl/worksheets/_rels/sheet5.xml.rels", fromCol: 2, fromRow: 12, toCol: 7, toRow: 19 },
    { sheetPath: "xl/worksheets/sheet5.xml", drawingPath: "xl/drawings/report-photo-sheet5d.xml", relPath: "xl/drawings/_rels/report-photo-sheet5d.xml.rels", sheetRelPath: "xl/worksheets/_rels/sheet5.xml.rels", fromCol: 9, fromRow: 12, toCol: 14, toRow: 19 },
    { sheetPath: "xl/worksheets/sheet5.xml", drawingPath: "xl/drawings/report-photo-sheet5e.xml", relPath: "xl/drawings/_rels/report-photo-sheet5e.xml.rels", sheetRelPath: "xl/worksheets/_rels/sheet5.xml.rels", fromCol: 2, fromRow: 21, toCol: 7, toRow: 28 },
    { sheetPath: "xl/worksheets/sheet5.xml", drawingPath: "xl/drawings/report-photo-sheet5f.xml", relPath: "xl/drawings/_rels/report-photo-sheet5f.xml.rels", sheetRelPath: "xl/worksheets/_rels/sheet5.xml.rels", fromCol: 9, fromRow: 21, toCol: 14, toRow: 28 },
    { sheetPath: "xl/worksheets/sheet6.xml", drawingPath: "xl/drawings/report-photo-sheet6.xml", relPath: "xl/drawings/_rels/report-photo-sheet6.xml.rels", sheetRelPath: "xl/worksheets/_rels/sheet6.xml.rels", fromCol: 2, fromRow: 3, toCol: 7, toRow: 10 },
    { sheetPath: "xl/worksheets/sheet6.xml", drawingPath: "xl/drawings/report-photo-sheet6b.xml", relPath: "xl/drawings/_rels/report-photo-sheet6b.xml.rels", sheetRelPath: "xl/worksheets/_rels/sheet6.xml.rels", fromCol: 9, fromRow: 3, toCol: 14, toRow: 10 },
    { sheetPath: "xl/worksheets/sheet6.xml", drawingPath: "xl/drawings/report-photo-sheet6c.xml", relPath: "xl/drawings/_rels/report-photo-sheet6c.xml.rels", sheetRelPath: "xl/worksheets/_rels/sheet6.xml.rels", fromCol: 2, fromRow: 12, toCol: 7, toRow: 19 },
    { sheetPath: "xl/worksheets/sheet6.xml", drawingPath: "xl/drawings/report-photo-sheet6d.xml", relPath: "xl/drawings/_rels/report-photo-sheet6d.xml.rels", sheetRelPath: "xl/worksheets/_rels/sheet6.xml.rels", fromCol: 9, fromRow: 12, toCol: 14, toRow: 19 },
    { sheetPath: "xl/worksheets/sheet6.xml", drawingPath: "xl/drawings/report-photo-sheet6e.xml", relPath: "xl/drawings/_rels/report-photo-sheet6e.xml.rels", sheetRelPath: "xl/worksheets/_rels/sheet6.xml.rels", fromCol: 2, fromRow: 21, toCol: 7, toRow: 28 },
    { sheetPath: "xl/worksheets/sheet6.xml", drawingPath: "xl/drawings/report-photo-sheet6f.xml", relPath: "xl/drawings/_rels/report-photo-sheet6f.xml.rels", sheetRelPath: "xl/worksheets/_rels/sheet6.xml.rels", fromCol: 9, fromRow: 21, toCol: 14, toRow: 28 },
    { sheetPath: "xl/worksheets/sheet7.xml", drawingPath: "xl/drawings/report-photo-overview.xml", relPath: "xl/drawings/_rels/report-photo-overview.xml.rels", sheetRelPath: "xl/worksheets/_rels/sheet7.xml.rels", fromCol: 0, fromRow: 2, toCol: 7, toRow: 10 },
    { sheetPath: "xl/worksheets/sheet7.xml", drawingPath: "xl/drawings/report-photo-overviewb.xml", relPath: "xl/drawings/_rels/report-photo-overviewb.xml.rels", sheetRelPath: "xl/worksheets/_rels/sheet7.xml.rels", fromCol: 7, fromRow: 2, toCol: 14, toRow: 10 },
    { sheetPath: "xl/worksheets/sheet7.xml", drawingPath: "xl/drawings/report-photo-overviewc.xml", relPath: "xl/drawings/_rels/report-photo-overviewc.xml.rels", sheetRelPath: "xl/worksheets/_rels/sheet7.xml.rels", fromCol: 0, fromRow: 10, toCol: 7, toRow: 18 },
    { sheetPath: "xl/worksheets/sheet7.xml", drawingPath: "xl/drawings/report-photo-overviewd.xml", relPath: "xl/drawings/_rels/report-photo-overviewd.xml.rels", sheetRelPath: "xl/worksheets/_rels/sheet7.xml.rels", fromCol: 7, fromRow: 10, toCol: 14, toRow: 18 }
  ];

  return content.comparison_photos
    .map((photo, index) => {
      const slot = slots[index];
      const image = imageByPhotoId.get(photo.photo_id);
      if (!slot || !image) return null;
      return {
        sheetPath: slot.sheetPath,
        image,
        fromCol: slot.fromCol,
        fromRow: slot.fromRow,
        toCol: slot.toCol,
        toRow: slot.toRow
      };
    })
    .filter((anchor): anchor is ReportImageAnchor => anchor !== null);
}

function buildReportImageSheets(anchors: ReportImageAnchor[]): ReportImageSheet[] {
  const sheetDefinitions = [
    {
      sheetPath: "xl/worksheets/sheet4.xml",
      drawingPath: "xl/drawings/report-photos-sheet4.xml",
      relPath: "xl/drawings/_rels/report-photos-sheet4.xml.rels",
      sheetRelPath: "xl/worksheets/_rels/sheet4.xml.rels"
    },
    {
      sheetPath: "xl/worksheets/sheet5.xml",
      drawingPath: "xl/drawings/report-photos-sheet5.xml",
      relPath: "xl/drawings/_rels/report-photos-sheet5.xml.rels",
      sheetRelPath: "xl/worksheets/_rels/sheet5.xml.rels"
    },
    {
      sheetPath: "xl/worksheets/sheet6.xml",
      drawingPath: "xl/drawings/report-photos-sheet6.xml",
      relPath: "xl/drawings/_rels/report-photos-sheet6.xml.rels",
      sheetRelPath: "xl/worksheets/_rels/sheet6.xml.rels"
    },
    {
      sheetPath: "xl/worksheets/sheet7.xml",
      drawingPath: "xl/drawings/report-photos-overview.xml",
      relPath: "xl/drawings/_rels/report-photos-overview.xml.rels",
      sheetRelPath: "xl/worksheets/_rels/sheet7.xml.rels"
    }
  ];

  return sheetDefinitions
    .map((definition) => ({
      ...definition,
      anchors: anchors.filter((anchor) => anchor.sheetPath === definition.sheetPath)
    }))
    .filter((sheet) => sheet.anchors.length > 0);
}

function buildWorksheetRelationshipEntries(entries: ZipEntry[], imageSheets: ReportImageSheet[]): ZipEntry[] {
  return imageSheets.map((sheet) => {
    const existing = entries.find((entry) => entry.path === sheet.sheetRelPath)?.content.toString("utf8");
    const target = "../drawings/" + sheet.drawingPath.split("/").pop();
    return {
      path: sheet.sheetRelPath,
      content: textBuffer(ensureRelationshipXml(existing, "rId2", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing", target))
    };
  });
}

function drawingXml(sheet: ReportImageSheet) {
  const anchors = sheet.anchors.map((anchor, index) => {
    const relId = `rId${index + 1}`;
    const picId = index + 2;
    return `<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>${anchor.fromCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${anchor.fromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${anchor.toCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${anchor.toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="${picId}" name="Report Photo ${picId}"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:twoCellAnchor>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${anchors}</xdr:wsDr>`;
}

function drawingRelationshipXml(sheet: ReportImageSheet, allAnchors: ReportImageAnchor[]) {
  const relationships = sheet.anchors.map((anchor, index) => {
    const imageIndex = allAnchors.indexOf(anchor) + 1;
    return `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/report-photo-${imageIndex}.${anchor.image.extension}"/>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}</Relationships>`;
}

function ensureWorksheetDrawing(xml: string, relId: string) {
  if (xml.includes("<drawing ")) return xml;
  return xml.replace("</worksheet>", `<drawing r:id="${relId}"/></worksheet>`);
}

function ensureRelationshipXml(existing: string | undefined, id: string, type: string, target: string) {
  const relationship = `<Relationship Id="${id}" Type="${type}" Target="${target}"/>`;
  if (!existing || existing.trim().length === 0) {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationship}</Relationships>`;
  }
  if (existing.includes(`Target="${target}"`)) return existing;
  const withoutConflict = existing.replace(new RegExp(`<Relationship\\b(?=[^>]*\\bId="${id}")[^>]*/>`), "");
  return withoutConflict.replace("</Relationships>", `${relationship}</Relationships>`);
}

function ensureReportImageContentTypes(xml: string, imageSheets: ReportImageSheet[], anchors: ReportImageAnchor[]) {
  let current = xml;
  if (anchors.some((anchor) => anchor.image.extension === "jpg") && !current.includes('Extension="jpg"')) {
    current = current.replace("</Types>", '<Default Extension="jpg" ContentType="image/jpeg"/></Types>');
  }
  if (anchors.some((anchor) => anchor.image.extension === "png") && !current.includes('Extension="png"')) {
    current = current.replace("</Types>", '<Default Extension="png" ContentType="image/png"/></Types>');
  }
  for (const sheet of imageSheets) {
    const partName = `/${sheet.drawingPath}`;
    if (!current.includes(`PartName="${partName}"`)) {
      current = current.replace("</Types>", `<Override PartName="${partName}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`);
    }
  }
  return current;
}

function upsertEntries(entries: ZipEntry[], replacements: ZipEntry[]) {
  const replacementByPath = new Map(replacements.map((entry) => [entry.path, entry]));
  const next = entries.map((entry) => replacementByPath.get(entry.path) ?? entry);
  const existingPaths = new Set(next.map((entry) => entry.path));
  for (const replacement of replacements) {
    if (!existingPaths.has(replacement.path)) next.push(replacement);
  }
  return next;
}

function imageExtension(mimeType: string | null) {
  const normalized = mimeType?.toLowerCase() ?? "";
  if (normalized.includes("png")) return "png";
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return "jpg";
  return null;
}

function buildWrapStyleOverrides(stylesXml: string, baseStyleIds: number[]) {
  const cellXfsMatch = stylesXml.match(/<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/);
  if (!cellXfsMatch) {
    return { xml: null, styleByBaseId: {} as Record<number, number> };
  }

  const xfEntries = cellXfsMatch[2].match(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g);
  if (!xfEntries) {
    return { xml: null, styleByBaseId: {} as Record<number, number> };
  }

  const nextEntries = [...xfEntries];
  const styleByBaseId: Record<number, number> = {};

  for (const baseStyleId of baseStyleIds) {
    const xf = xfEntries[baseStyleId];
    if (!xf || styleByBaseId[baseStyleId]) continue;

    let wrapped = xf.replace(/\bshrinkToFit="1"/g, "").replace(/\s{2,}/g, " ");
    if (wrapped.includes("<alignment")) {
      wrapped = wrapped.replace(/<alignment\b([^>]*)\/>/, (_match, attrs: string) => {
        return `<alignment${ensureWrapTextAttribute(attrs)} />`;
      });
      wrapped = wrapped.replace(/<alignment\b([^>]*)>([\s\S]*?)<\/alignment>/, (_match, attrs: string, inner: string) => {
        return `<alignment${ensureWrapTextAttribute(attrs)}>${inner}</alignment>`;
      });
    } else {
      wrapped = wrapped.replace(/<xf\b([^>]*)>/, `<xf$1><alignment wrapText="1" vertical="center"/></xf>`);
      if (wrapped === xf) {
        wrapped = wrapped.replace(/\/>$/, ` applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>`);
      }
    }
    if (!wrapped.includes('applyAlignment="1"')) {
      wrapped = wrapped.replace("<xf ", '<xf applyAlignment="1" ');
    }

    styleByBaseId[baseStyleId] = nextEntries.length;
    nextEntries.push(wrapped);
  }

  const replacement = `<cellXfs count="${nextEntries.length}">${nextEntries.join("")}</cellXfs>`;
  return {
    xml: stylesXml.replace(cellXfsMatch[0], replacement),
    styleByBaseId
  };
}

function ensureWrapTextAttribute(attributes: string) {
  const withoutWrap = attributes.replace(/\bwrapText="[^"]*"/g, "").replace(/\bshrinkToFit="[^"]*"/g, "");
  return `${withoutWrap} wrapText="1"`;
}

function unzipEntries(buffer: Buffer): ZipEntry[] {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries: ZipEntry[] = [];

  for (let index = 0; index < entryCount; index++) {
    if (buffer.readUInt32LE(centralOffset) !== 0x02014b50) {
      throw new Error("Invalid XLSX central directory.");
    }
    const method = buffer.readUInt16LE(centralOffset + 10);
    const compressedSize = buffer.readUInt32LE(centralOffset + 20);
    const nameLength = buffer.readUInt16LE(centralOffset + 28);
    const extraLength = buffer.readUInt16LE(centralOffset + 30);
    const commentLength = buffer.readUInt16LE(centralOffset + 32);
    const localOffset = buffer.readUInt32LE(centralOffset + 42);
    const entryPath = buffer.subarray(centralOffset + 46, centralOffset + 46 + nameLength).toString("utf8");
    const contentStart = localFileContentStart(buffer, localOffset);
    const compressed = buffer.subarray(contentStart, contentStart + compressedSize);
    const content = method === 0 ? Buffer.from(compressed) : method === 8 ? inflateRawSync(compressed) : null;
    if (!content) throw new Error(`Unsupported XLSX compression method: ${method}`);
    entries.push({ path: entryPath, content });
    centralOffset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function findEndOfCentralDirectory(buffer: Buffer) {
  for (let offset = buffer.length - 22; offset >= 0; offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error("Invalid XLSX file: end of central directory not found.");
}

function localFileContentStart(buffer: Buffer, localOffset: number) {
  if (buffer.readUInt32LE(localOffset) !== 0x04034b50) {
    throw new Error("Invalid XLSX local file header.");
  }
  const nameLength = buffer.readUInt16LE(localOffset + 26);
  const extraLength = buffer.readUInt16LE(localOffset + 28);
  return localOffset + 30 + nameLength + extraLength;
}

function buildTemplateCellPatches(content: ReportContent, wrapStyleByBaseId: Record<number, number>): TemplateCellPatch[] {
  const generatedDate = formatKoreanDate(content.generated_at);
  const dateRange = content.situation.date_range ?? photoDateRange(content.comparison_photos) ?? generatedDate;
  const siteName = content.situation.room ?? "현장 전체";
  const companyName = "BIM Photo Sync";
  const location = content.situation.room ?? "현장 전체";
  const trade = content.situation.trade ?? "전체 공종";
  const workSummary = content.progress_timeline.slice(0, 6).join("\n") || "등록된 작업 사진 기준의 작업내용이 없습니다.";
  const overallSummary = content.comparison_photos.length > 0
    ? `${content.comparison_photos.length}장의 사진 근거를 기준으로 방(실) → 공사면 → 일자 → 공종 순서로 분석했습니다.`
    : "선택한 조건에 해당하는 사진 데이터가 없습니다.";
  const followUp = "완료/진행 중/시작 전 상태와 누락 사진을 다음 점검 시 재확인합니다.";

  return [
    {
      sheetPath: "xl/worksheets/sheet1.xml",
      cells: {
        A16: `■ ${content.title}`,
        A20: dateRange,
        C28: companyName
      },
      styleOverrides: {
        C4: wrapStyleByBaseId[46],
        C9: wrapStyleByBaseId[46],
        C14: wrapStyleByBaseId[46],
        C19: wrapStyleByBaseId[46],
        C24: wrapStyleByBaseId[46]
      }
    },
    {
      sheetPath: "xl/worksheets/sheet2.xml",
      cells: {
        A17: content.title,
        A29: dateRange,
        A36: companyName
      },
      styleOverrides: {
        A3: wrapStyleByBaseId[71],
        H3: wrapStyleByBaseId[71],
        A11: wrapStyleByBaseId[71],
        H11: wrapStyleByBaseId[71]
      }
    },
    {
      sheetPath: "xl/worksheets/sheet3.xml",
      cells: {
        A2: `■ 공사명  : ${content.title}`,
        A3: `날짜 : ${dateRange}`,
        C3: `위치 : ${location}`,
        E3: `작성자 : ${content.generated_by}`,
        G3: `공정명 : ${trade}`,
        I3: `현장소장 : ${content.generated_by}   (인)`,
        C4: workSummary,
        C9: content.analysis_result,
        C14: content.memo ?? "추가 조치 내용은 현장 관리자 검토 후 입력합니다.",
        C19: overallSummary,
        C24: followUp
      }
    },
    buildPhotoTemplatePatch("xl/worksheets/sheet4.xml", content, 0, siteName, wrapStyleByBaseId[68]),
    buildPhotoTemplatePatch("xl/worksheets/sheet5.xml", content, 6, siteName, wrapStyleByBaseId[68]),
    buildPhotoTemplatePatch("xl/worksheets/sheet6.xml", content, 12, siteName, wrapStyleByBaseId[68]),
    {
      sheetPath: "xl/worksheets/sheet7.xml",
      cells: {
        A2: `현장명: ${siteName}`,
        L2: `일자 : ${generatedDate}`,
        A3: content.comparison_photos[0] ? photoEvidenceText(content.comparison_photos[0]) : "등록된 전경 사진이 없습니다.",
        H3: content.comparison_photos[1] ? photoEvidenceText(content.comparison_photos[1]) : "추가 전경 사진이 없습니다.",
        A11: content.comparison_photos[2] ? photoEvidenceText(content.comparison_photos[2]) : "",
        H11: content.comparison_photos[3] ? photoEvidenceText(content.comparison_photos[3]) : ""
      }
    }
  ];
}

function buildPhotoTemplatePatch(sheetPath: string, content: ReportContent, startIndex: number, siteName: string, wrapStyleId: number | undefined): TemplateCellPatch {
  const slots = ["C11", "J11", "C20", "J20", "C29", "J29"];
  const cells: Record<string, string> = { A2: `현장명: ${siteName}` };
  slots.forEach((cell, index) => {
    const photo = content.comparison_photos[startIndex + index];
    cells[cell] = photo ? photoEvidenceText(photo) : index === 0 && startIndex === 0 ? "선택한 조건에 해당하는 사진 데이터가 없습니다." : "";
  });
  return {
    sheetPath,
    cells,
    styleOverrides: Object.fromEntries(slots.map((cell) => [cell, wrapStyleId]).filter((entry): entry is [string, number] => typeof entry[1] === "number"))
  };
}

function patchWorksheetXml(xml: string, patch: TemplateCellPatch) {
  return Object.entries(patch.cells).reduce((current, [cellRef, value]) => {
    return setInlineStringCell(current, cellRef, value, patch.styleOverrides?.[cellRef]);
  }, xml);
}

function enhanceReportWorksheetLayout(sheetPath: string, xml: string) {
  if (!["xl/worksheets/sheet3.xml", "xl/worksheets/sheet4.xml", "xl/worksheets/sheet5.xml", "xl/worksheets/sheet6.xml", "xl/worksheets/sheet7.xml"].includes(sheetPath)) {
    return xml;
  }
  const tallRowsBySheet: Record<string, Record<number, number>> = {
    "xl/worksheets/sheet3.xml": { 4: 90, 9: 110, 14: 90, 19: 90, 24: 70 },
    "xl/worksheets/sheet4.xml": { 11: 108, 20: 108, 29: 108 },
    "xl/worksheets/sheet5.xml": { 11: 108, 20: 108, 29: 108 },
    "xl/worksheets/sheet6.xml": { 11: 108, 20: 108, 29: 108 },
    "xl/worksheets/sheet7.xml": { 3: 130, 11: 130 }
  };
  return Object.entries(tallRowsBySheet[sheetPath] ?? {}).reduce((current, [row, height]) => setRowHeight(current, Number(row), height), xml);
}

function setRowHeight(xml: string, rowNumber: number, height: number) {
  const rowPattern = new RegExp(`<row\\b(?=[^>]*\\br="${rowNumber}")[^>]*>`);
  if (rowPattern.test(xml)) {
    return xml.replace(rowPattern, (rowTag) => {
      let next = rowTag.replace(/\sht="[^"]*"/, "").replace(/\scustomHeight="[^"]*"/, "");
      next = next.replace(/>$/, ` ht="${height}" customHeight="1">`);
      return next;
    });
  }
  return xml.replace("</sheetData>", `<row r="${rowNumber}" ht="${height}" customHeight="1"></row></sheetData>`);
}

function setInlineStringCell(xml: string, cellRef: string, value: string, styleOverride?: number) {
  const selfClosingCellPattern = new RegExp(`<c\\b(?=[^>]*\\br="${cellRef}")[^>]*/>`);
  const cellPattern = new RegExp(`<c\\b(?=[^>]*\\br="${cellRef}")[^>]*>(?:[\\s\\S]*?)<\\/c>`);
  const existing = selfClosingCellPattern.exec(xml) ?? cellPattern.exec(xml);
  const styleValue = typeof styleOverride === "number"
    ? `s="${styleOverride}"`
    : existing?.[0].match(/\bs="([^"]+)"/)?.[0] ?? "";
  const style = styleValue ? ` ${styleValue}` : "";
  const cellXml = `<c r="${cellRef}"${style} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
  if (existing) return xml.replace(existing[0], cellXml);

  const rowNumber = Number(cellRef.match(/\d+/)?.[0] ?? 1);
  const rowPattern = new RegExp(`(<row\\b(?=[^>]*\\br="${rowNumber}")[^>]*>)([\\s\\S]*?)(<\\/row>)`);
  if (rowPattern.test(xml)) return xml.replace(rowPattern, `$1$2${cellXml}$3`);

  return xml.replace("</sheetData>", `<row r="${rowNumber}">${cellXml}</row></sheetData>`);
}

function buildReportTemplateSheets(content: ReportContent): SheetDefinition[] {
  const generatedDate = formatKoreanDate(content.generated_at);
  const dateRange = content.situation.date_range ?? photoDateRange(content.comparison_photos) ?? generatedDate;
  const siteName = content.situation.room ?? "현장 전체";
  const companyName = "BIM Photo Sync";
  const photoSheets = [0, 1, 2].map((sheetIndex) => buildPhotoSheet(content, sheetIndex));

  return [
    {
      name: "표지(감리단)",
      rows: withCells(blankRows(29, 13), [
        [4, 1, "주간공정계획 및 실적보고"],
        [16, 1, `■ ${content.title}`],
        [20, 1, dateRange],
        [28, 3, companyName]
      ]),
      merges: ["A4:M7", "A16:M17", "A20:M20", "A22:M22", "C28:G29"],
      columnWidths: Array(13).fill(12)
    },
    {
      name: "표지",
      rows: withCells(blankRows(39, 13), [
        [4, 1, "주간공정계획 및 실적보고"],
        [17, 1, content.title],
        [29, 1, dateRange],
        [36, 1, companyName]
      ]),
      merges: ["A4:H7", "A17:H18", "A29:H29", "A36:H36"],
      columnWidths: Array(13).fill(12)
    },
    {
      name: "주간공정보고(xx월 x주)",
      rows: withCells(blankRows(43, 21), [
        [1, 1, "주 간 공 정 회 의 자 료"],
        [2, 1, `■ 공사명  : ${content.title}`],
        [3, 1, "날짜"],
        [3, 3, "위치"],
        [3, 5, "작성자"],
        [3, 7, "공정명"],
        [3, 9, `생성자 : ${content.generated_by}`],
        [4, 1, "작업내용"],
        [4, 3, content.progress_timeline.slice(0, 6).join("\n") || "등록된 작업 사진 기준의 작업내용이 없습니다."],
        [9, 1, "특기사항 및 문제점"],
        [9, 3, content.analysis_result],
        [14, 1, "조치 내용"],
        [14, 3, content.memo ?? "추가 조치 내용은 현장 관리자 검토 후 입력합니다."],
        [19, 1, "종합판단"],
        [19, 3, content.comparison_photos.length > 0 ? `${content.comparison_photos.length}장의 사진 근거를 기준으로 방(실) → 공사면 → 일자 → 공종 순서로 분석했습니다.` : "선택한 조건에 해당하는 사진 데이터가 없습니다."],
        [24, 1, "후속관리사항"],
        [24, 3, "완료/진행중/시작 전 상태와 누락 사진을 다음 점검 시 재확인합니다."]
      ]),
      merges: ["A1:J1", "A2:J2", "A3:B3", "C3:D3", "E3:F3", "G3:H3", "I3:J3", "A4:B8", "C4:J8", "A9:B13", "C9:J13", "A14:B18", "C14:J18", "A19:B23", "C19:J23", "A24:B28", "C24:J28"],
      columnWidths: Array(21).fill(13)
    },
    ...photoSheets,
    {
      name: "전경사진",
      rows: withCells(blankRows(24, 14), [
        [1, 1, "전경사진"],
        [2, 1, `현장명: ${siteName}`],
        [2, 12, `일자 : ${generatedDate}`],
        [3, 1, content.comparison_photos[0] ? photoEvidenceText(content.comparison_photos[0]) : "등록된 전경 사진이 없습니다."],
        [3, 8, content.comparison_photos[1] ? photoEvidenceText(content.comparison_photos[1]) : "추가 전경 사진이 없습니다."],
        [11, 1, content.comparison_photos[2] ? photoEvidenceText(content.comparison_photos[2]) : ""],
        [11, 8, content.comparison_photos[3] ? photoEvidenceText(content.comparison_photos[3]) : ""]
      ]),
      merges: ["A1:N1", "L2:N2", "A3:G10", "H3:N10", "A11:G18", "H11:N18"],
      columnWidths: Array(14).fill(13)
    }
  ];
}

function buildPhotoSheet(content: ReportContent, sheetIndex: number): SheetDefinition {
  const siteName = content.situation.room ?? "현장 전체";
  const rows = withCells(blankRows(37, 14), [
    [1, 1, "사 진 대 지"],
    [2, 1, `현장명: ${siteName}`]
  ]);
  const slots = [
    { row: 11, labelCol: 1, valueCol: 3 },
    { row: 11, labelCol: 8, valueCol: 10 },
    { row: 20, labelCol: 1, valueCol: 3 },
    { row: 20, labelCol: 8, valueCol: 10 },
    { row: 29, labelCol: 1, valueCol: 3 },
    { row: 29, labelCol: 8, valueCol: 10 }
  ];
  slots.forEach((slot, slotIndex) => {
    const photo = content.comparison_photos[sheetIndex * slots.length + slotIndex];
    setCell(rows, slot.row, slot.labelCol, "내 용");
    setCell(rows, slot.row, slot.valueCol, photo ? photoEvidenceText(photo) : slotIndex === 0 && sheetIndex === 0 ? "선택한 조건에 해당하는 사진 데이터가 없습니다." : "");
  });
  return {
    name: `사진대지 (${sheetIndex + 1})`,
    rows,
    merges: ["A1:N1", "A2:N2", "A11:B11", "C11:G11", "H11:I11", "J11:N11", "A20:B20", "C20:G20", "H20:I20", "J20:N20", "A29:B29", "C29:G29", "H29:I29", "J29:N29"],
    columnWidths: Array(14).fill(13)
  };
}

function photoEvidenceText(photo: ReportContent["comparison_photos"][number]) {
  return [
    `날짜: ${photo.work_date}`,
    `위치: ${photo.room}`,
    `공사면/공종: ${photo.work_surface} / ${photo.trade}`,
    `작성자: ${photo.worker_name ?? "-"}`,
    `작업내용: ${photo.description ?? "-"}`,
    `AI 요약: ${photo.ai_description ?? "분석 대기"}`
  ].join("\n");
}

function photoDateRange(photos: ReportContent["comparison_photos"]) {
  const dates = photos.map((photo) => photo.work_date).filter((value): value is string => value.length > 0).sort();
  if (dates.length === 0) return null;
  return dates[0] === dates[dates.length - 1] ? dates[0] : `${dates[0]} ~ ${dates[dates.length - 1]}`;
}

function formatKoreanDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}년 ${date.getMonth() + 1}월 ${date.getDate()}일`;
}

function blankRows(rowCount: number, columnCount: number) {
  return Array.from({ length: rowCount }, () => Array.from({ length: columnCount }, () => ""));
}

function withCells(rows: string[][], cells: Array<[number, number, string]>) {
  cells.forEach(([row, column, value]) => setCell(rows, row, column, value));
  return rows;
}

function setCell(rows: string[][], row: number, column: number, value: string) {
  const targetRow = rows[row - 1];
  if (!targetRow) return;
  targetRow[column - 1] = value;
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

function workbookXml(sheets: SheetDefinition[]) {
  const sheetXml = sheets.map((sheet, index) => {
    return `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheetXml}</sheets></workbook>`;
}

function workbookRels(sheetCount: number) {
  const relationships = Array.from({ length: sheetCount }, (_, index) => {
    return `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships}</Relationships>`;
}

function worksheetXml(rows: string[][], merges: string[], columnWidths: number[]) {
  const cols = columnWidths.length > 0
    ? `<cols>${columnWidths.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("")}</cols>`
    : "";
  const body = rows.map((row, rowIndex) => {
    const cells = row.map((cell, colIndex) => {
      const ref = `${columnName(colIndex + 1)}${rowIndex + 1}`;
      return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(cell)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}" ht="28" customHeight="1">${cells}</row>`;
  }).join("");
  const mergeXml = merges.length > 0
    ? `<mergeCells count="${merges.length}">${merges.map((ref) => `<mergeCell ref="${ref}"/>`).join("")}</mergeCells>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:${columnName(Math.max(...rows.map((row) => row.length), 1))}${rows.length}"/>${cols}<sheetData>${body}</sheetData>${mergeXml}</worksheet>`;
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
  return `<w:p>${styleXml}<w:r><w:rPr>${wordRunFonts()}</w:rPr><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
}

function tableXml(rows: string[][]) {
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>${rows.map((row) => `<w:tr>${row.map((cell) => `<w:tc><w:p><w:r><w:rPr>${wordRunFonts()}</w:rPr><w:t xml:space="preserve">${xmlEscape(cell)}</w:t></w:r></w:p></w:tc>`).join("")}</w:tr>`).join("")}</w:tbl>`;
}

function contentTypesDocx() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`;
}

function contentTypesXlsx(sheetCount: number) {
  const sheetOverrides = Array.from({ length: sheetCount }, (_, index) => {
    return `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheetOverrides}</Types>`;
}

function rootRels(kind: string, target: string) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${kind}" Target="${target}"/></Relationships>`;
}

function wordStyles() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr>${wordRunFonts()}<w:sz w:val="20"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr>${wordRunFonts()}<w:b/><w:sz w:val="36"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:rPr>${wordRunFonts()}<w:b/><w:sz w:val="28"/></w:rPr></w:style></w:styles>`;
}

function wordRunFonts() {
  return '<w:rFonts w:ascii="Malgun Gothic" w:hAnsi="Malgun Gothic" w:eastAsia="Malgun Gothic" w:cs="Malgun Gothic"/>';
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
