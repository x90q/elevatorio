import Navbar from "@/components/layout/Navbar";
import WorldViewport from "@/components/world/WorldViewport";

export default function WorldPage() {
    return (
        <main className="flex h-dvh flex-col overflow-hidden bg-slate-100 text-slate-950">
            <div className="shrink-0">
                <Navbar />
            </div>
            <WorldViewport />
        </main>
    );
}