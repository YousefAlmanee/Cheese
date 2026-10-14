import { exportAll, libraryCsv } from "@/lib/export";
import { currentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Downloads the signed-in person's own data. `?format=csv` gives the library only; anything else gives everything as JSON. */
export async function GET(req: Request) {
  const current = await currentUser();
  if (!current) return new Response("Sign in first", { status: 401, headers: { "Cache-Control": "no-store" } });
  const data = await exportAll(current.user.id);
  if (!data) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

  const day = data.exportedAt.slice(0, 10);
  const csv = new URL(req.url).searchParams.get("format") === "csv";
  return new Response(csv ? libraryCsv(data) : JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": csv ? "text/csv; charset=utf-8" : "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="cheese-${csv ? "library" : "export"}-${day}.${csv ? "csv" : "json"}"`,
      "Cache-Control": "no-store",
    },
  });
}
