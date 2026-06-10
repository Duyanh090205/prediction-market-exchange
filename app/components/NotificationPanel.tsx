"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { withTradingBasePath } from "@/lib/withTradingBasePath";

interface NotificationItem {
  id: number;
  message: string;
  linkUrl: string | null;
  isRead: boolean;
  createdAt: string;
}

interface ApiData {
  unreadCount: number;
  notifications: NotificationItem[];
}

export default function NotificationPanel() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ApiData | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(withTradingBasePath("/api/notifications"));
      if (res.ok) setData(await res.json());
    } catch {
      // silent — panel just shows stale data
    }
  }, []);

  // Poll every 5 seconds
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Note: notifications are NOT auto-marked read on open anymore — the unread
  // badge persists until the user clicks the explicit "Mark all read" button
  // (UX-9). Otherwise opening the panel cleared unread instantly and that button
  // never appeared.

  // Close on outside click
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  // Legacy handleConfirm and handleReject removed since trades execute instantly.

  const markAllRead = useCallback(() => {
    fetch(withTradingBasePath("/api/notifications/read"), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
    }).then(() => fetchData());
  }, [fetchData]);

  const unread = data?.unreadCount ?? 0;

  return (
    <div ref={panelRef} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          position: "relative",
          padding: "0.375rem 0.625rem",
          background: open ? "#1a1a2e" : "transparent",
          border: "1px solid",
          borderColor: open ? "#3a3a5e" : "transparent",
          borderRadius: "0.375rem",
          color: "#8888a0",
          cursor: "pointer",
          fontSize: "1rem",
        }}
        aria-label="Notifications"
      >
        🔔
        {unread > 0 && (
          <span
            style={{
              position: "absolute",
              top: "-4px",
              right: "-4px",
              background: "#ef4444",
              color: "#fff",
              borderRadius: "9999px",
              fontSize: "0.625rem",
              fontWeight: 700,
              minWidth: "16px",
              height: "16px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0 3px",
            }}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          style={{
            position: "fixed",
            top: "3.25rem",
            right: "0.5rem",
            left: "auto",
            width: "min(380px, calc(100vw - 1rem))",
            maxHeight: "min(480px, 70vh)",
            overflowY: "auto",
            background: "#12121a",
            border: "1px solid #2a2a3e",
            borderRadius: "0.75rem",
            boxShadow: "0 8px 32px rgba(0,0,0,0.6)",
            zIndex: 100,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "0.875rem 1rem",
              borderBottom: "1px solid #1a1a2e",
            }}
          >
            <span
              style={{
                fontSize: "0.75rem",
                fontWeight: 700,
                color: "#5a5a72",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              Notifications
            </span>
            {unread > 0 && (
              <button
                onClick={markAllRead}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#818cf8",
                  fontSize: "0.6875rem",
                  fontWeight: 600,
                  cursor: "pointer",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
              >
                Mark all read
              </button>
            )}
          </div>

          {/* Pending requests section removed */}

          {/* Notification messages */}
          {data?.notifications.length === 0 && (

            <p
              style={{
                padding: "1.5rem 1rem",
                color: "#5a5a72",
                fontSize: "0.875rem",
                margin: 0,
                textAlign: "center",
              }}
            >
              No notifications yet.
            </p>
          )}

          {data?.notifications.map((n) => {
            const cardStyle: React.CSSProperties = {
              display: "block",
              padding: "0.75rem 1rem",
              borderBottom: "1px solid #1a1a2e",
              background: n.isRead ? "transparent" : "rgba(99,102,241,0.04)",
              textDecoration: "none",
            };
            const inner = (
              <>
                <p style={{ margin: "0 0 0.25rem", fontSize: "0.8125rem", color: "#e4e4ed" }}>
                  {n.message}
                </p>
                <p style={{ margin: 0, fontSize: "0.6875rem", color: "#5a5a72" }}>
                  {new Date(n.createdAt).toLocaleString()}
                </p>
              </>
            );
            return n.linkUrl ? (
              <Link key={n.id} href={n.linkUrl} onClick={() => setOpen(false)} style={{ ...cardStyle, cursor: "pointer" }}>
                {inner}
              </Link>
            ) : (
              <div key={n.id} style={cardStyle}>
                {inner}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
