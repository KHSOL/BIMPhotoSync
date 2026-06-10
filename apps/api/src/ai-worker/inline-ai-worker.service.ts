import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { AiProvider, Prisma, ProgressStatus, Trade, WorkSurface } from "@prisma/client";
import { Job, Worker } from "bullmq";
import { PrismaService } from "../prisma/prisma.service";

type AnalyzePhotoJob = {
  photoId: string;
};

type PhotoForAnalysis = {
  trade: Trade;
  workSurface: WorkSurface;
  description: string | null;
  objectKey: string;
  mimeType: string;
  room?: {
    roomNumber: string | null;
    roomName: string;
    levelName: string | null;
  } | null;
};

type AnalysisResult = {
  summary: string;
  detectedTrade: Trade;
  detectedSurface: WorkSurface;
  progressStatus: ProgressStatus;
  confidence: number;
  resultJson: Prisma.InputJsonValue;
};

@Injectable()
export class InlineAiWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InlineAiWorkerService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private worker: Worker<AnalyzePhotoJob> | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService
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

  onModuleInit() {
    if (this.config.get<string>("RUN_INLINE_AI_WORKER", "false") !== "true") return;

    this.worker = new Worker<AnalyzePhotoJob>(
      "photo-ai",
      async (job: Job<AnalyzePhotoJob>) => this.analyzePhoto(job.data),
      {
        connection: { url: this.config.get<string>("REDIS_URL", "redis://localhost:6379") }
      }
    );
    this.worker.on("failed", (job, error) => {
      this.logger.error(`Photo AI job failed: ${job?.id ?? "unknown"}`, error.stack);
    });
    this.logger.log("Inline photo AI worker started with OpenAI image analysis and heuristic fallback.");
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  private async analyzePhoto(data: AnalyzePhotoJob) {
    if (!data.photoId) throw new Error("photoId is required.");

    const photo = await this.prisma.photo.findUnique({ where: { id: data.photoId }, include: { room: true } });
    if (!photo) throw new Error(`Photo not found: ${data.photoId}`);

    const modelResult = await this.analyzeWithOpenAI(photo).catch((error: unknown) => {
      this.logger.warn(`OpenAI photo analysis failed for ${data.photoId}: ${error instanceof Error ? error.message : "unknown error"}`);
      return null;
    });
    const result = modelResult ?? inferAnalysis(photo);
    await this.prisma.$transaction([
      this.prisma.photoAiAnalysis.create({
        data: {
          photoId: data.photoId,
          modelProvider: modelResult ? AiProvider.OPENAI : AiProvider.HEURISTIC,
          modelName: modelResult ? this.openAIModelName() : "bim-photo-sync-basic-v1",
          promptVersion: modelResult ? "photo-vision-v1" : "basic-v1",
          resultJson: result.resultJson,
          summary: result.summary,
          detectedTrade: result.detectedTrade,
          detectedSurface: result.detectedSurface,
          progressStatus: result.progressStatus,
          confidence: result.confidence,
          requiresHumanReview: !modelResult || requiresHumanReview(result)
        }
      }),
      this.prisma.photo.update({
        where: { id: data.photoId },
        data: { aiDescription: result.summary, progressStatus: result.progressStatus }
      })
    ]);
    return result.resultJson;
  }

  private openAIModelName() {
    return this.config.get<string>("OPENAI_PHOTO_ANALYSIS_MODEL")
      ?? this.config.get<string>("OPENAI_REPORT_MODEL")
      ?? "gpt-5.5-2026-04-23";
  }

  private async analyzeWithOpenAI(photo: PhotoForAnalysis): Promise<AnalysisResult | null> {
    const apiKey = this.config.get<string>("OPENAI_API_KEY");
    if (!apiKey) return null;

    const image = await this.getPhotoInlineData(photo);
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: this.openAIModelName(),
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: buildPhotoAnalysisPrompt(photo) },
              { type: "input_image", image_url: `data:${image.mimeType};base64,${image.data}` }
            ]
          }
        ],
        text: { format: { type: "json_object" } },
        max_output_tokens: 900
      })
    });

    if (!res.ok) throw new Error(`OpenAI photo analysis failed: ${res.status} ${await res.text()}`);
    const text = openAIResponseText((await res.json()) as unknown);
    const parsed = parsePhotoAnalysisJson(text);
    if (!parsed) throw new Error("OpenAI photo analysis returned invalid JSON.");
    return normalizeOpenAIAnalysis(parsed, photo);
  }

  private async getPhotoInlineData(photo: PhotoForAnalysis) {
    const object = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: photo.objectKey }));
    const chunks: Buffer[] = [];
    for await (const chunk of object.Body as AsyncIterable<Uint8Array>) {
      chunks.push(Buffer.from(chunk));
    }
    return {
      mimeType: object.ContentType ?? photo.mimeType,
      data: Buffer.concat(chunks).toString("base64")
    };
  }
}

