import { auth } from "@/auth";
import { redirect } from "next/navigation";
import CreateMarketForm from "./CreateMarketForm";

import Navbar from "@/app/components/Navbar";

export default async function CreateMarketServerPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = session.user.role;
  if (role !== "ADMIN" && role !== "LIQUIDITY_PROVIDER") {
    redirect("/");
  }

  return (
    <>
      <Navbar />
      <CreateMarketForm />
    </>
  );
}
