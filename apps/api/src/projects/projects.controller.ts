import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { CurrentUser, JwtUser } from "../common/current-user";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { CreateProjectDto, CreateTradeCategoryDto, JoinProjectDto, PreviewProjectAccessKeyDto } from "./dto";
import { ProjectsService } from "./projects.service";

@Controller("projects")
@UseGuards(JwtAuthGuard)
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(@CurrentUser() user: JwtUser) {
    return this.projects.list(user);
  }

  @Post()
  create(@CurrentUser() user: JwtUser, @Body() dto: CreateProjectDto) {
    return this.projects.create(user, dto);
  }

  @Post("join")
  join(@CurrentUser() user: JwtUser, @Body() dto: JoinProjectDto) {
    return this.projects.join(user, dto);
  }

  @Post("access-key/preview")
  previewAccessKey(@CurrentUser() user: JwtUser, @Body() dto: PreviewProjectAccessKeyDto) {
    return this.projects.previewAccessKey(user, dto);
  }

  @Post(":projectId/access-key")
  createAccessKey(@CurrentUser() user: JwtUser, @Param("projectId") projectId: string) {
    return this.projects.createAccessKey(user, projectId);
  }

  @Get(":projectId/members")
  members(@CurrentUser() user: JwtUser, @Param("projectId") projectId: string) {
    return this.projects.members(user, projectId);
  }

  @Get(":projectId/trade-categories")
  tradeCategories(@CurrentUser() user: JwtUser, @Param("projectId") projectId: string) {
    return this.projects.tradeCategories(user, projectId);
  }

  @Post(":projectId/trade-categories")
  createTradeCategory(@CurrentUser() user: JwtUser, @Param("projectId") projectId: string, @Body() dto: CreateTradeCategoryDto) {
    return this.projects.createTradeCategory(user, projectId, dto);
  }

  @Delete(":projectId/trade-categories/:categoryId")
  deleteTradeCategory(@CurrentUser() user: JwtUser, @Param("projectId") projectId: string, @Param("categoryId") categoryId: string) {
    return this.projects.deleteTradeCategory(user, projectId, categoryId);
  }

  @Get(":projectId/audit-events")
  auditEvents(@CurrentUser() user: JwtUser, @Param("projectId") projectId: string, @Query("limit") limit?: string) {
    return this.projects.auditEvents(user, projectId, limit ? Number(limit) : undefined);
  }

  @Get(":projectId/auth-events")
  authEvents(@CurrentUser() user: JwtUser, @Param("projectId") projectId: string, @Query("limit") limit?: string) {
    return this.projects.authEvents(user, projectId, limit ? Number(limit) : undefined);
  }
}
