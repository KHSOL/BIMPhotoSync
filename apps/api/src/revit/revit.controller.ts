import { Body, Controller, Get, Param, Post, Res, UseGuards } from "@nestjs/common";
import { Response } from "express";
import { CurrentUser, JwtUser } from "../common/current-user";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { RevitConnectDto, SyncFloorPlanDto, SyncRoomsDto, SyncSheetsDto } from "./dto";
import { RevitService } from "./revit.service";

@Controller("revit")
@UseGuards(JwtAuthGuard)
export class RevitController {
  constructor(private readonly revit: RevitService) {}

  @Post("connect")
  connect(@CurrentUser() user: JwtUser, @Body() dto: RevitConnectDto) {
    return this.revit.connect(user, dto);
  }

  @Post("sync-rooms")
  syncRooms(@CurrentUser() user: JwtUser, @Body() dto: SyncRoomsDto) {
    return this.revit.syncRooms(user, dto);
  }

  @Post("floor-plans")
  syncFloorPlan(@CurrentUser() user: JwtUser, @Body() dto: SyncFloorPlanDto) {
    return this.revit.syncFloorPlan(user, dto);
  }

  @Post("sheets")
  syncSheets(@CurrentUser() user: JwtUser, @Body() dto: SyncSheetsDto) {
    return this.revit.syncSheets(user, dto);
  }

  @Get("projects/:projectId/floor-plans")
  floorPlans(@CurrentUser() user: JwtUser, @Param("projectId") projectId: string) {
    return this.revit.floorPlans(user, projectId);
  }

  @Get("projects/:projectId/sheets")
  sheets(@CurrentUser() user: JwtUser, @Param("projectId") projectId: string) {
    return this.revit.sheets(user, projectId);
  }

  @Get("sheets/:sheetId/asset")
  async sheetAsset(@CurrentUser() user: JwtUser, @Param("sheetId") sheetId: string, @Res() res: Response) {
    const asset = await this.revit.sheetAsset(user, sheetId);
    res.setHeader("Content-Type", asset.contentType);
    res.setHeader("Cache-Control", "private, max-age=300");
    res.send(asset.buffer);
  }

  @Get("rooms/:bimPhotoRoomId/photos")
  roomPhotos(@CurrentUser() user: JwtUser, @Param("bimPhotoRoomId") bimPhotoRoomId: string) {
    return this.revit.roomPhotos(user, bimPhotoRoomId);
  }
}

