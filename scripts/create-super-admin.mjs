import { PrismaClient, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const email = process.env.SUPER_ADMIN_EMAIL;
const password = process.env.SUPER_ADMIN_PASSWORD;
const name = process.env.SUPER_ADMIN_NAME ?? "최반장";
const companyName = process.env.SUPER_ADMIN_COMPANY ?? "BIM Photo Sync 본사";

if (!email || !password) {
  console.error("SUPER_ADMIN_EMAIL과 SUPER_ADMIN_PASSWORD가 필요합니다.");
  process.exit(1);
}

if (password.length < 8) {
  console.error("SUPER_ADMIN_PASSWORD는 8자 이상이어야 합니다.");
  process.exit(1);
}

const company =
  (await prisma.company.findFirst({ where: { name: { equals: companyName, mode: "insensitive" } } })) ??
  (await prisma.company.create({ data: { name: companyName } }));

const passwordHash = await bcrypt.hash(password, 12);

await prisma.user.upsert({
  where: { email: email.toLowerCase() },
  update: { name, passwordHash, role: UserRole.SUPER_ADMIN, companyId: company.id },
  create: {
    email: email.toLowerCase(),
    passwordHash,
    name,
    role: UserRole.SUPER_ADMIN,
    companyId: company.id
  }
});

console.log(`최고관리자 준비 완료: ${email.toLowerCase()}`);
await prisma.$disconnect();
