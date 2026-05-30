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
  private worker: Worker<AnalyzePhotoJob> | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService
  ) {}

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
    this.logger.log("Inline photo AI worker started with heuristic fallback analysis.");
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }

  private async analyzePhoto(data: AnalyzePhotoJob) {
    if (!data.photoId) throw new Error("photoId is required.");

    const photo = await this.prisma.photo.findUnique({ where: { id: data.photoId }, include: { room: true } });
    if (!photo) throw new Error(`Photo not found: ${data.photoId}`);

    const result = inferAnalysis(photo);
    await this.prisma.$transaction([
      this.prisma.photoAiAnalysis.create({
        data: {
          photoId: data.photoId,
          modelProvider: AiProvider.HEURISTIC,
          modelName: "bim-photo-sync-basic-v1",
          promptVersion: "basic-v1",
          resultJson: result.resultJson,
          summary: result.summary,
          detectedTrade: result.detectedTrade,
          detectedSurface: result.detectedSurface,
          progressStatus: result.progressStatus,
          confidence: result.confidence,
          requiresHumanReview: true
        }
      }),
      this.prisma.photo.update({
        where: { id: data.photoId },
        data: { aiDescription: result.summary, progressStatus: result.progressStatus }
      })
    ]);
    return result.resultJson;
  }
}

function inferAnalysis(photo: PhotoForAnalysis): AnalysisResult {
  const progressStatus = inferProgressStatus(`${photo.description ?? ""} ${photo.trade} ${photo.workSurface}`);
  const summary = photo.description?.trim()
    ? `현장 메모 기준으로 "${photo.description.trim()}" 상태로 판단됩니다.`
    : `${photo.workSurface} 면의 ${photo.trade} 작업 사진으로 등록되었습니다. 관리자 검토가 필요합니다.`;

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

function inferProgressStatus(textValue: string) {
  const text = textValue.toLowerCase();
  if (text.includes("완료") || text.includes("completed") || text.includes("done")) return ProgressStatus.COMPLETED;
  if (text.includes("차단") || text.includes("중단") || text.includes("blocked") || text.includes("issue")) return ProgressStatus.BLOCKED;
  return ProgressStatus.IN_PROGRESS;
}
