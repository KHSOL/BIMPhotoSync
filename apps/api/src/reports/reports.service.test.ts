import * as assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import { ReportsService } from "./reports.service";
import type { GenerateReportDto } from "./dto";

type MockPrisma = {
  photo: {
    findMany: (args: unknown) => Promise<unknown[]>;
  };
  generatedReport: {
    findUnique: (args: unknown) => Promise<unknown>;
  };
  user: {
    findUnique: (args: unknown) => Promise<unknown>;
  };
};

type MockProjects = {
  assertProjectAccess: (userId: string, companyId: string, projectId: string) => Promise<void>;
  assertProjectRole: (user: unknown, projectId: string, roles: string[]) => Promise<void>;
  recordAuditEvent: (payload: unknown) => Promise<void>;
};

type MockConfig = {
  get: <T>(key: string, defaultValue?: T) => T | undefined;
};

type ZipEntry = {
  path: string;
  content: Buffer;
};

function createConfig(): MockConfig {
  return {
    get<T>(key: string, defaultValue?: T) {
      if (key === "S3_FORCE_PATH_STYLE") return "true" as T;
      return defaultValue;
    }
  };
}

function createProjects(): MockProjects {
  return {
    async assertProjectAccess() {},
    async assertProjectRole() {},
    async recordAuditEvent() {}
  };
}

function createService(prisma: MockPrisma) {
  return new ReportsService(prisma as never, createProjects() as never, createConfig() as never);
}

function reportFixture() {
  return {
    id: "report-1",
    projectId: "project-1",
    title: "주간 보고서",
    format: "JSON",
    status: "GENERATED",
    filters: {},
    content: {
      title: "주간 보고서",
      generated_at: "2026-06-04T00:00:00.000Z",
      generated_by: "관리자",
      filters: {},
      situation: {
        project_id: "project-1",
        room: "101 회의실",
        work_surface: "벽체",
        trade: "OTHER",
        date_range: "2026-06-01 ~ 2026-06-04",
        worker_name: null
      },
      comparison_photos: [
        {
          photo_id: "photo-1",
          work_date: "2026-06-04",
          room: "101 회의실",
          work_surface: "WALL",
          trade: "OTHER",
          worker_name: "홍길동",
          description: "긴 설명 텍스트",
          ai_description: "AI 요약"
        }
      ],
      progress_timeline: ["2026-06-04 101 회의실 WALL/OTHER: 진행 상황"],
      analysis_result: "긴 한국어 분석 결과가 여러 줄로 들어갑니다.",
      memo: "추가 조치 메모"
    },
    summary: "요약",
    photoIds: ["photo-1"],
    modelProvider: "HEURISTIC",
    modelName: "report-v1",
    errorMessage: null,
    project: { id: "project-1", name: "Project 1", code: "P1", companyId: "company-1", createdAt: new Date(), updatedAt: new Date() },
    createdBy: { id: "user-1", name: "관리자", email: "admin@example.com", role: "COMPANY_ADMIN" },
    createdAt: new Date("2026-06-04T00:00:00.000Z"),
    updatedAt: new Date("2026-06-04T00:00:00.000Z")
  };
}

function photoFixture() {
  return {
    id: "photo-1",
    projectId: "project-1",
    roomId: "room-1",
    uploadedById: "user-1",
    workSurface: "WALL",
    trade: "OTHER",
    tradeCategoryId: "trade-category-1",
    workDate: new Date("2026-06-04T00:00:00.000Z"),
    workerName: "홍길동",
    description: "긴 설명 텍스트",
    aiDescription: "AI 요약",
    progressStatus: "COMPLETED",
    storageProvider: "S3",
    objectKey: "photos/photo-1.png",
    thumbnailKey: null,
    mimeType: "image/png",
    fileSize: BigInt(16),
    checksumSha256: null,
    takenAt: new Date("2026-06-04T00:00:00.000Z"),
    uploadedAt: new Date("2026-06-04T00:00:00.000Z"),
    status: "ACTIVE",
    room: {
      id: "room-1",
      projectId: "project-1",
      bimPhotoRoomId: "bim-room-1",
      roomNumber: "101",
      roomName: "회의실",
      levelName: "1F",
      status: "ACTIVE"
    },
    analyses: []
  };
}

function photoFixtureWithId(index: number) {
  const fixture = photoFixture();
  const date = new Date(`2026-06-${String(index).padStart(2, "0")}T00:00:00.000Z`);
  return {
    ...fixture,
    id: `photo-${index}`,
    objectKey: `photos/photo-${index}.png`,
    workDate: date,
    takenAt: date,
    uploadedAt: date,
    description: `작업 설명 ${index}`,
    aiDescription: `AI 요약 ${index}`
  };
}

