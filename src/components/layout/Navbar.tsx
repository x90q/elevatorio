"use client";

import { startTransition, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import ProfileModal from "@/components/profile/ProfileModal";
import ChatModal from "@/components/chat/ChatModal";

export default function Navbar() {
    const [isProfileOpen, setIsProfileOpen] = useState(false);
    const [isChatOpen, setIsChatOpen] = useState(false);
    const pathname = usePathname();

    useEffect(() => {
        startTransition(() => {
            setIsProfileOpen(false);
            setIsChatOpen(false);
        });
    }, [pathname]);

    useEffect(() => {
        function handleKeyDown(event: KeyboardEvent) {
            if (event.key === "Escape") {
                setIsProfileOpen(false);
                setIsChatOpen(false);
            }
        }

        window.addEventListener("keydown", handleKeyDown);

        return () => {
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, []);

    return (
        <>
            <header className="fixed left-0 right-0 top-0 z-30 border-b border-slate-200 bg-white text-slate-900">
                <nav className="mx-auto flex min-h-16 w-full max-w-7xl items-center justify-between px-6">
                    <Link
                        href="/"
                        className="text-lg font-bold tracking-wide text-emerald-600"
                    >
                        Elevator
                    </Link>

                    <div className="flex items-center gap-6 text-sm text-slate-600">
                        <Link className="transition hover:text-emerald-600" href="/">
                            Home
                        </Link>

                        <Link
                            className="transition hover:text-emerald-600"
                            href="/world"
                        >
                            Enter the building
                        </Link>

                        <button
                            type="button"
                            className="transition hover:text-emerald-600"
                            onClick={() => {
                                setIsChatOpen(true);
                                setIsProfileOpen(false);
                            }
                            }
                        >
                            Chat
                        </button>

                        <button
                            type="button"
                            className="transition hover:text-emerald-600"
                            onClick={() => {
                                setIsProfileOpen(true);
                                setIsChatOpen(false);
                            }
                            }
                        >
                            Profile
                        </button>
                    </div>
                </nav>
            </header>

            {isProfileOpen && (
                <ProfileModal onClose={() => setIsProfileOpen(false)} />
            )}
            {isChatOpen && (
                <ChatModal onClose={() => setIsChatOpen(false)} />
            )}
        </>
    );
}