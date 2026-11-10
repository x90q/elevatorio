import Link from "next/link";
import Navbar from "@/components/layout/Navbar";

const floors = [
  { number: "04", name: "London", status: "Really? London?" },
  { number: "03", name: "Moscow", status: "Here comes the tanks!" },
  { number: "02", name: "Singapore", status: "Oh wow" },
  { number: "01", name: "Tokyo", status: "Want some sushi?" },
  { number: "00", name: "Lobby", status: "Our home" },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-[#f7f8f5] text-slate-950">
      <Navbar />

      <main className="mx-auto grid min-h-[calc(100dvh-4rem)] w-full max-w-[1440px] grid-cols-1 border-x border-slate-200 lg:grid-cols-[1.05fr_0.95fr]">
        <section className="relative flex flex-col justify-between overflow-hidden border-b border-slate-200 px-6 py-10 sm:px-12 lg:border-b-0 lg:border-r lg:px-16 lg:py-14">
          <div className="pointer-events-none absolute -right-32 -top-32 size-96 rounded-full border-[40px] border-emerald-100/70" />
          <div className="pointer-events-none absolute bottom-0 left-0 h-1/2 w-full bg-[linear-gradient(to_right,rgba(15,23,42,0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgba(15,23,42,0.04)_1px,transparent_1px)] bg-[size:32px_32px]" />

          <div className="relative z-10">
            <div className="flex items-center gap-3 text-xs font-bold uppercase tracking-[0.3em] text-emerald-700">
              <span className="size-2 rounded-full bg-emerald-500" />
              Elevator.
            </div>

            <p className="mt-20 max-w-xl text-[clamp(3.5rem,8vw,7.5rem)] font-black leading-[0.86] tracking-[-0.06em]">
              Become<br />
              something<br />
              <span className="text-emerald-600">together.</span>
            </p>

            <p className="mt-10 max-w-md text-lg leading-8 text-slate-600">
              A shared digital building for focused rooms, spontaneous hallway
              conversations, and the people who make the place feel alive.
            </p>

            <Link
              href="/world"
              className="mt-10 inline-flex items-center gap-4 rounded-full bg-slate-950 px-6 py-4 text-sm font-bold text-white transition hover:bg-emerald-700"
            >
              Enter the building
              <span aria-hidden="true" className="text-lg leading-none">-&gt;</span>
            </Link>
          </div>

          <div className="relative z-10 mt-16 flex items-end justify-between border-t border-slate-300 pt-5 text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
            <span>Elevator Office / 2026</span>
            <span>Est. 00:00</span>
          </div>
        </section>

        <section className="flex flex-col justify-center bg-white px-6 py-10 sm:px-12 lg:px-16">
          <div className="mb-8 flex items-end justify-between border-b border-slate-200 pb-5">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.3em] text-slate-400">
                Directory
              </p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight">Choose a floor</h1>
            </div>
            <span className="font-mono text-sm text-slate-400">05 levels</span>
          </div>

          <div className="divide-y divide-slate-200 border-y border-slate-200">
            {floors.map((floor) => (
              <Link
                key={floor.number}
                href="/world"
                className="group grid grid-cols-[4rem_1fr_auto] items-center gap-4 py-5 transition hover:bg-emerald-50 sm:grid-cols-[5rem_1fr_auto]"
              >
                <span className="ml-4 font-mono text-2xl text-slate-300 transition group-hover:text-emerald-500">
                  {floor.number}
                </span>
                <span>
                  <strong className="block text-lg font-semibold">{floor.name}</strong>
                  <small className="mt-1 block text-sm text-slate-500">{floor.status}</small>
                </span>
                <span className="mr-4 text-slate-300 transition group-hover:translate-x-1 group-hover:text-emerald-600" aria-hidden="true">
                  -&gt;
                </span>
              </Link>
            ))}
          </div>

          <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="border border-slate-200 bg-slate-50 p-4">
              <p className="font-mono text-2xl font-bold">24</p>
              <p className="mt-2 text-xs uppercase tracking-[0.15em] text-slate-500">People online</p>
            </div>
            <div className="border border-slate-200 bg-slate-50 p-4">
              <p className="font-mono text-2xl font-bold">08</p>
              <p className="mt-2 text-xs uppercase tracking-[0.15em] text-slate-500">Open rooms</p>
            </div>
            <div className="col-span-2 border border-emerald-200 bg-emerald-50 p-4 sm:col-span-1">
              <p className="font-mono text-2xl font-bold text-emerald-700">00</p>
              <p className="mt-2 text-xs uppercase tracking-[0.15em] text-emerald-700">Your starting floor</p>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}