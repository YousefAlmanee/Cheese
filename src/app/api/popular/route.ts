import { NextResponse } from "next/server";
import { CATEGORIES, type Category } from "@/db/schema";
import { currentUser } from "@/lib/session";
import { popularAll } from "@/lib/providers";
import { libraryStatuses } from "@/lib/library";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const url = new URL(req.url);
  const cat = url.searchParams.get("category");
  const category = CATEGORIES.includes(cat as Category) ? (cat as Category) : undefined;

  const outcome = await popularAll(category);
  const inLibrary = await libraryStatuses(me.user.id, outcome.hits);
  return NextResponse.json({ ...outcome, inLibrary });
}
