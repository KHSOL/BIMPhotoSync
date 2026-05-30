import "dotenv/config";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { AiProvider, Prisma, PrismaClient, ProgressStatus, Trade, WorkSurface } from "@prisma/client";
import { Worker } from "bullmq";

const prisma = new PrismaClient();
const connection = { url: process.env.REDIS_URL ?? "redis://localhost:6379" };

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION ?? "us-east-1",
  forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "true") === "true",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "minio",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "minio123"
  }
});

const bucket = process.env.S3_BUCKET ?? "bim-photo-sync";

type PhotoForAnalysis = {
  id: string;
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

type GeminiInlineData = {
  mime_type: string;
  data: string;
};

type AnalysisResult = {
  summary: string;
  detectedTrade: Trade;
  detectedSurface: WorkSurface;
  progressStatus: ProgressStatus;
  confidence: number;
  resultJson: Prisma.InputJsonValue;
  modelProvider: AiProvider;
  modelName: string;
  promptVersion: string;
  requiresHumanReview: boolean;
};

const tradeValues = new Set<string>(Object.values(Trade));
const surfaceValues = new Set<string>(Object.values(WorkSurface));
const progressValues = new Set<string>(Object.values(ProgressStatus));

async function analyze(photo: PhotoForAnalysis): Promise<AnalysisResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return inferHeuristic(photo, "GEMINI_API_KEY is not configured.");

  try {
    const image = await readImageInlineData(photo);
    const modelName = process.env.GEMINI_VISION_MODEL ?? "gemini-3.1-flash-lite";
    const prompt = [
      "너는 BIM 현장 사진 분석 담당자다.",
      "아래 사진과 메타데이터를 근거로 한국어 JSON만 반환한다. Markdown 금지.",
      "JSON 필드: summary, detected_trade, detected_surface, progress_status, confidence, observations.",
      "enum 값은 반드시 허용 목록 중 하나만 사용한다.",
      "공정 상태 규칙: 작업 흔적이 명확하면 IN_PROGRESS, 메모나 시각적 근거가 완료이면 COMPLETED, 문제/중단/차단이면 BLOCKED, 확신이 낮으면 PENDING_REVIEW.",
      `방: ${photo.room?.levelName ?? "-"} / ${photo.room?.roomNumber ?? ""} ${photo.room?.roomName ?? ""}`,
      `입력 공종: ${photo.trade}`,
      `입력 공사면: ${photo.workSurface}`,
      `작업자 메모: ${photo.description ?? ""}`,
      `허용 공종: ${Object.values(Trade).join(", ")}`,
      `허용 공사면: ${Object.values(WorkSurface).join(", ")}`,
      `허용 공정상태: ${Object.values(ProgressStatus).join(", ")}`
    ].join("\n");

    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        generationConfig: {
          temperature: 0.1,
          response_mime_type: "application/json"
        },
        contents: [{ role: "user", parts: [{ text: prompt }, { inline_data: image }] }]
      })
    });

    if (!res.ok) throw new Error(`Gemini photo analysis failed: ${res.status} ${await res.text()}`);

    const json = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = json.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "{}";
    const parsed = parseJsonObject(text);
    const summary = typeof parsed.summary === "string" && parsed.summary.trim() ? parsed.summary.trim() : "사진 기준 현장 상태를 분석했습니다.";
    const detectedTrade = enumValue(parsed.detected_trade, tradeValues, photo.trade);
    const detectedSurface = enumValue(parsed.detected_surface, surfaceValues, photo.workSurface);
    const progressStatus = enumValue(parsed.progress_status, progressValues, inferProgressStatus(photo.description));
    const confidence = clampConfidence(parsed.confidence);

    return {
      summary,
      detectedTrade: detectedTrade as Trade,
      detectedSurface: detectedSurface as WorkSurface,
      progressStatus: progressStatus as ProgressStatus,
      confidence,
      resultJson: {
        summary,
        detected_trade: detectedTrade,
        detected_surface: detectedSurface,
        progress_status: progressStatus,
        confidence,
        observations: Array.isArray(parsed.observations) ? parsed.observations : []
      },
      modelProvider: AiProvider.GEMINI,
      modelName,
      promptVersion: "gemini-vision-v1",
      requiresHumanReview: confidence < 0.82
    };
  } catch (error) {
    return inferHeuristic(photo, error instanceof Error ? error.message : "Gemini photo analysis failed.");
  }
}

async function readImageInlineData(photo: PhotoForAnalysis): Promise<GeminiInlineData> {
  const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: photo.objectKey }));
  const chunks: Buffer[] = [];
  for await (const chunk of object.Body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return {
    mime_type: object.ContentType ?? photo.mimeType,
    data: Buffer.concat(chunks).toString("base64")
  };
}

function inferHeuristic(photo: PhotoForAnalysis, fallbackReason?: string): AnalysisResult {
  const progressStatus = inferProgressStatus(`${photo.description ?? ""} ${photo.trade} ${photo.workSurface}`);
  const summary = photo.description?.trim()
    ? `현장 메모 기준으로 "${photo.description.trim()}" 상태로 판단됩니다.`
    : `${photo.workSurface} 면의 ${photo.trade} 작업 사진으로 등록되었습니다. 관리자 검토가 필요합니다.`;
  const notes = ["Heuristic fallback analysis. Manager review required.", fallbackReason].filter((note): note is string => Boolean(note));

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
      notes
    },
    modelProvider: AiProvider.HEURISTIC,
    modelName: "bim-photo-sync-basic-v1",
    promptVersion: "basic-v1",
    requiresHumanReview: true
  };
}

function inferProgressStatus(textValue: string | null | undefined) {
  const text = (textValue ?? "").toLowerCase();
  if (text.includes("완료") || text.includes("completed") || text.includes("done")) return ProgressStatus.COMPLETED;
  if (text.includes("차단") || text.includes("중단") || text.includes("blocked") || text.includes("issue")) return ProgressStatus.BLOCKED;
  return ProgressStatus.IN_PROGRESS;
}

function parseJsonObject(text: string) {
  const cleaned = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  return JSON.parse(cleaned) as Record<string, unknown>;
}

function enumValue(value: unknown, allowed: Set<string>, fallback: string) {
  return typeof value === "string" && allowed.has(value) ? value : fallback;
}

function clampConfidence(value: unknown) {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) return 0.7;
  return Math.min(0.99, Math.max(0.01, numberValue));
}

new Worker(
  "photo-ai",
  async (job) => {
    const { photoId } = job.data as { photoId: string };
    const photo = await prisma.photo.findUnique({ where: { id: photoId }, include: { room: true } });
    if (!photo) throw new Error(`Photo not found: ${photoId}`);
    const result = await analyze(photo);
    await prisma.$transaction([
      prisma.photoAiAnalysis.create({
        data: {
          photoId,
          modelProvider: result.modelProvider,
          modelName: result.modelName,
          promptVersion: result.promptVersion,
          resultJson: result.resultJson,
          summary: result.summary,
          detectedTrade: result.detectedTrade,
          detectedSurface: result.detectedSurface,
          progressStatus: result.progressStatus,
          confidence: result.confidence,
          requiresHumanReview: result.requiresHumanReview
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