function inferAnalysis(photo: PhotoForAnalysis): AnalysisResult {
  const progressStatus = inferProgressStatus(`${photo.description ?? ""} ${photo.trade} ${photo.workSurface}`);
  const summary = photo.description?.trim()
    ? `\uD604\uC7A5 \uBA54\uBAA8\uB97C \uCC38\uACE0\uD558\uC5EC "${photo.description.trim()}" \uC0C1\uD0DC\uB85C \uC784\uC2DC \uBD84\uC11D\uD588\uC2B5\uB2C8\uB2E4. \uC0AC\uC9C4 \uC7AC\uBD84\uC11D\uC774 \uD544\uC694\uD569\uB2C8\uB2E4.`
    : `${photo.workSurface} \uBA74\uC758 ${photo.trade} \uC791\uC5C5 \uC0AC\uC9C4\uC73C\uB85C \uB4F1\uB85D\uB418\uC5C8\uC2B5\uB2C8\uB2E4. \uAD00\uB9AC\uC790 \uAC80\uD1A0\uAC00 \uD544\uC694\uD569\uB2C8\uB2E4.`;

  return {
    summary,
    detectedTrade: photo.trade,
    detectedSurface: photo.workSurface,
    progressStatus,
    confidence: 0.62,
    resultJson: {
      summary,
      detected_trade: photo.trade,
      detected_surface: photo.workSurface,
      progress_status: progressStatus,
      notes: ["Heuristic fallback analysis. Manager review required."]
    }
  };
}

function buildPhotoAnalysisPrompt(photo: PhotoForAnalysis) {
  const room = photo.room ? `${photo.room.levelName ?? ""} ${photo.room.roomNumber ?? ""} ${photo.room.roomName}`.trim() : "\uC120\uD0DD\uB41C \uBC29";
  const note = photo.description?.trim() || "\uC791\uC5C5\uC790 \uC785\uB825 \uB0B4\uC6A9 \uC5C6\uC74C";
  return [
    "\uB108\uB294 \uAC74\uC124 \uD604\uC7A5 \uC0AC\uC9C4\uC744 \uBD84\uC11D\uD558\uB294 BIM Photo Sync \uD488\uC9C8 \uAC80\uD1A0 AI\uC785\uB2C8\uB2E4.",
    "\uC0AC\uC9C4\uC5D0 \uBCF4\uC774\uB294 \uC2E4\uC81C \uC2DC\uACF5 \uC0C1\uD0DC\uB97C \uC6B0\uC120\uD558\uACE0, \uC791\uC5C5\uC790 \uC785\uB825 \uB0B4\uC6A9\uC740 \uCC38\uACE0\uB85C\uB9CC \uC0AC\uC6A9\uD558\uC138\uC694.",
    "\uC0AC\uC9C4\uC5D0\uC11C \uD655\uC778\uD560 \uC218 \uC5C6\uB294 \uC0AC\uD56D\uC740 \uD655\uC815\uD558\uC9C0 \uB9D0\uACE0 \uAC80\uD1A0 \uD544\uC694\uB85C \uD45C\uD604\uD558\uC138\uC694.",
    `\uBC29: ${room}`,
    `\uC0AC\uC6A9\uC790 \uC120\uD0DD \uACF5\uC0AC\uBA74: ${photo.workSurface}`,
    `\uC0AC\uC6A9\uC790 \uC120\uD0DD \uACF5\uC885: ${photo.trade}`,
    `\uC791\uC5C5\uC790 \uC785\uB825 \uB0B4\uC6A9: ${note}`,
    "\uBC18\uB4DC\uC2DC JSON object\uB9CC \uBC18\uD658\uD558\uC138\uC694.",
    "fields: summary(string, Korean one or two sentences), detected_trade(one of WATERPROOF,TILE,PAINT,ELECTRIC,MEP,WINDOW,CONCRETE,OTHER), detected_surface(one of FLOOR,WALL,ENTRY_WALL,FRONT_WALL,RIGHT_WALL,LEFT_WALL,CEILING,WINDOW,DOOR,PIPE,ELECTRIC,OTHER), progress_status(one of PENDING_REVIEW,IN_PROGRESS,COMPLETED,BLOCKED), confidence(number 0-1), observations(string array), review_required(boolean)."
  ].join("\n");
}

