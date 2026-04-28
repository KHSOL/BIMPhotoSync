import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { CurrentUser, JwtUser } from "../common/current-user";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { CreateRoomDto, UpdateRoomDto } from "./dto";
import { RoomsService } from "./rooms.service";

@UseGuards(JwtAuthGuard)
@Controller()
export class RoomsController {
  constructor(private readonly rooms: RoomsService) {}

  @Get("projects/:projectId/rooms")
  list(@CurrentUser() user: JwtUser, @Param("projectId") projectId: string, @Query("q") q?: string) {
    return this.rooms.list(user, projectId, { q });
  }

  @Post("projects/:projectId/rooms")
  create(@CurrentUser() user: JwtUser, @Param("projectId") projectId: string, @Body() dto: CreateRoomDto) {
    return this.rooms.create(user, projectId, dto);
  }

  @Patch("rooms/:roomId")
  update(@CurrentUser() user: JwtUser, @Param("roomId") roomId: string, @Body() dto: UpdateRoomDto) {
    return this.rooms.update(user, roomId, dto);
  }
}

