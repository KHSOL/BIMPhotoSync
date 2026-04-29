import { Controller, Get, UseGuards } from "@nestjs/common";
import { CurrentUser, JwtUser } from "../common/current-user";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { AdminService } from "./admin.service";

@Controller("admin")
@UseGuards(JwtAuthGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get("overview")
  overview(@CurrentUser() user: JwtUser) {
    return this.admin.overview(user);
  }
}
