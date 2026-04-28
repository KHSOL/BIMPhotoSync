import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { RoomsModule } from "../rooms/rooms.module";
import { PhotosController } from "./photos.controller";
import { PhotosService } from "./photos.service";

@Module({
  imports: [RoomsModule, BullModule.registerQueue({ name: "photo-ai" })],
  controllers: [PhotosController],
  providers: [PhotosService],
  exports: [PhotosService]
})
export class PhotosModule {}

