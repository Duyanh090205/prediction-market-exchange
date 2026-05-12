import { getLabUser } from "@/lib/labAuth";
import { redirect } from "next/navigation";
import CreateMarketForm from "./CreateMarketForm";

import Navbar from "@/app/components/Navbar";

export default async function CreateMarketServerPage() {
  const user = await getLabUser();
  if (!user) redirect("/");

  const role = user.role;
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
