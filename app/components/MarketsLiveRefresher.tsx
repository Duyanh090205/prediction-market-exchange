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
    const onCreated = () => router.refresh();
    socket.on("CONTRACT_CREATED", onCreated);
    return () => {
      socket.off("CONTRACT_CREATED", onCreated);
    };
  }, [router]);

  return null;
}