function multiPhotoReportFixture() {
  const fixture = reportFixture();
  const comparisonPhotos = Array.from({ length: 8 }, (_, index) => {
    const photo = photoFixtureWithId(index + 1);
    return {
      photo_id: photo.id,
      work_date: photo.workDate.toISOString().slice(0, 10),
      room: "101 회의실",
      work_surface: "WALL",
      trade: "OTHER",
      worker_name: "홍길동",
      description: photo.description,
      ai_description: photo.aiDescription
    };
  });
  return {
    ...fixture,
    content: {
      ...fixture.content,
      situation: {
        ...fixture.content.situation,
        date_range: "2026-06-01 ~ 2026-06-08"
      },
      comparison_photos: comparisonPhotos,
      progress_timeline: comparisonPhotos.map((photo) => `${photo.work_date} ${photo.description}`)
    },
    photoIds: comparisonPhotos.map((photo) => photo.photo_id)
  };
}

async function* bufferStream(buffer: Buffer) {
  yield buffer;
}

function unzipEntries(buffer: Buffer): ZipEntry[] {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries: ZipEntry[] = [];

  for (let index = 0; index < entryCount; index++) {
    assert.equal(buffer.readUInt32LE(centralOffset), 0x02014b50);
    const method = buffer.readUInt16LE(centralOffset + 10);
    const compressedSize = buffer.readUInt32LE(centralOffset + 20);
    const nameLength = buffer.readUInt16LE(centralOffset + 28);
    const extraLength = buffer.readUInt16LE(centralOffset + 30);
    const commentLength = buffer.readUInt16LE(centralOffset + 32);
    const localOffset = buffer.readUInt32LE(centralOffset + 42);
    const entryPath = buffer.subarray(centralOffset + 46, centralOffset + 46 + nameLength).toString("utf8");
    const contentStart = localFileContentStart(buffer, localOffset);
    const compressed = buffer.subarray(contentStart, contentStart + compressedSize);
    const content = method === 0 ? Buffer.from(compressed) : inflateRawSync(compressed);
    entries.push({ path: entryPath, content });
    centralOffset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function findEndOfCentralDirectory(buffer: Buffer) {
  for (let offset = buffer.length - 22; offset >= 0; offset--) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new Error("EOCD not found");
}

function localFileContentStart(buffer: Buffer, localOffset: number) {
  assert.equal(buffer.readUInt32LE(localOffset), 0x04034b50);
  const nameLength = buffer.readUInt16LE(localOffset + 26);
  const extraLength = buffer.readUInt16LE(localOffset + 28);
  return localOffset + 30 + nameLength + extraLength;
}

function zipEntryText(entries: ZipEntry[], path: string) {
  const entry = entries.find((item) => item.path === path);
  assert.ok(entry, `missing zip entry: ${path}`);
  return entry.content.toString("utf8");
}

async function testFindPhotosIgnoresLegacyTradeWhenCategorySelected() {
  let capturedArgs: unknown;
  const prisma: MockPrisma = {
    photo: {
      async findMany(args: unknown) {
        capturedArgs = args;
        return [];
      }
    },
    generatedReport: {
      async findUnique() {
        return null;
      }
    },
    user: {
      async findUnique() {
        return null;
      }
    }
  };
  const service = createService(prisma);
  const findPhotos = (Reflect.get(service as object, "findPhotos") as (dto: GenerateReportDto) => Promise<unknown>).bind(service);

  await findPhotos({
    project_id: "project-1",
    room_id: "room-1",
    trade: "OTHER",
    trade_category_id: "trade-category-1",
    work_surface: "WALL"
  });

  const where = (capturedArgs as { where: Record<string, unknown> }).where;
  assert.equal(where.projectId, "project-1");
  assert.equal(where.roomId, "room-1");
  assert.equal(where.workSurface, "WALL");
  assert.equal(where.tradeCategoryId, "trade-category-1");
  assert.equal(Object.prototype.hasOwnProperty.call(where, "trade"), false);
}

async function testExportDocxUsesWordTemplateAndEmbedsPhotos() {
  const prisma: MockPrisma = {
    photo: {
      async findMany() {
        return [photoFixture()];
      }
    },
    generatedReport: {
      async findUnique() {
        return reportFixture();
      }
    },
    user: {
      async findUnique() {
        return null;
      }
    }
  };
  const service = createService(prisma);
  Reflect.set(service as object, "s3", {
    async send() {
      return {
        Body: bufferStream(Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex")),
        ContentType: "image/png"
      };
    }
  });

  const exported = await service.export({ sub: "user-1", companyId: "company-1" }, "report-1", "DOCX");
  const entries = unzipEntries(exported.buffer);
  const documentXml = zipEntryText(entries, "word/document.xml");
  const relsXml = zipEntryText(entries, "word/_rels/document.xml.rels");

  assert.equal(exported.filename, "주간 보고서.docx");
  assert.match(documentXml, /시공일지/);
  assert.match(documentXml, /시공 현장 사진/);
  assert.match(documentXml, /101 회의실/);
  assert.match(documentXml, /긴 설명 텍스트/);
  assert.match(documentXml, /r:embed="rIdPhoto1"/);
  assertWellFormedXml(documentXml);
  assert.match(relsXml, /Target="media\/report-photo-1\.png"/);
  assert.ok(entries.some((entry) => entry.path === "word/media/report-photo-1.png"));
}

async function testExportDocxFallsBackToTextWhenPhotoDownloadFails() {
  const prisma: MockPrisma = {
    photo: {
      async findMany() {
        return [photoFixture()];
      }
    },
    generatedReport: {
      async findUnique() {
        return reportFixture();
      }
    },
    user: {
      async findUnique() {
        return null;
      }
    }
  };
  const service = createService(prisma);
  Reflect.set(service as object, "s3", {
    async send() {
      throw new Error("missing object");
    }
  });

  const exported = await service.export({ sub: "user-1", companyId: "company-1" }, "report-1", "DOCX");
  const entries = unzipEntries(exported.buffer);
  const documentXml = zipEntryText(entries, "word/document.xml");

  assert.equal(entries.some((entry) => entry.path === "word/media/report-photo-1.png"), false);
  assert.match(documentXml, /\[ 사진 첨부 \]/);
  assert.match(documentXml, /긴 설명 텍스트/);
  assertWellFormedXml(documentXml);
}

async function testExportDocxKeepsAllReportPhotos() {
  const prisma: MockPrisma = {
    photo: {
      async findMany() {
        return Array.from({ length: 8 }, (_, index) => photoFixtureWithId(index + 1));
      }
    },
    generatedReport: {
      async findUnique() {
        return multiPhotoReportFixture();
      }
    },
    user: {
      async findUnique() {
        return null;
      }
    }
  };
  const service = createService(prisma);
  Reflect.set(service as object, "s3", {
    async send() {
      return {
        Body: bufferStream(Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex")),
        ContentType: "image/png"
      };
    }
  });

  const exported = await service.export({ sub: "user-1", companyId: "company-1" }, "report-1", "DOCX");
  const entries = unzipEntries(exported.buffer);
  const documentXml = zipEntryText(entries, "word/document.xml");
  const relsXml = zipEntryText(entries, "word/_rels/document.xml.rels");

  assertWellFormedXml(documentXml);
  for (let index = 1; index <= 8; index += 1) {
    assert.match(documentXml, new RegExp(`r:embed="rIdPhoto${index}"`));
    assert.match(relsXml, new RegExp(`Target="media/report-photo-${index}\\.png"`));
    assert.ok(entries.some((entry) => entry.path === `word/media/report-photo-${index}.png`));
  }
}

function assertWellFormedXml(xml: string) {
  const stack: string[] = [];
  const tagPattern = /<([^!?][^>]*)>/g;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(xml)) !== null) {
    const rawTag = match[1].trim();
    if (rawTag.startsWith("/")) {
      const tagName = rawTag.slice(1).split(/\s+/)[0];
      assert.equal(stack.pop(), tagName, `mismatched closing tag: ${tagName}`);
      continue;
    }
    if (rawTag.endsWith("/")) continue;
    stack.push(rawTag.split(/\s+/)[0]);
  }
  assert.deepEqual(stack, []);
}

async function run(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    process.stdout.write(`PASS ${name}\n`);
  } catch (error) {
    process.stderr.write(`FAIL ${name}\n`);
    throw error;
  }
}

async function main() {
  await run("findPhotos ignores legacy trade filter when trade_category_id is selected", testFindPhotosIgnoresLegacyTradeWhenCategorySelected);
  await run("export DOCX uses the Word template and embeds report photos", testExportDocxUsesWordTemplateAndEmbedsPhotos);
  await run("export DOCX falls back to text evidence when photo download fails", testExportDocxFallsBackToTextWhenPhotoDownloadFails);
  await run("export DOCX keeps all report photos", testExportDocxKeepsAllReportPhotos);
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    if (error instanceof Error && error.stack) {
      process.stderr.write(`${error.stack}\n`);
    } else {
      process.stderr.write(`${String(error)}\n`);
    }
    process.exitCode = 1;
  });
}
