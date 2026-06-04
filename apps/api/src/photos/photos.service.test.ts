import * as assert from "node:assert/strict";
import { ConfigService } from "@nestjs/config";
import { ProgressStatus, RowStatus, Trade, WorkSurface } from "@prisma/client";
import { toPhotoResponse } from "./photos.service";

type PhotoResponseInput = Parameters<typeof toPhotoResponse>[0];

function testPhotoResponseUsesKoreanCompletionKeyword() {
  const config = new ConfigService({ API_PUBLIC_URL: "https://api.example.test" });
  const response = toPhotoResponse(
    {
      id: "photo-1",
      projectId: "project-1",
      roomId: "room-1",
      uploadedById: "user-1",
      workSurface: WorkSurface.OTHER,
      trade: Trade.OTHER,
      tradeCategoryId: null,
      workDate: new Date("2026-06-04T00:00:00.000Z"),
      workerName: "작업자",
      description: "창고설비 완료",
      aiDescription: null,
      progressStatus: ProgressStatus.PENDING_REVIEW,
      storageProvider: "S3",
      thumbnailKey: null,
      status: RowStatus.ACTIVE,
      takenAt: null,
      objectKey: "photos/photo-1.jpg",
      mimeType: "image/jpeg",
      fileSize: BigInt(123),
      checksumSha256: null,
      uploadedAt: new Date("2026-06-04T01:00:00.000Z"),
    } satisfies PhotoResponseInput,
    config
  );

  assert.equal(response.progress_status, ProgressStatus.COMPLETED);
}

for (const test of [testPhotoResponseUsesKoreanCompletionKeyword]) {
  test();
  console.log(`PASS ${test.name}`);
}
