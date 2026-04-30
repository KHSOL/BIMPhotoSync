import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { CurrentUser, JwtUser } from "../common/current-user";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { PresignDrawingAssetDto, PresignPhotoDto } from "./dto";
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
}

