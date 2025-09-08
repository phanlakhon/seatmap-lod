"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import * as PIXI from "pixi.js";
import { Viewport } from "pixi-viewport";

// -------------------- Types & Constants --------------------
// สถานะของที่นั่ง: AVAILABLE, HOLD, หรือ SOLD
type SeatStatus = "AVAILABLE" | "HOLD" | "SOLD";

// Zone = โซนที่นั่ง: มีรหัส, พิกัดรูปหลายเหลี่ยม, กรอบ bbox และสี
type Zone = {
  id: string;
  polygon: [number, number][]; // โพลิกอนสี่เหลี่ยม [[x,y],...]
  bbox: [number, number, number, number];
  color: number;
};

// Row = แถวที่นั่ง: รหัส, โซนที่สังกัด, ตำแหน่งเส้นแนวนอน (y, x1→x2)
type Row = { id: string; zoneId: string; y: number; x1: number; x2: number };

// Seat = ที่นั่งรายตัว: ตำแหน่ง, รัศมี, สถานะ, และระดับราคา
type Seat = {
  id: string;
  zoneId: string;
  rowId: string;
  x: number;
  y: number;
  r: number;
  status: SeatStatus;
  priceTier: string;
};

// ขนาดพื้นที่โลก (พิกัดภายใน) ของผังที่นั่ง
const WORLD_W = 3000;
const WORLD_H = 1800;

// เกณฑ์ซูมสำหรับ LOD (Level of Detail)
// < 0.20 = มุมมองโซน, 0.20–<0.50 = มุมมองแถว, ≥ 0.50 = มุมมองเก้าอี้
const ZONE_ZOOM = 0.20; // <0.20 → Zones (overview)
const ROW_ZOOM = 0.4; // 0.20..0.50 → Rows; ≥0.50 → Seats (exactly at 0.50)

// สีสำหรับสถานะที่นั่งและเส้นแถว
const COLOR_AVAILABLE = 0x2ecc71; // green
const COLOR_HOLD = 0xf1c40f; // yellow
const COLOR_SOLD = 0xe74c3c; // red
const COLOR_ROW = 0x95a5a6; // gray

// คืนค่าสีตามสถานะของที่นั่ง
function clrByStatus(s: SeatStatus) {
  return s === "AVAILABLE" ? COLOR_AVAILABLE : s === "HOLD" ? COLOR_HOLD : COLOR_SOLD;
}

// -------------------- Mock Data --------------------
// สร้างข้อมูลจำลองของโซน (รูปสี่เหลี่ยม + สี)
function makeZones(): Zone[] {
  const margin = 60;
  const w = (WORLD_W - margin * 4) / 3;
  const h = WORLD_H - margin * 2;
  const colors = [0x3498db, 0x9b59b6, 0x1abc9c];
  return [0, 1, 2].map((i) => {
    const x0 = margin + i * (w + margin);
    const y0 = margin;
    const polygon: [number, number][] = [
      [x0, y0],
      [x0 + w, y0],
      [x0 + w, y0 + h],
      [x0, y0 + h],
    ];
    return { id: String.fromCharCode(65 + i), polygon, bbox: [x0, y0, x0 + w, y0 + h], color: colors[i % colors.length] };
  });
}

// สร้างแถวในแต่ละโซนเป็นเส้นแนวนอน
function makeRows(zones: Zone[]): Row[] {
  const rows: Row[] = [];
  zones.forEach((z) => {
    const [x1, y1, x2, y2] = z.bbox;
    const rowCount = 14;
    const dy = (y2 - y1) / (rowCount + 1);
    for (let i = 1; i <= rowCount; i++) {
      rows.push({ id: `${z.id}-${String.fromCharCode(64 + i)}`, zoneId: z.id, y: y1 + i * dy, x1: x1 + 40, x2: x2 - 40 });
    }
  });
  return rows;
}

