import { getLabUser } from "@/lib/labAuth";
import { redirect } from "next/navigation";
import CreateMarketForm from "./CreateMarketForm";

import Navbar from "@/app/components/Navbar";

export default async function CreateMarketServerPage() {
  const user = await getLabUser();
  if (!user) redirect("/login");

  // Any authenticated user can create their own market.

  return (
    <>
      <Navbar />
      <CreateMarketForm isAdmin={user.role === "ADMIN"} />
    </>
  );
}
