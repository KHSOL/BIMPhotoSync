import { Body, Controller, Get, Param, Patch, Post, Req, Res, UseGuards } from "@nestjs/common";
import { Request, Response } from "express";
import { CurrentUser, JwtUser } from "../common/current-user";
import { JwtAuthGuard } from "../common/jwt-auth.guard";
import { AuthService } from "./auth.service";
import { LoginDto, RegisterDto, UpdateAvatarDto } from "./dto";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("register")
  register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.auth.register(dto, requestMeta(req));
  }

  @Post("login")
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto, requestMeta(req));
  }

  @Get("companies")
  companies() {
    return this.auth.companies();
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: JwtUser) {
    return this.auth.me(user.sub);
  }

  @Patch("me/avatar")
  @UseGuards(JwtAuthGuard)
  updateAvatar(@CurrentUser() user: JwtUser, @Body() dto: UpdateAvatarDto) {
    return this.auth.updateAvatar(user.sub, dto);
  }

  @Get("users/:userId/avatar")
  async avatar(@Param("userId") userId: string, @Res() res: Response) {
    const file = await this.auth.avatarFile(userId);
    res.setHeader("Content-Type", file.contentType);
    res.setHeader("Cache-Control", "public, max-age=300");
    res.send(file.buffer);
  }
}

function requestMeta(req: Request) {
  return {
    ipAddress: req.ip ?? req.socket.remoteAddress,
    userAgent: req.get("user-agent") ?? null
  };
}

