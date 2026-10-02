/**
 * Seeds the local database with fake demo data (no real patient information).
 * Runs automatically on first `npm run dev`, or manually with `npm run db:seed`.
 * Re-running wipes and recreates everything.
 */
process.env.TZ = process.env.APP_TIMEZONE || "America/New_York";

import { prisma } from "../src/lib/db";
import { seedDemo } from "../src/lib/seedDemo";

seedDemo()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
