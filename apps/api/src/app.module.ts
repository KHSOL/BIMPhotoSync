import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { AdminModule } from "./admin/admin.module";
import { AppController } from "./app.controller";
import { AiModule } from "./ai/ai.module";
import { AuthModule } from "./auth/auth.module";
import { PhotosModule } from "./photos/photos.module";
import { PrismaModule } from "./prisma/prisma.module";
import { ProjectsModule } from "./projects/projects.module";
import { ReportsModule } from "./reports/reports.module";
import { RevitModule } from "./revit/revit.module";
import { RoomsModule } from "./rooms/rooms.module";
import { UploadsModule } from "./uploads/uploads.module";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.get<string>("REDIS_URL", "redis://localhost:6379") }
      })
    }),
    PrismaModule,
    AdminModule,
    AuthModule,
    ProjectsModule,
    RoomsModule,
    UploadsModule,
    PhotosModule,
    ReportsModule,
    AiModule,
    RevitModule
  ],
  controllers: [AppController]
})
export class AppModule {}

