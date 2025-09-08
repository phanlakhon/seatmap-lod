import SeatMapLOD from "@/components/SeatMapLOD";

export default function Page() {
  return (
    <main className="min-h-screen bg-slate-900 text-slate-100 p-6">
      <h1 className="text-2xl font-bold mb-4">Interactive Seat Map • Mock</h1>
      <SeatMapLOD />
    </main>
  );
}
