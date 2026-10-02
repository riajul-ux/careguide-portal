import Link from "next/link";
export default function NotFound() {
  return <div className="py-20 text-center"><h1 className="text-lg font-semibold">Not found</h1><Link href="/" className="text-brand-700 hover:underline">Back to dashboard</Link></div>;
}
