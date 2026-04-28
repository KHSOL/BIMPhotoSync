import { createParamDecorator, ExecutionContext } from "@nestjs/common";

export type JwtUser = {
  sub: string;
  companyId: string;
  email: string;
  role: string;
};

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): JwtUser => {
  const request = ctx.switchToHttp().getRequest();
  return request.user;
});

