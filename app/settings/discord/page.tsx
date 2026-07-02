import { getLabUser } from "@/lib/labAuth";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import Navbar from "@/app/components/Navbar";
import DiscordLinkManager from "./DiscordLinkManager";

// Map ?linked / ?error query into a banner shown after the OAuth round-trip.
function bannerFor(linked?: string, error?: string): { kind: "ok" | "err"; msg: string } | null {
  if (linked === "1") return { kind: "ok", msg: "Discord account linked successfully." };
  if (!error) return null;
  const map: Record<string, string> = {
    denied: "You cancelled the authorization on Discord.",
    state: "The link session was invalid or expired — please try again.",
    exchange: "Couldn't exchange the authorization code with Discord — please try again.",
    profile: "Couldn't read your Discord profile — please try again.",
    already_linked: "This Discord account is already linked to another player.",
    config: "Discord integration isn't configured on the server.",
    save: "Couldn't save the link — please try again.",
  };
  return { kind: "err", msg: map[error] || "Linking Discord failed — please try again." };
}

// /settings/discord — link/unlink a Discord account to this trading user.
export default async function DiscordSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ linked?: string; error?: string }>;
}) {
  const user = await getLabUser();
  if (!user) redirect("/");

  const dbUser = await prisma.user.findUnique({
    where: { id: Number(user.id) },
    select: { discordId: true, discordUsername: true, discordLinkedAt: true },
  });

  const { linked, error } = await searchParams;

  return (
    <>
      <Navbar />
      <DiscordLinkManager
        linked={!!dbUser?.discordId}
        discordUsername={dbUser?.discordUsername ?? null}
        discordLinkedAt={dbUser?.discordLinkedAt ? dbUser.discordLinkedAt.toISOString() : null}
        banner={bannerFor(linked, error)}
      />
    </>
  );
}
