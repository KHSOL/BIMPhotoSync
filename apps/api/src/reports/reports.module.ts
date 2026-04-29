import { Module } from "@nestjs/common";
import { PrismaModule } from "../prisma/prisma.module";
import { ProjectsModule } from "../projects/projects.module";
import { ReportsController } from "./reports.controller";
import { ReportsService } from "./reports.service";

@Module({
  imports: [PrismaModule, ProjectsModule],
  controllers: [ReportsController],
  providers: [ReportsService]
})
export class ReportsModule {}
