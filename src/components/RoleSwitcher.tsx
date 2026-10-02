"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserCircle2 } from "lucide-react";
import { switchUser } from "@/app/actions";

export function RoleSwitcher({ current, currentName, options }: { current: string; currentName: string; options: { id: string; name: string; label: string }[] }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <label className="flex items-center gap-2 text-sm">
      <UserCircle2 className="h-5 w-5 text-slate-400" />
      <span className="text-slate-500">Demo role:</span>
      <select
        aria-label="Switch demo user"
        className="input min-w-64"
        value={options.some((o) => o.id === current) ? current : ""}
        disabled={pending}
        onChange={(e) =>
          start(async () => {
            await switchUser(e.target.value);
            router.push("/");
            router.refresh();
          })
        }
      >
        {!options.some((o) => o.id === current) && <option value="">{currentName}</option>}
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label} ({o.name})
          </option>
        ))}
      </select>
    </label>
  );
}
