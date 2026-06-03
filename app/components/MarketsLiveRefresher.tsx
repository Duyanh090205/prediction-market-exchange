"use client";

// Invisible helper for the Open Markets list. When anyone creates a new market
// the server broadcasts CONTRACT_CREATED to all clients; we re-fetch the
// (server-rendered, force-dynamic) list so the new market appears without a
// manual reload.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { getSocket } from "@/lib/socket-client";

export default function MarketsLiveRefresher() {
  const router = useRouter();

  useEffect(() => {
    const socket = getSocket();
    const onCreated = (payload: unknown) => {
      // DEBUG: confirms the broadcast reached this client.
      console.log("[markets] CONTRACT_CREATED received → refreshing", payload);
      router.refresh();
    };
    socket.on("CONTRACT_CREATED", onCreated);
    // DEBUG: confirms this component mounted and subscribed.
    console.log(
      "[markets] listening for CONTRACT_CREATED (socket connected =",
      socket.connected,
      ")"
    );
    return () => {
      socket.off("CONTRACT_CREATED", onCreated);
    };
  }, [router]);

  return null;
}