function normalizeOpenAIAnalysis(record: Record<string, unknown>, photo: PhotoForAnalysis): AnalysisResult {
  const summary = stringValue(record.summary)
    || (photo.description?.trim()
      ? `\uC0AC\uC9C4\uACFC \uC791\uC5C5\uC790 \uBA54\uBAA8\uB97C \uD568\uAED8 \uAC80\uD1A0\uD588\uC73C\uBA70, ${photo.description.trim()} \uC791\uC5C5 \uC0C1\uD0DC\uB85C \uBD84\uC11D\uB429\uB2C8\uB2E4.`
      : "\uC0AC\uC9C4\uC744 \uAE30\uC900\uC73C\uB85C \uD604\uC7A5 \uC0C1\uD0DC\uB97C \uBD84\uC11D\uD588\uC73C\uBA70, \uC138\uBD80 \uD310\uB2E8\uC740 \uAD00\uB9AC\uC790 \uAC80\uD1A0\uAC00 \uD544\uC694\uD569\uB2C8\uB2E4.");
  const detectedTrade = enumValue(record.detected_trade, Trade, photo.trade);
  const detectedSurface = enumValue(record.detected_surface, WorkSurface, photo.workSurface);
  const modelProgress = enumValue(record.progress_status, ProgressStatus, inferProgressStatus(`${summary} ${photo.description ?? ""}`));
  const progressStatus = inferProgressStatus(photo.description ?? "") === ProgressStatus.COMPLETED ? ProgressStatus.COMPLETED : modelProgress;
  const confidence = clamp(numberValue(record.confidence) ?? 0.78, 0, 1);
  const observations = stringArray(record.observations);
  return {
    summary,
    detectedTrade,
    detectedSurface,
    progressStatus,
    confidence,
    resultJson: {
      summary,
      detected_trade: detectedTrade,
      detected_surface: detectedSurface,
      progress_status: progressStatus,
      confidence,
      observations,
      review_required: booleanValue(record.review_required) ?? confidence < 0.75,
      worker_note_used_as_reference: photo.description ?? null
    }
  };
}

function inferProgressStatus(textValue: string) {
  const text = textValue.toLowerCase();
  if (text.includes("\uC644\uB8CC") || text.includes("completed") || text.includes("done")) return ProgressStatus.COMPLETED;
  if (text.includes("\uCC28\uB2E8") || text.includes("\uC911\uB2E8") || text.includes("blocked") || text.includes("issue")) return ProgressStatus.BLOCKED;
  return ProgressStatus.IN_PROGRESS;
}

function requiresHumanReview(result: AnalysisResult) {
  return result.confidence < 0.75 || result.progressStatus === ProgressStatus.PENDING_REVIEW;
}

function parsePhotoAnalysisJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as unknown;
    return isRecord(parsed) ? parsed : null;
  }
}

function openAIResponseText(value: unknown): string {
  if (!isRecord(value)) return "";
  const outputText = stringValue(value.output_text);
  if (outputText) return outputText;
  const output = Array.isArray(value.output) ? value.output : [];
  return output.map((item) => {
    if (!isRecord(item)) return "";
    const content = Array.isArray(item.content) ? item.content : [];
    return content.map((part) => {
      if (!isRecord(part)) return "";
      return stringValue(part.text) || stringValue(part.output_text) || "";
    }).join("");
  }).join("").trim();
}

function enumValue<T extends string>(value: unknown, enumObject: Record<string, T>, fallback: T): T {
  const raw = stringValue(value);
  const values = new Set(Object.values(enumObject));
  return raw && values.has(raw as T) ? raw as T : fallback;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanValue(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
