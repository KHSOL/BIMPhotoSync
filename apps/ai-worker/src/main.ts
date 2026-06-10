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

type InlineImageData = {
  mimeType: string;
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
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return inferHeuristic(photo, "OPENAI_API_KEY is not configured.");

  try {
    const image = await readImageInlineData(photo);
    const modelName = openAIModelName();
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: modelName,
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

    const parsed = parseJsonObject(openAIResponseText((await res.json()) as unknown));
    const summary = stringValue(parsed.summary)
      || (photo.description?.trim()
        ? `현장 사진과 작업자 메모를 참고하여 ${photo.description.trim()} 상태로 분석했습니다.`
        : "사진을 기준으로 현장 상태를 분석했으며, 세부 판단은 관리자 검토가 필요합니다.");
    const detectedTrade = enumValue(parsed.detected_trade, tradeValues, photo.trade);
    const detectedSurface = enumValue(parsed.detected_surface, surfaceValues, photo.workSurface);
    const progressStatus = inferProgressStatus(photo.description ?? "") === ProgressStatus.COMPLETED
      ? ProgressStatus.COMPLETED
      : enumValue(parsed.progress_status, progressValues, inferProgressStatus(`${summary} ${photo.description ?? ""}`));
    const confidence = clampConfidence(parsed.confidence);
    const observations = stringArray(parsed.observations);

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
        observations,
        review_required: booleanValue(parsed.review_required) ?? confidence < 0.75,
        worker_note_used_as_reference: photo.description ?? null
      },
      modelProvider: AiProvider.OPENAI,
      modelName,
      promptVersion: "openai-vision-v1",
      requiresHumanReview: confidence < 0.75
    };
  } catch (error) {
    return inferHeuristic(photo, error instanceof Error ? error.message : "OpenAI photo analysis failed.");
  }
}

async function readImageInlineData(photo: PhotoForAnalysis): Promise<InlineImageData> {
  const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: photo.objectKey }));
  const chunks: Buffer[] = [];
  for await (const chunk of object.Body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return {
    mimeType: object.ContentType ?? photo.mimeType,
    data: Buffer.concat(chunks).toString("base64")
  };
}

function inferHeuristic(photo: PhotoForAnalysis, fallbackReason?: string): AnalysisResult {
  const progressStatus = inferProgressStatus(`${photo.description ?? ""} ${photo.trade} ${photo.workSurface}`);
  const summary = photo.description?.trim()
    ? `현장 메모를 참고하여 "${photo.description.trim()}" 상태로 임시 분석했습니다. 사진 재분석이 필요합니다.`
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

function openAIModelName() {
  return process.env.OPENAI_PHOTO_ANALYSIS_MODEL ?? process.env.OPENAI_REPORT_MODEL ?? "gpt-5.5-2026-04-23";
}

function buildPhotoAnalysisPrompt(photo: PhotoForAnalysis) {
  const room = photo.room ? `${photo.room.levelName ?? ""} ${photo.room.roomNumber ?? ""} ${photo.room.roomName}`.trim() : "selected room";
  const note = photo.description?.trim() || "no worker note";
  return [
    "You are the BIM Photo Sync construction photo quality reviewer.",
    "Prioritize the actual image evidence. Use worker-entered text only as reference context.",
    "Do not assert details that cannot be confirmed from the image. Mark uncertain cases as review_required.",
    "Return only a JSON object in Korean.",
    `Room: ${room}`,
    `Selected work surface: ${photo.workSurface}`,
    `Selected trade: ${photo.trade}`,
    `Worker note: ${note}`,
    `Allowed trades: ${Object.values(Trade).join(", ")}`,
    `Allowed work surfaces: ${Object.values(WorkSurface).join(", ")}`,
    `Allowed progress statuses: ${Object.values(ProgressStatus).join(", ")}`,
    "Fields: summary(string, Korean one or two sentences), detected_trade(one allowed trade), detected_surface(one allowed surface), progress_status(one allowed progress status), confidence(number 0-1), observations(string array), review_required(boolean)."
  ].join("\n");
}

function inferProgressStatus(textValue: string | null | undefined) {
  const text = (textValue ?? "").toLowerCase();
  if (text.includes("완료") || text.includes("completed") || text.includes("done")) return ProgressStatus.COMPLETED;
  if (text.includes("차단") || text.includes("중단") || text.includes("blocked") || text.includes("issue")) return ProgressStatus.BLOCKED;
  return ProgressStatus.IN_PROGRESS;
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

function parseJsonObject(text: string) {
  const cleaned = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim();
  const parsed = JSON.parse(cleaned) as unknown;
  if (!isRecord(parsed)) throw new Error("OpenAI photo analysis returned a non-object JSON value.");
  return parsed;
}

function enumValue(value: unknown, allowed: Set<string>, fallback: string) {
  return typeof value === "string" && allowed.has(value) ? value : fallback;
}

function clampConfidence(value: unknown) {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) return 0.7;
  return Math.min(0.99, Math.max(0.01, numberValue));
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function booleanValue(value: unknown) {
  return typeof value === "boolean" ? value : null;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
          confidence: new Prisma.Decimal(result.confidence),
          requiresHumanReview: result.requiresHumanReview
        }
      }),
      prisma.photo.update({
        where: { id: photoId },
        data: {
          aiDescription: result.summary,
          progressStatus: result.progressStatus
        }
      })
    ]);
    return result.resultJson;
  },
  { connection }
);

console.log("BIM Photo Sync AI worker listening on photo-ai queue with OpenAI image analysis");
