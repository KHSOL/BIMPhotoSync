import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { CurrentUser, JwtUser } from "../common/current-user";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { GenerateReportDto, ReportQueryDto } from "./dto";
import { ReportsService } from "./reports.service";

@Controller("reports")
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  list(@CurrentUser() user: JwtUser, @Query() query: ReportQueryDto) {
    return this.reports.list(user, query);
  }

  @Get(":reportId")
  get(@CurrentUser() user: JwtUser, @Param("reportId") reportId: string) {
    return this.reports.get(user, reportId);
  }

  @Post("generate")
  generate(@CurrentUser() user: JwtUser, @Body() dto: GenerateReportDto) {
    return this.reports.generate(user, dto);
  }
}
