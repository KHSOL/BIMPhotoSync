import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "crypto";
import { PrismaService } from "../prisma/prisma.service";
import { ProjectsService } from "../projects/projects.service";
import { PresignDrawingAssetDto, PresignPhotoDto } from "./dto";

@Injectable()
export class UploadsService {
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly projects: ProjectsService,
    config: ConfigService
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

  async presign(user: { sub: string; companyId: string }, dto: PresignPhotoDto) {
    await this.projects.assertProjectAccess(user.sub, user.companyId, dto.project_id);
    const uploadId = randomUUID();
    const ext = mimeExtension(dto.mime_type);
    const objectKey = `photos/${dto.project_id}/${new Date().toISOString().slice(0, 10)}/${uploadId}.${ext}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      ContentType: dto.mime_type
    });
    const presignedUrl = await getSignedUrl(this.s3, command, { expiresIn: 600 });
    await this.prisma.photoUpload.create({
      data: {
        id: uploadId,
        projectId: dto.project_id,
        objectKey,
        mimeType: dto.mime_type,
        fileSize: dto.file_size,
        checksumSha256: dto.checksum_sha256,
        expiresAt
      }
    });
    return {
      data: {
        upload_id: uploadId,
        presigned_url: presignedUrl,
        method: "PUT",
        object_key: objectKey,
        expires_at: expiresAt
      }
    };
  }

  async presignDrawingAsset(user: { sub: string; companyId: string; role: string }, dto: PresignDrawingAssetDto) {
    await this.projects.assertProjectRole(user, dto.project_id, ["BIM_MANAGER", "PROJECT_ADMIN", "COMPANY_ADMIN"]);
    const uploadId = randomUUID();
    const ext = mimeExtension(dto.mime_type);
    const safeSheet = dto.sheet_number?.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/(^-|-$)/g, "") || "sheet";
    const objectKey = `drawings/${dto.project_id}/${new Date().toISOString().slice(0, 10)}/${safeSheet}-${uploadId}.${ext}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      ContentType: dto.mime_type
    });
    const presignedUrl = await getSignedUrl(this.s3, command, { expiresIn: 600 });
    return {
      data: {
        upload_id: uploadId,
        presigned_url: presignedUrl,
        method: "PUT",
        object_key: objectKey,
        expires_at: expiresAt
      }
    };
  }
}

function mimeExtension(mime: string) {
  if (mime === "image/png") return "png";
  if (mime === "application/pdf") return "pdf";
  if (mime === "image/webp") return "webp";
  return "jpg";
}

