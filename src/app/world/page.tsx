import Navbar from "@/components/layout/Navbar";

export default function WorldPage() {
    return (
        <main className="min-h-screen bg-slate-100 text-slate-950">
            <Navbar />

            <section className="relative h-[calc(100dvh-4rem)] overflow-hidden bg-indigo-100/20">
                <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(15,23,42,0.08)_1px,transparent_1px),linear-gradient(to_bottom,rgba(15,23,42,0.08)_1px,transparent_1px)] bg-[size:64px_64px]" />

                <div className="flex flex-col gap-1 absolute left-4 top-4 z-10 border border-slate-200 bg-white /95 px-8 py-4 shadow-lg shadow-slate-300/30 backdrop-blur-sm rounded-lg">
                    <p className="text-xs font-bold uppercase tracking-[0.3em] text-emerald-600">
                        Floor 00
                    </p>
                    <h1 className="text-2xl font-bold tracking-tight">Lobby</h1>
                    <p className="mt-1 text-sm text-slate-500">Main building entrance</p>
                </div>

                <div className="absolute left-1/2 top-1/2 h-3/5 w-3/5 -translate-x-1/2 -translate-y-1/2 border-2 border-slate-300 bg-white/40 shadow-xl shadow-slate-300/20">
                    <div className="absolute inset-[8%] border border-emerald-300 bg-emerald-50/60" />
                    <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-slate-200" />
                    <div className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-slate-200" />
                    <div className="absolute left-1/2 top-1/2 size-20 -translate-x-1/2 -translate-y-1/2 border-2 border-emerald-500 bg-white shadow-lg" />
                </div>

                <div className="rounded-lg absolute flex flex-col bottom-6 right-6 z-10 overflow-hidden border border-slate-200 bg-white shadow-lg shadow-slate-300/30">
                    <button type="button" className="grid size-9 place-items-center border-b border-slate-200 text-xl text-slate-700 transition hover:bg-emerald-50 hover:text-emerald-700" aria-label="Zoom out">
                        +
                    </button>
                    <span className="grid size-9 place-items-center font-mono text-xs text-slate-500">100%</span>
                    <button type="button" className="grid size-9 place-items-center border-t border-slate-200 text-xl text-slate-700 transition hover:bg-emerald-50 hover:text-emerald-700" aria-label="Zoom in">
                        -
                    </button>
                </div>

                <div className="rounded-lg absolute bottom-6 left-6 z-10 border border-slate-200 bg-white/95 px-4 py-3 text-right shadow-lg shadow-slate-300/30 backdrop-blur-sm">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Map status</p>
                    <p className="mt-1 text-sm font-semibold text-emerald-700">Ready to explore</p>
                </div>
            </section>
        </main >
    );
}