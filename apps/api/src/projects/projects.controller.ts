import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { CurrentUser, JwtUser } from "../common/current-user";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { CreateProjectDto, JoinProjectDto } from "./dto";
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

  @Post(":projectId/access-key")
  createAccessKey(@CurrentUser() user: JwtUser, @Param("projectId") projectId: string) {
    return this.projects.createAccessKey(user, projectId);
  }
}

