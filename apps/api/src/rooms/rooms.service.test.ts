import * as assert from "node:assert/strict";
import { ProgressStatus } from "@prisma/client";
import { toRoomResponse } from "./rooms.service";

function testRoomProgressUsesKoreanCompletionKeyword() {
  const response = toRoomResponse({
    id: "room-1",
    projectId: "project-1",
    bimPhotoRoomId: "rm_1",
    revitUniqueId: null,
    revitElementId: null,
    roomNumber: "R103",
    roomName: "Storage",
    levelName: "L1",
    locationText: null,
    status: "ACTIVE",
    photos: [
      {
        tradeCategoryId: "trade-1",
        description: "창고설비 완료",
        aiDescription: null,
        progressStatus: ProgressStatus.PENDING_REVIEW
      }
    ]
  });

  assert.equal(response.progress_by_trade_category?.["trade-1"]?.status, "COMPLETED");
}

function testRoomProgressUsesEnglishCompletionKeyword() {
  const response = toRoomResponse({
    id: "room-2",
    projectId: "project-1",
    bimPhotoRoomId: "rm_2",
    revitUniqueId: null,
    revitElementId: null,
    roomNumber: "101",
    roomName: "Cafe",
    levelName: "L1",
    locationText: null,
    status: "ACTIVE",
    photos: [
      {
        tradeCategoryId: "trade-2",
        description: null,
        aiDescription: "Wall installation completed.",
        progressStatus: ProgressStatus.PENDING_REVIEW
      }
    ]
  });

  assert.equal(response.progress_by_trade_category?.["trade-2"]?.status, "COMPLETED");
}

for (const test of [testRoomProgressUsesKoreanCompletionKeyword, testRoomProgressUsesEnglishCompletionKeyword]) {
  test();
  console.log(`PASS ${test.name}`);
}
