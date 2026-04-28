import { Module } from "@nestjs/common";
import { ProjectsModule } from "../projects/projects.module";
import { RevitController } from "./revit.controller";
import { RevitService } from "./revit.service";

@Module({
  imports: [ProjectsModule],
  controllers: [RevitController],
  providers: [RevitService]
})
export class RevitModule {}

