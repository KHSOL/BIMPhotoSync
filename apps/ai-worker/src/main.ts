import "dotenv/config";
import { Prisma, PrismaClient, ProgressStatus, Trade, WorkSurface } from "@prisma/client";
import { Worker } from "bullmq";

const prisma = new PrismaClient();
const connection = { url: process.env.REDIS_URL ?? "redis://localhost:6379" };

function infer(photo: {
  trade: Trade;
  workSurface: WorkSurface;
  description: string | null;
}): {
  summary: string;
  detectedTrade: Trade;
  detectedSurface: WorkSurface;
  progressStatus: ProgressStatus;
  confidence: number;
  resultJson: Prisma.InputJsonValue;
} {
  const text = `${photo.description ?? ""} ${photo.trade} ${photo.workSurface}`.toLowerCase();
  const progressStatus =
    text.includes("완료") || text.includes("completed")
      ? ProgressStatus.COMPLETED
      : text.includes("차단") || text.includes("blocked") || text.includes("issue")
        ? ProgressStatus.BLOCKED
        : ProgressStatus.IN_PROGRESS;
  const summary = photo.description?.trim()
    ? `현장 메모 기준 ${photo.description.trim()} 상태로 판단됩니다.`
    : `${photo.workSurface} 면의 ${photo.trade} 작업 사진으로 판단됩니다.`;
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
      notes: ["MVP heuristic analysis. Manager review required."]
    }
  };
}

new Worker(
  "photo-ai",
  async (job) => {
    const { photoId } = job.data as { photoId: string };
    const photo = await prisma.photo.findUnique({ where: { id: photoId }, include: { room: true } });
    if (!photo) throw new Error(`Photo not found: ${photoId}`);
    const result = infer(photo);
    await prisma.$transaction([
      prisma.photoAiAnalysis.create({
        data: {
          photoId,
          modelProvider: "HEURISTIC",
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
      prisma.photo.update({
        where: { id: photoId },
        data: { aiDescription: result.summary, progressStatus: result.progressStatus }
      })
    ]);
    return result.resultJson;
  },
  { connection }
);

console.log("BIM Photo Sync AI worker listening on photo-ai queue");
