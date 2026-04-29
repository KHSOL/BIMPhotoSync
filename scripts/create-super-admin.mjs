import { PrismaClient, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const email = process.env.SUPER_ADMIN_EMAIL;
const password = process.env.SUPER_ADMIN_PASSWORD;
const name = process.env.SUPER_ADMIN_NAME ?? "BIM Photo Sync Super Admin";
const companyName = process.env.SUPER_ADMIN_COMPANY ?? "BIM Photo Sync HQ";

if (!email || !password) {
  console.error("SUPER_ADMIN_EMAIL and SUPER_ADMIN_PASSWORD are required.");
  process.exit(1);
}

if (password.length < 8) {
  console.error("SUPER_ADMIN_PASSWORD must be at least 8 characters.");
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

console.log(`SUPER_ADMIN ready: ${email.toLowerCase()}`);
await prisma.$disconnect();
