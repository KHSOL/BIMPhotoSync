import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { CurrentUser, JwtUser } from "../common/current-user";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { PresignAvatarDto, PresignDrawingAssetDto, PresignModelAssetDto, PresignPhotoDto } from "./dto";
import { UploadsService } from "./uploads.service";

@Controller("uploads")
@UseGuards(JwtAuthGuard)
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  @Post("photos/presign")
  presignPhoto(@CurrentUser() user: JwtUser, @Body() dto: PresignPhotoDto) {
    return this.uploads.presign(user, dto);
  }

  @Post("drawings/presign")
  presignDrawing(@CurrentUser() user: JwtUser, @Body() dto: PresignDrawingAssetDto) {
    return this.uploads.presignDrawingAsset(user, dto);
  }

  @Post("models/presign")
  presignModel(@CurrentUser() user: JwtUser, @Body() dto: PresignModelAssetDto) {
    return this.uploads.presignModelAsset(user, dto);
  }

  @Post("avatars/presign")
  presignAvatar(@CurrentUser() user: JwtUser, @Body() dto: PresignAvatarDto) {
    return this.uploads.presignAvatar(user, dto);
  }
}

