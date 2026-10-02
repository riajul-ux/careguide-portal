import { prisma, type Tx } from "./db";
import { BUSINESS_DAY_END_HOUR, BUSINESS_DAY_START_HOUR } from "./time";

export interface AppSettings {
  businessDayStartHour: number;
  businessDayEndHour: number;
  defaultSupervisor: string | null;
}

export async function getSettings(db: Tx = prisma): Promise<AppSettings> {
  const rows = await db.appSetting.findMany();
  const m = new Map(rows.map((r) => [r.key, r.value]));
  return {
    businessDayStartHour: Number(m.get("businessDayStartHour") ?? BUSINESS_DAY_START_HOUR),
    businessDayEndHour: Number(m.get("businessDayEndHour") ?? BUSINESS_DAY_END_HOUR),
    defaultSupervisor: m.get("defaultSupervisor") ?? null,
  };
}

export async function setSetting(key: string, value: string, db: Tx = prisma) {
  await db.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
}
