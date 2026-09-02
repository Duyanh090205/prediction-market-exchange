"use client";

// Invisible helper for the Open Markets list. When anyone creates a new market
// the server broadcasts CONTRACT_CREATED to all clients; we re-fetch the
// (server-rendered, force-dynamic) list so the new market appears without a
// manual reload.
//
// Signed-out visitors get the same behaviour over the public /market-data
// namespace — the market list is readable without an account, so it should not
// go stale without one either.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getMarketDataSocket } from "@/lib/socket-client";

export default function MarketsLiveRefresher({ authed }: { authed: boolean }) {
  const router = useRouter();

  useEffect(() => {
    const socket = getMarketDataSocket(authed);
    const onCreated = () => router.refresh();
    socket.on("CONTRACT_CREATED", onCreated);
    return () => {
      socket.off("CONTRACT_CREATED", onCreated);
    };
  }, [router, authed]);

  return null;
}
