import { getLabUser } from "@/lib/labAuth";
import { redirect } from "next/navigation";
import Navbar from "@/app/components/Navbar";
import ApiKeysManager from "./ApiKeysManager";

// /settings/api-keys — any logged-in user can mint keys for their own bots.
export default async function ApiKeysPage() {
  const user = await getLabUser();
  if (!user) redirect("/");

  return (
    <>
      <Navbar />
      <ApiKeysManager />
    </>
  );
}