// สร้างที่นั่งในแต่ละแถว พร้อมสุ่มสถานะและระดับราคา
function makeSeats(rows: Row[]): Seat[] {
  const seats: Seat[] = [];
  rows.forEach((r) => {
    const per = 28;
    const dx = (r.x2 - r.x1) / (per + 1);
    for (let i = 1; i <= per; i++) {
      seats.push({
        id: `${r.id}-${i.toString().padStart(2, "0")}`,
        zoneId: r.zoneId,
        rowId: r.id,
        x: r.x1 + i * dx,
        y: r.y,
        r: 7,
        status: Math.random() < 0.07 ? "SOLD" : "AVAILABLE",
        priceTier: r.zoneId === "A" ? "P1" : r.zoneId === "B" ? "P2" : "P3",
      });
    }
  });
  return seats;
}

// คำนวณกรอบมุมมอง (bbox) ของ viewport ในพิกัดโลก
function getViewBbox(vp: Viewport) {
  const tl = vp.toWorld(0, 0);
  const br = vp.toWorld(vp.screenWidth, vp.screenHeight);
  return [Math.min(tl.x, br.x), Math.min(tl.y, br.y), Math.max(tl.x, br.x), Math.max(tl.y, br.y)] as [number, number, number, number];
}

// ตรวจว่า (x,y) อยู่ภายในกรอบ bbox หรือไม่
function inBbox(x: number, y: number, b: [number, number, number, number]) {
  return x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3];
}

