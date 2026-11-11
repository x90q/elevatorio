"use client";

import { useEffect } from "react";

// Block browser-level trackpad pinch while allowing the grid components to handle their own zoom.
export default function BrowserZoomGuard() {
    useEffect(() => {
        function preventBrowserZoom(event: WheelEvent) {
            if (event.ctrlKey) {
                event.preventDefault();
            }
        }

        document.addEventListener("wheel", preventBrowserZoom, { capture: true, passive: false });

        return () => {
            document.removeEventListener("wheel", preventBrowserZoom, true);
        };
    }, []);

    return null;
}
