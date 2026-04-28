import { Body, Controller, Get, Param, Patch, Post, Query, Res, UseGuards } from "@nestjs/common";
import { Response } from "express";
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
  get(@CurrentUser() user: JwtUser, @Param("photoId") photoId: string) {
    return this.photos.get(user, photoId);
  }

  @Get("photos/:photoId/object")
  async object(@CurrentUser() user: JwtUser, @Param("photoId") photoId: string, @Res() res: Response) {
    const file = await this.photos.objectFile(user, photoId);
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.send(file.buffer);
  }

  @Get("photos/:photoId/analysis")
  analysis(@CurrentUser() user: JwtUser, @Param("photoId") photoId: string) {
    return this.photos.getAnalysis(user, photoId);
  }

  @Patch("photos/:photoId/analysis/review")
  review(@CurrentUser() user: JwtUser, @Param("photoId") photoId: string, @Body() dto: ReviewAnalysisDto) {
    return this.photos.reviewAnalysis(user, photoId, dto);
  }
}
