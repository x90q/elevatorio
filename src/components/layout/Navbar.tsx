"use client";

import { startTransition, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import ProfileModal from "@/components/profile/ProfileModal";
import ChatModal from "@/components/chat/ChatModal";
import { authClient } from "@/lib/auth-client";

export default function Navbar() {
    // Navbar owns global overlay state so chat and profile stay available on every route.
    // These booleans are intentionally mutually exclusive in the click handlers below.
    const [isProfileOpen, setIsProfileOpen] = useState(false);
    const [isChatOpen, setIsChatOpen] = useState(false);
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const { data: session, isPending } = authClient.useSession();
    const router = useRouter();
    // The admin plugin adds role at runtime; this small type mirrors that database field.
    const userRole = session?.user && "role" in session.user && typeof session.user.role === "string"
        ? session.user.role
        : undefined;
    // Used to reset overlays after client-side route changes.
    const pathname = usePathname();

    // Close route-level overlays when navigation changes.
    useEffect(() => {
        // Defer overlay cleanup so navigation remains responsive during route changes.
        startTransition(() => {
            setIsProfileOpen(false);
            setIsChatOpen(false);
            setIsMenuOpen(false);
        });
    }, [pathname]);

    // Escape is the shared keyboard shortcut for closing active overlays.
    useEffect(() => {
        function handleKeyDown(event: KeyboardEvent) {
            if (event.key === "Escape") {
                setIsProfileOpen(false);
                setIsChatOpen(false);
                setIsMenuOpen(false);
            }
        }

        window.addEventListener("keydown", handleKeyDown);

        return () => {
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, []);

    // Navigation actions are intentionally kept separate from modal content.
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

                    <div className="hidden items-center gap-6 text-sm text-slate-600 md:flex">
                        <Link className="transition hover:text-emerald-600" href="/">
                            Home
                        </Link>

                        <Link
                            className="transition hover:text-emerald-600"
                            href={!isPending && session ? "/world" : "/login"}
                        >
                            Enter the building
                        </Link>

                        {!isPending && session ? (
                            <>
                                {userRole === "admin" && (
                                    <Link className="transition hover:text-emerald-600" href="/admin">
                                        Admin
                                    </Link>
                                )}

                                <button
                                    type="button"
                                    className="transition hover:text-emerald-600"
                                    onClick={() => {
                                        setIsChatOpen(true);
                                        setIsProfileOpen(false);
                                    }}
                                >
                                    Chat
                                </button>

                                <button
                                    type="button"
                                    className="transition hover:text-emerald-600"
                                    onClick={() => {
                                        setIsProfileOpen(true);
                                        setIsChatOpen(false);
                                    }}
                                >
                                    Profile
                                </button>

                                <button
                                    type="button"
                                    className="font-semibold text-emerald-700 transition hover:text-emerald-900"
                                    onClick={async () => {
                                        await authClient.signOut();
                                        router.refresh();
                                    }}
                                >
                                    Logout
                                </button>
                            </>
                        ) : (
                            <Link className="font-semibold text-emerald-700 transition hover:text-emerald-900" href="/login">
                                Login
                            </Link>
                        )}
                    </div>

                    {/* Mobile navigation collapses into one menu so links fit narrow screens. */}
                    <div className="relative md:hidden">
                        <button
                            type="button"
                            className="rounded-lg grid size-10 place-items-center border border-slate-200 text-slate-700 transition hover:border-emerald-500 hover:text-emerald-700"
                            aria-label={isMenuOpen ? "Close menu" : "Open menu"}
                            aria-expanded={isMenuOpen}
                            aria-controls="mobile-navigation"
                            onClick={() => setIsMenuOpen((isOpen) => !isOpen)}
                        >
                            <span className="flex w-5 flex-col gap-1" aria-hidden="true">
                                <span className="h-0.5 w-full bg-current" />
                                <span className="h-0.5 w-full bg-current" />
                                <span className="h-0.5 w-full bg-current" />
                            </span>
                        </button>

                        {isMenuOpen && (
                            <div
                                id="mobile-navigation"
                                className="absolute right-0 top-12 z-40 flex min-w-48 flex-col gap-1 border border-slate-200 bg-white p-2 text-sm text-slate-700 shadow-lg"
                            >
                                <Link className="px-3 py-2 transition hover:bg-emerald-50 hover:text-emerald-700" href="/">
                                    Home
                                </Link>

                                <Link className="px-3 py-2 transition hover:bg-emerald-50 hover:text-emerald-700" href={!isPending && session ? "/world" : "/login"}>
                                    Enter the building
                                </Link>

                                {!isPending && session ? (
                                    <>
                                        {userRole === "admin" && (
                                            <Link className="px-3 py-2 transition hover:bg-emerald-50 hover:text-emerald-700" href="/admin">
                                                Admin
                                            </Link>
                                        )}
                                        <button
                                            type="button"
                                            className="px-3 py-2 text-left transition hover:bg-emerald-50 hover:text-emerald-700"
                                            onClick={() => {
                                                setIsChatOpen(true);
                                                setIsProfileOpen(false);
                                                setIsMenuOpen(false);
                                            }}
                                        >
                                            Chat
                                        </button>
                                        <button
                                            type="button"
                                            className="px-3 py-2 text-left transition hover:bg-emerald-50 hover:text-emerald-700"
                                            onClick={() => {
                                                setIsProfileOpen(true);
                                                setIsChatOpen(false);
                                                setIsMenuOpen(false);
                                            }}
                                        >
                                            Profile
                                        </button>
                                        <button
                                            type="button"
                                            className="px-3 py-2 text-left font-semibold text-emerald-700 transition hover:bg-emerald-50 hover:text-emerald-900"
                                            onClick={async () => {
                                                await authClient.signOut();
                                                setIsMenuOpen(false);
                                                router.refresh();
                                            }}
                                        >
                                            Logout
                                        </button>
                                    </>
                                ) : (
                                    <Link className="px-3 py-2 font-semibold text-emerald-700 transition hover:bg-emerald-50 hover:text-emerald-900" href="/login">
                                        Login
                                    </Link>
                                )}
                            </div>
                        )}
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