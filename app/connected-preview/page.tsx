import { notFound, redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export default function ConnectedIndex() {
  if (process.env.NODE_ENV !== "development") notFound();
  redirect("/connected-preview/overview");
}
