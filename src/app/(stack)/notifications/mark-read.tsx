"use client";

import { useEffect } from "react";
import { markNotificationsRead } from "@/app/actions/notifications";

/** Clears the unread badge once the notification centre has been opened. */
export function MarkRead() {
  useEffect(() => {
    markNotificationsRead();
  }, []);
  return null;
}
