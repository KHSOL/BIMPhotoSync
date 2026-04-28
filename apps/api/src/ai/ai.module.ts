import { Module } from "@nestjs/common";
import { PhotosModule } from "../photos/photos.module";

@Module({
  imports: [PhotosModule]
})
export class AiModule {}

