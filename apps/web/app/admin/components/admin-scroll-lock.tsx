"use client";

import { useEffect } from "react";

export function AdminScrollLock() {
  useEffect(() => {
    const main = document.getElementById("admin-main-scroll");

    if (!main) {
      return;
    }

    main.classList.remove("overflow-y-auto");
    main.classList.add("overflow-hidden");

    return () => {
      main.classList.remove("overflow-hidden");
      main.classList.add("overflow-y-auto");
    };
  }, []);

  return null;
}