// คอมโพเนนต์หลักสำหรับเรนเดอร์ผังที่นั่งแบบ LOD
export default function SeatMapLOD() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<PIXI.Application | null>(null);
  const viewportRef = useRef<Viewport | null>(null);

  // เตรียมข้อมูลโซน/แถวแบบ memoized
  const zones = useMemo(() => makeZones(), []);
  const rows = useMemo(() => makeRows(zones), [zones]);
  // สถานะที่นั่ง (เริ่มจากข้อมูลจำลอง)
  const [seats, setSeats] = useState<Seat[]>(() => makeSeats(rows));
  // เก็บค่าซูมเพื่อแสดงบน UI
  const [zoomLevel, setZoomLevel] = useState(1);
  // ข้อความช่วยเหลือ/สรุปจำนวนที่เลือกและที่เห็นในจอ
  const [info, setInfo] = useState("Drag to pan, wheel to zoom. Click a seat to select.");
  // เซ็ตของที่นั่งที่ถูกเลือก (ใช้ ref เพื่อลดการ re-render)
  const selectedIds = useRef<Set<string>>(new Set());
  // เก็บค่า seats ล่าสุดใน ref เพื่อป้องกันค่าเก่าใน closure
  const seatsRef = useRef<Seat[]>(seats);
  useEffect(() => {
    seatsRef.current = seats;
  }, [seats]);

  // จำลองการอัปเดตสถานะแบบเรียลไทม์ (สุ่ม HOLD/RELEASE)
  useEffect(() => {
    const t = setInterval(() => {
      setSeats((prev) => {
        const copy = [...prev];
        for (let i = 0; i < 20; i++) {
          const idx = Math.floor(Math.random() * copy.length);
          const s = copy[idx];
          if (!s) continue;
          if (s.status === "AVAILABLE" && Math.random() < 0.5) s.status = "HOLD";
          else if (s.status === "HOLD" && Math.random() < 0.6) s.status = "AVAILABLE";
        }
        return copy;
      });
    }, 1500);
    return () => clearInterval(t);
  }, []);

  // เริ่มต้น PixiJS และ Viewport เมื่อคอมโพเนนต์ถูก mount
  useEffect(() => {
    if (!hostRef.current) return;
    const host = hostRef.current;
    (async () => {
      // สร้างแอป Pixi พร้อมตั้งค่า antialias/resolution
      const app = new PIXI.Application();
      await app.init({ width: host.clientWidth, height: 640, antialias: true, resolution: window.devicePixelRatio || 1, autoDensity: true });
      appRef.current = app;
      host.appendChild(app.canvas);

      // ตั้งค่า Viewport: ลาก, pinch-zoom, mouse wheel, และแรงเฉื่อย
      const viewport = new Viewport({ screenWidth: app.screen.width, screenHeight: app.screen.height, worldWidth: WORLD_W, worldHeight: WORLD_H, events: app.renderer.events });
      viewport.drag().pinch().wheel({ smooth: 2 }).decelerate();
      // ซิงค์ขนาด renderer/viewport กับคอนเทนเนอร์ก่อน fit/center
      const w = host.clientWidth,
        h = 640;
      app.renderer.resize(w, h);
      viewport.resize(w, h, WORLD_W, WORLD_H);
      viewport.fit();
      viewport.moveCenter(WORLD_W / 2, WORLD_H / 2);
      viewport.scale.set(0.20); // start just under seat threshold (rows only)
      requestAnimationFrame(() => {
        viewport.fit();
        viewport.moveCenter(WORLD_W / 2, WORLD_H / 2);
        viewport.scale.set(0.20); // keep starting scale stable
      });
      app.stage.addChild(viewport);
      viewportRef.current = viewport;

      // แยกเลเยอร์ zones/rows/seats เพื่อควบคุมการแสดงตาม LOD
      const zonesLayer = new PIXI.Container();
      const rowsLayer = new PIXI.Container();
      const seatsLayer = new PIXI.Container();
      viewport.addChild(zonesLayer, rowsLayer, seatsLayer);

      // วาดโซนเป็นรูปสี่เหลี่ยมเติมสี + ป้ายชื่อ
      zones.forEach((z) => {
        const g = new PIXI.Graphics();
        g.beginFill(z.color, 0.18);
        g.lineStyle(3, z.color, 0.5);
        const [p0, p1, p2, p3] = z.polygon;
        g.moveTo(p0[0], p0[1]);
        g.lineTo(p1[0], p1[1]);
        g.lineTo(p2[0], p2[1]);
        g.lineTo(p3[0], p3[1]);
        g.closePath();
        g.endFill();
        zonesLayer.addChild(g);
        const label = new PIXI.Text({ text: `Zone ${z.id}`, style: new PIXI.TextStyle({ fill: 0x88c0ff, fontSize: 28, fontWeight: "700" }) });
        const [x1, y1, x2] = z.bbox;
        label.x = (x1 + x2) / 2 - 50;
        label.y = y1 + 10;
        zonesLayer.addChild(label);
      });

      // ฟังก์ชันวาดแถว (เส้นแนวนอน)
      function renderRows() {
        rowsLayer.removeChildren();
        rows.forEach((r) => {
          const gg = new PIXI.Graphics();
          gg.lineStyle(4, COLOR_ROW, 0.9);
          gg.moveTo(r.x1, r.y);
          gg.lineTo(r.x2, r.y);
          rowsLayer.addChild(gg);
        });
      }
      renderRows();

      // ฟังก์ชันวาดที่นั่งที่อยู่ในจอ (วงกลม + อีเวนต์คลิก)
      function renderSeats() {
        seatsLayer.removeChildren();
        const bbox = getViewBbox(viewport);
        let count = 0;
        for (const s of seatsRef.current) {
          if (!inBbox(s.x, s.y, bbox)) continue;
          const g = new PIXI.Graphics();
          const selected = selectedIds.current.has(s.id);
          g.beginFill(selected ? 0xffffff : clrByStatus(s.status));
          g.drawCircle(s.x, s.y, s.r);
          g.endFill();
          g.cursor = "pointer";
          g.eventMode = "static";
          // คลิกสลับสถานะเลือก ถ้าไม่ใช่ที่นั่ง SOLD
          g.on("pointertap", () => {
            if (s.status === "SOLD") return;
            if (selectedIds.current.has(s.id)) selectedIds.current.delete(s.id);
            else selectedIds.current.add(s.id);
            renderSeats();
            setInfo(`${selectedIds.current.size} seat(s) selected`);
          });
          seatsLayer.addChild(g);
          count++;
        }
        // อัปเดตข้อความ info: จำนวนที่เลือก และจำนวนที่นั่งที่อยู่ในจอ
        setInfo(`${selectedIds.current.size} selected • ${count} seats in view`);
      }

      // อัปเดต LOD ตามค่าซูม (viewport.scale.x)
      function updateLOD() {
        const z = viewport.scale.x;
        setZoomLevel(parseFloat(z.toFixed(2)));
        zonesLayer.visible = z < ROW_ZOOM; // แสดงโซนเมื่อซูมต่ำ
        rowsLayer.visible = z >= ZONE_ZOOM && z < ROW_ZOOM; // แสดงแถวเมื่อซูมระดับกลาง
        seatsLayer.visible = z >= ROW_ZOOM; // แสดงเก้าอี้เมื่อซูมสูง
        if (seatsLayer.visible) renderSeats(); // เรนเดอร์เก้าอี้เฉพาะเมื่อชั้น seats เปิดอยู่
      }

      // ผูกอีเวนต์ zoom/move เพื่ออัปเดต LOD และวาดที่นั่งใหม่เมื่อจำเป็น
      viewport.on("zoomed", updateLOD);
      viewport.on("moved", () => {
        if (app.ticker.lastTime && seatsLayer.visible) renderSeats();
      });
      updateLOD();

      // จัดการ resize: ปรับขนาด renderer/viewport เมื่อคอนเทนเนอร์เปลี่ยน
      const onResize = () => {
        const w = host.clientWidth,
          h = 640;
        app.renderer.resize(w, h);
        viewport.resize(w, h, WORLD_W, WORLD_H);
      };
      const ro = new ResizeObserver(onResize);
      ro.observe(host);
      onResize();

      // ทำความสะอาด (ยกเลิก observer และทำลายแอป) เมื่อ unmount
      return () => {
        ro.disconnect();
        app.destroy();
      };
    })();
  }, []);

  // รีเซ็ตมุมมองกลับไปซูมเริ่มต้นและกึ่งกลาง
  function resetView() {
    const vp = viewportRef.current;
    if (!vp) return;
    const w = hostRef.current?.clientWidth || vp.screenWidth;
    const h = 640;
    vp.resize(w, h, WORLD_W, WORLD_H);
    vp.fit();
    vp.moveCenter(WORLD_W / 2, WORLD_H / 2);
    vp.scale.set(0.20);
  }
  // แอนิเมตซูม/แพนเข้าโหมดเห็นเก้าอี้ชัด
  function zoomToSeats() {
    const vp = viewportRef.current;
    if (!vp) return;
    vp.animate({ scale: 1.6, position: { x: WORLD_W * 0.5, y: WORLD_H * 0.5 }, time: 400 });
  }

  return (
    <div className="w-full">
      {/* แถบควบคุม + แสดงค่า Zoom/LOD */}
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="text-sm opacity-80">
          Zoom: <b>{zoomLevel}</b> • LOD: {zoomLevel < ZONE_ZOOM ? "Zones" : zoomLevel < ROW_ZOOM ? "Rows" : "Seats"}
        </div>
        <div className="flex gap-2">
          <button onClick={resetView} className="px-3 py-1 rounded-2xl bg-slate-800 text-white hover:bg-slate-700">
            Reset view
          </button>
          <button onClick={zoomToSeats} className="px-3 py-1 rounded-2xl bg-indigo-600 text-white hover:bg-indigo-500">
            Zoom to seats
          </button>
        </div>
      </div>
      {/* กล่องใส่ Pixi canvas */}
      <div ref={hostRef} className="w-full rounded-2xl overflow-hidden shadow bg-[#0b1020] border border-slate-800" style={{ height: 640 }} />
      {/* คำอธิบายสีสถานะ + วิธีใช้สั้น ๆ */}
      <div className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        <Legend swatch={COLOR_AVAILABLE} label="Available" />
        <Legend swatch={COLOR_HOLD} label="Hold (TTL)" />
        <Legend swatch={COLOR_SOLD} label="Sold" />
        <div className="col-span-2 md:col-span-1 text-right opacity-80">Drag to pan • Wheel/Pinch to zoom • Click to select</div>
      </div>
    </div>
  );
}

// คอมโพเนนต์ Legend แสดงจุดสี + ป้ายข้อความ
function Legend({ swatch, label }: { swatch: number; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="inline-block w-3 h-3 rounded-full" style={{ background: `#${swatch.toString(16).padStart(6, "0")}` }} />
      <span className="opacity-80">{label}</span>
    </div>
  );
}
