import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { CurrentUser, JwtUser } from "../common/current-user";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { RevitConnectDto, SyncRoomsDto } from "./dto";
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

  @Get("rooms/:bimPhotoRoomId/photos")
  roomPhotos(@CurrentUser() user: JwtUser, @Param("bimPhotoRoomId") bimPhotoRoomId: string) {
    return this.revit.roomPhotos(user, bimPhotoRoomId);
  }
}

