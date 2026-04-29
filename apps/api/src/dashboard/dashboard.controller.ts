import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { CurrentUser, JwtUser } from "../common/current-user";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { DashboardService } from "./dashboard.service";

@Controller("dashboard")
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get("summary")
  summary(@CurrentUser() user: JwtUser, @Query("project_id") projectId?: string) {
    return this.dashboard.summary(user, projectId);
  }
}
