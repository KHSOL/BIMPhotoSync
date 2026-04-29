import { Controller, Get } from "@nestjs/common";

@Controller()
export class AppController {
  @Get("health")
  health() {
    return {
      data: {
        status: "ok",
        service: "bim-photo-sync-api",
        checked_at: new Date().toISOString()
      }
    };
  }
}
