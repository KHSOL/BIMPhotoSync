import { Body, Controller, Get, Param, Post, Query, Res, UseGuards } from "@nestjs/common";
import { Response } from "express";
import { CurrentUser, JwtUser } from "../common/current-user";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { GenerateReportDto, ReportChatDto, ReportQueryDto } from "./dto";
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

  @Get(":reportId/export")
  async export(@CurrentUser() user: JwtUser, @Param("reportId") reportId: string, @Query("format") format: string | undefined, @Res() res: Response) {
    const file = await this.reports.export(user, reportId, format);
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(file.filename)}"`);
    res.send(file.buffer);
  }

  @Post("generate")
  generate(@CurrentUser() user: JwtUser, @Body() dto: GenerateReportDto) {
    return this.reports.generate(user, dto);
  }

  @Post("chat")
  chat(@CurrentUser() user: JwtUser, @Body() dto: ReportChatDto) {
    return this.reports.chat(user, dto);
  }
}
