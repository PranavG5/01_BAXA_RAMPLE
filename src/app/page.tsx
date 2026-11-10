import { redirect } from "next/navigation";
import { currentUser } from "@/lib/server/auth";

export default async function Home() {
  const user = await currentUser();
  redirect(user ? "/studio" : "/login");
}
