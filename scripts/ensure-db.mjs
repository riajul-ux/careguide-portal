// Runs before `npm run dev` / `npm run build`:
// applies Prisma migrations to the local SQLite DB and seeds demo data on first run.
import { execSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";

const run = (cmd) => execSync(cmd, { stdio: "inherit" });

if (!existsSync(".env")) {
  writeFileSync(".env", 'DATABASE_URL="file:./dev.db"\nAPP_TIMEZONE="America/New_York"\n');
}

run("npx prisma migrate deploy");

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();
let users = 0;
try {
  users = await prisma.user.count();
} finally {
  await prisma.$disconnect();
}
if (users === 0) {
  console.log("Empty database - seeding demo data...");
  run("npx tsx prisma/seed.ts");
} else {
  console.log(`Database ready (${users} users).`);
}
