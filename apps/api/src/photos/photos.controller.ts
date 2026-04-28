import { Body, Controller, Get, Param, Patch, Post, Query, Redirect, UseGuards } from "@nestjs/common";
import { CurrentUser, JwtUser } from "../common/current-user";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { CommitPhotoDto, PhotoQueryDto, ReviewAnalysisDto } from "./dto";
import { PhotosService } from "./photos.service";

@Controller()
@UseGuards(JwtAuthGuard)
export class PhotosController {
  constructor(private readonly photos: PhotosService) {}

  @Post("photos")
  commit(@CurrentUser() user: JwtUser, @Body() dto: CommitPhotoDto) {
    return this.photos.commit(user, dto);
  }

  @Get("photos")
  list(@CurrentUser() user: JwtUser, @Query() query: PhotoQueryDto) {
    return this.photos.list(user, query);
  }

  @Get("photos/:photoId")
  get(@Param("photoId") photoId: string) {
    return this.photos.get(photoId);
  }

  @Get("photos/:photoId/object")
  @Redirect()
  async object(@Param("photoId") photoId: string) {
    return { url: await this.photos.objectUrl(photoId), statusCode: 302 };
  }

  @Get("photos/:photoId/analysis")
  analysis(@Param("photoId") photoId: string) {
    return this.photos.getAnalysis(photoId);
  }

  @Patch("photos/:photoId/analysis/review")
  review(@CurrentUser() user: JwtUser, @Param("photoId") photoId: string, @Body() dto: ReviewAnalysisDto) {
    return this.photos.reviewAnalysis(user, photoId, dto);
  }
}
