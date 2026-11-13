import { Layers, LocateFixed, MapPin, Minus, Plus, Search } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type {
  KeyboardEvent,
  ReactNode,
  PointerEvent as ReactPointerEvent,
  WheelEvent,
} from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { MapPlace, MapStyle } from "../protocol.js";
import { MAP_STYLES } from "../protocol.js";
import { maps, useApp } from "../sdk/index.js";
import { cn } from "./cn.js";

/**
 * A map drawn by the kit: square tiles placed by Web Mercator maths, pins, groups of pins, routes
 * and areas. The tiles come from the free services the site inspections use (OpenStreetMap, Esri,
 * OpenTopoMap), fetched by the host, so an app adds a few kilobytes and no keys or
 * charges. Without a host (previews, screenshots) the pins still draw on a dotted background.
 */

const TILE = 256;
const MIN_ZOOM = 2;
const CLUSTER_CELL = 52;

export type LatLon = [number, number];

export type MapMarker = {
  id?: string;
  lat: number;
  lon: number;
  label?: string;
  /** neutral, accent (green, the default), success, warning, danger or a chart colour 1-6. */
  tone?: "neutral" | "accent" | "success" | "warning" | "danger" | 1 | 2 | 3 | 4 | 5 | 6;
  /** Anything the pin's card shows when it is chosen (falls back to the label). */
  detail?: ReactNode;
};

export type MapLine = { points: LatLon[]; tone?: MapMarker["tone"]; dashed?: boolean };
export type MapArea = { points: LatLon[]; tone?: MapMarker["tone"]; label?: string };

const TONE_COLOR: Record<string, string> = {
  neutral: "hsl(var(--muted-foreground))",
  accent: "hsl(var(--primary))",
  success: "hsl(var(--success))",
  warning: "hsl(var(--warning))",
  danger: "hsl(var(--destructive))",
};
const toneColor = (tone: MapMarker["tone"]) =>
  typeof tone === "number" ? `hsl(var(--chart-${tone}))` : TONE_COLOR[tone ?? "accent"]!;

const STYLE_LABELS: Record<MapStyle, string> = {
  streets: "Streets",
  light: "Light",
  dark: "Dark",
  satellite: "Satellite",
  terrain: "Terrain",
};

/** World pixels at a zoom for a point (Web Mercator, as every web map uses). */
export function project([lat, lon]: LatLon, zoom: number): { x: number; y: number } {
  const scale = TILE * 2 ** zoom;
  const sin = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999);
  return {
    x: ((lon + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

export function unproject(x: number, y: number, zoom: number): LatLon {
  const scale = TILE * 2 ** zoom;
  const lon = (x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  return [(180 / Math.PI) * Math.atan(Math.sinh(n)), lon];
}

/** The centre and zoom that show every point with some room around them. */
export function fitPoints(
  points: LatLon[],
  width: number,
  height: number,
  maxZoom = 17,
  pad = 48,
): { center: LatLon; zoom: number } {
  if (!points.length) return { center: [53.35, -6.26], zoom: 6 };
  if (points.length === 1) return { center: points[0]!, zoom: Math.min(15, maxZoom) };
  const lats = points.map((point) => point[0]);
  const lons = points.map((point) => point[1]);
  const corners: LatLon[] = [
    [Math.max(...lats), Math.min(...lons)],
    [Math.min(...lats), Math.max(...lons)],
  ];
  for (let zoom = maxZoom; zoom > MIN_ZOOM; zoom--) {
    const a = project(corners[0]!, zoom);
    const b = project(corners[1]!, zoom);
    if (b.x - a.x <= width - pad * 2 && b.y - a.y <= height - pad * 2) {
      return { center: unproject((a.x + b.x) / 2, (a.y + b.y) / 2, zoom), zoom };
    }
  }
  const a = project(corners[0]!, MIN_ZOOM);
  const b = project(corners[1]!, MIN_ZOOM);
  return { center: unproject((a.x + b.x) / 2, (a.y + b.y) / 2, MIN_ZOOM), zoom: MIN_ZOOM };
}

type Cluster = { x: number; y: number; markers: MapMarker[] };

/** Pins closer than a cell at this zoom become one numbered group. */
export function clusterMarkers(markers: MapMarker[], zoom: number, cell = CLUSTER_CELL): Cluster[] {
  const cells = new Map<string, Cluster>();
  for (const marker of markers) {
    const point = project([marker.lat, marker.lon], zoom);
    const key = `${Math.floor(point.x / cell)}:${Math.floor(point.y / cell)}`;
    const cluster = cells.get(key);
    if (cluster) {
      cluster.x = (cluster.x * cluster.markers.length + point.x) / (cluster.markers.length + 1);
      cluster.y = (cluster.y * cluster.markers.length + point.y) / (cluster.markers.length + 1);
      cluster.markers.push(marker);
    } else cells.set(key, { x: point.x, y: point.y, markers: [marker] });
  }
  return [...cells.values()];
}

function Tile({
  style,
  z,
  x,
  y,
  left,
  top,
}: {
  style: MapStyle;
  z: number;
  x: number;
  y: number;
  left: number;
  top: number;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    let live = true;
    setSrc(null);
    setShown(false);
    void maps.tile(style, z, x, y).then((url) => live && setSrc(url));
    return () => {
      live = false;
    };
  }, [style, z, x, y]);
  if (!src) return null;
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      onLoad={() => setShown(true)}
      className={cn(
        "absolute max-w-none transition-opacity duration-300 select-none",
        shown ? "opacity-100" : "opacity-0",
      )}
      style={{ left, top, width: TILE, height: TILE }}
    />
  );
}

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, size] as const;
}

export type MapViewProps = {
  markers?: MapMarker[];
  lines?: MapLine[];
  areas?: MapArea[];
  /** Where to look first (without it the map fits the pins); changing it later moves the map. */
  center?: LatLon;
  zoom?: number;
  /** "auto" follows light and dark mode. */
  mapStyle?: "auto" | MapStyle;
  /** Lets people switch between streets, satellite and terrain (default true). */
  styleSwitcher?: boolean;
  height?: number;
  /** The pin shown as chosen; controlled when given with onSelect. */
  selected?: string | null;
  onSelect?: (marker: MapMarker | null) => void;
  /** Click on empty map: where, as [lat, lon] (for "add a site here"). */
  onMapClick?: (point: LatLon) => void;
  /** Groups nearby pins into numbered bubbles (default true past 30 pins). */
  cluster?: boolean;
  className?: string;
};

/** An interactive map: drag to pan, scroll or pinch to zoom, pins that open a card. */
export function MapView({
  markers = [],
  lines = [],
  areas = [],
  center,
  zoom: startZoom,
  mapStyle = "auto",
  styleSwitcher = true,
  height = 380,
  selected,
  onSelect,
  onMapClick,
  cluster,
  className,
}: MapViewProps) {
  const { theme } = useApp();
  const [ref, size] = useSize<HTMLDivElement>();
  const [chosenStyle, setChosenStyle] = useState<MapStyle | null>(null);
  const style: MapStyle =
    chosenStyle ?? (mapStyle === "auto" ? (theme === "dark" ? "dark" : "light") : mapStyle);
  const maxZoom = MAP_STYLES[style].maxZoom;
  const [view, setView] = useState<{ center: LatLon; zoom: number } | null>(null);
  const [ownSelected, setOwnSelected] = useState<string | null>(null);
  const chosen = selected !== undefined ? selected : ownSelected;
  const [styleMenu, setStyleMenu] = useState(false);
  const points = useMemo(
    () => markers.map((marker) => [marker.lat, marker.lon] as LatLon),
    [markers],
  );
  const keyed = useMemo(
    () => markers.map((marker, index) => ({ ...marker, id: marker.id ?? String(index) })),
    [markers],
  );

  const fitAll = useCallback(() => {
    if (!size.width) return;
    const all = [
      ...points,
      ...lines.flatMap((line) => line.points),
      ...areas.flatMap((area) => area.points),
    ];
    setView(fitPoints(all, size.width, height, Math.min(maxZoom, 17)));
  }, [points, lines, areas, size.width, height, maxZoom]);

  // The first measured size sets the view: the given centre, or every pin in sight.
  const placed = useRef(false);
  useEffect(() => {
    if (placed.current || !size.width) return;
    placed.current = true;
    if (center) setView({ center, zoom: startZoom ?? 13 });
    else fitAll();
  }, [size.width, center, startZoom, fitAll]);

  // A new centre from the app (a search result, a chosen row) moves the map there.
  const lastCenter = useRef(center ? center.join(",") : "");
  useEffect(() => {
    const key = center ? center.join(",") : "";
    if (!placed.current || !center || key === lastCenter.current) return;
    lastCenter.current = key;
    setView((now) => ({ center, zoom: startZoom ?? Math.max(now?.zoom ?? 13, 13) }));
  }, [center, startZoom]);

  const current = view ?? { center: center ?? [53.35, -6.26], zoom: startZoom ?? 6 };
  const zoom = Math.min(Math.max(current.zoom, MIN_ZOOM), maxZoom);
  const middle = project(current.center, zoom);
  const origin = { x: middle.x - size.width / 2, y: middle.y - height / 2 };

  const setZoom = (next: number, around?: { x: number; y: number }) => {
    const target = Math.min(Math.max(Math.round(next), MIN_ZOOM), maxZoom);
    if (target === zoom) return;
    const anchor = around ?? { x: size.width / 2, y: height / 2 };
    const world = { x: origin.x + anchor.x, y: origin.y + anchor.y };
    const factor = 2 ** (target - zoom);
    const centre = {
      x: world.x * factor - anchor.x + size.width / 2,
      y: world.y * factor - anchor.y + height / 2,
    };
    setView({ center: unproject(centre.x, centre.y, target), zoom: target });
  };
  const panBy = (dx: number, dy: number) =>
    setView({ center: unproject(middle.x - dx, middle.y - dy, zoom), zoom });

  // Dragging and pinching: pointers are tracked so two fingers zoom and one pans.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ x: number; y: number; moved: boolean; pinch: number | null } | null>(null);
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest("[data-map-control]")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    drag.current = { x: event.clientX, y: event.clientY, moved: false, pinch: pinchDistance() };
  };
  const pinchDistance = () => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : null;
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current || !pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const distance = pinchDistance();
    if (distance && drag.current.pinch) {
      const ratio = distance / drag.current.pinch;
      if (ratio > 1.6 || ratio < 0.6) {
        setZoom(zoom + (ratio > 1 ? 1 : -1));
        drag.current.pinch = distance;
      }
      drag.current.moved = true;
      return;
    }
    const dx = event.clientX - drag.current.x;
    const dy = event.clientY - drag.current.y;
    if (!drag.current.moved && Math.hypot(dx, dy) < 4) return;
    drag.current = { ...drag.current, x: event.clientX, y: event.clientY, moved: true };
    panBy(dx, dy);
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    const state = drag.current;
    if (pointers.current.size === 0) drag.current = null;
    if (
      state &&
      !state.moved &&
      onMapClick &&
      !(event.target as Element).closest("[data-map-pin]")
    ) {
      const box = event.currentTarget.getBoundingClientRect();
      onMapClick(
        unproject(origin.x + event.clientX - box.left, origin.y + event.clientY - box.top, zoom),
      );
    }
  };
  const wheelAt = useRef(0);
  const onWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (Date.now() - wheelAt.current < 220 || Math.abs(event.deltaY) < 4) return;
    wheelAt.current = Date.now();
    const box = event.currentTarget.getBoundingClientRect();
    setZoom(zoom + (event.deltaY < 0 ? 1 : -1), {
      x: event.clientX - box.left,
      y: event.clientY - box.top,
    });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = 80;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [step, 0],
      ArrowRight: [-step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    if (moves[event.key]) {
      event.preventDefault();
      panBy(...moves[event.key]!);
    } else if (event.key === "+" || event.key === "=") setZoom(zoom + 1);
    else if (event.key === "-") setZoom(zoom - 1);
    else if (event.key === "Escape") choose(null);
  };

  const choose = (marker: MapMarker | null) => {
    if (selected === undefined) setOwnSelected(marker?.id ?? null);
    onSelect?.(marker);
  };

  const tiles: ReactNode[] = [];
  if (size.width && maps.available()) {
    const count = 2 ** zoom;
    const first = { x: Math.floor(origin.x / TILE), y: Math.floor(origin.y / TILE) };
    const last = {
      x: Math.floor((origin.x + size.width) / TILE),
      y: Math.floor((origin.y + height) / TILE),
    };
    for (let ty = Math.max(first.y, 0); ty <= Math.min(last.y, count - 1); ty++) {
      for (let tx = first.x; tx <= last.x; tx++) {
        const wrapped = ((tx % count) + count) % count;
        tiles.push(
          <Tile
            key={`${style}/${zoom}/${tx}/${ty}`}
            style={style}
            z={zoom}
            x={wrapped}
            y={ty}
            left={tx * TILE - origin.x}
            top={ty * TILE - origin.y}
          />,
        );
      }
    }
  }

  const grouped = cluster ?? keyed.length > 30;
  const clusters = grouped
    ? clusterMarkers(keyed, zoom)
    : keyed.map((marker) => {
        const point = project([marker.lat, marker.lon], zoom);
        return { x: point.x, y: point.y, markers: [marker] };
      });
  const screen = (point: LatLon) => {
    const at = project(point, zoom);
    return `${(at.x - origin.x).toFixed(1)},${(at.y - origin.y).toFixed(1)}`;
  };
  const active = keyed.find((marker) => marker.id === chosen) ?? null;
  const activePoint = active ? project([active.lat, active.lon], zoom) : null;
  const switchable: MapStyle[] =
    theme === "dark"
      ? ["dark", "streets", "satellite", "terrain"]
      : ["light", "streets", "satellite", "terrain"];

  return (
    <div
      ref={ref}
      role="application"
      aria-label="Map"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the map works from the keyboard (arrows pan, + and - zoom)
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onWheel={onWheel}
      onKeyDown={onKeyDown}
      className={cn(
        "relative touch-none overflow-hidden rounded-2xl border border-border/70 bg-muted/40 outline-none select-none focus-visible:ring-2 focus-visible:ring-ring",
        !maps.available() && "bg-dots",
        drag.current?.moved ? "cursor-grabbing" : "cursor-grab",
        className,
      )}
      style={{ height }}
    >
      {tiles}
      <svg
        className="pointer-events-none absolute inset-0"
        width={size.width}
        height={height}
        aria-hidden="true"
      >
        {areas.map((area, index) => (
          <polygon
            key={index}
            points={area.points.map(screen).join(" ")}
            fill={toneColor(area.tone)}
            fillOpacity={0.16}
            stroke={toneColor(area.tone)}
            strokeWidth={2}
          />
        ))}
        {lines.map((line, index) => (
          <polyline
            key={index}
            points={line.points.map(screen).join(" ")}
            fill="none"
            stroke={toneColor(line.tone)}
            strokeWidth={3.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={line.dashed ? "8 7" : undefined}
          />
        ))}
      </svg>
      {clusters.map((group) => {
        const left = group.x - origin.x;
        const top = group.y - origin.y;
        if (left < -40 || top < -40 || left > size.width + 40 || top > height + 40) return null;
        if (group.markers.length > 1) {
          return (
            <button
              key={`c${group.markers[0]!.id}`}
              type="button"
              data-map-pin=""
              data-map-control=""
              aria-label={`${group.markers.length} places; zoom in`}
              onClick={() => setZoom(zoom + 2, { x: left, y: top })}
              className="absolute grid size-10 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-primary text-[13px] font-bold text-primary-foreground shadow-lg ring-4 ring-primary/25 transition-transform hover:scale-110"
              style={{ left, top }}
            >
              {group.markers.length}
            </button>
          );
        }
        const marker = group.markers[0]!;
        const isActive = marker.id === chosen;
        return (
          <button
            key={marker.id}
            type="button"
            data-map-pin=""
            data-map-control=""
            aria-label={marker.label ?? "Place"}
            aria-pressed={isActive}
            onClick={() => choose(isActive ? null : marker)}
            className="group absolute -translate-x-1/2 -translate-y-full"
            style={{ left, top, zIndex: isActive ? 3 : 1 }}
          >
            <motion.span
              initial={{ y: -10, opacity: 0 }}
              animate={{ y: 0, opacity: 1, scale: isActive ? 1.18 : 1 }}
              transition={{ type: "spring", stiffness: 420, damping: 26 }}
              className="block drop-shadow-[0_4px_6px_rgb(0_0_0/0.25)]"
            >
              <svg width="30" height="38" viewBox="0 0 30 38" aria-hidden="true">
                <path
                  d="M15 37s12-12.2 12-22A12 12 0 0 0 3 15c0 9.8 12 22 12 22Z"
                  fill={toneColor(marker.tone)}
                  stroke="white"
                  strokeWidth="2"
                />
                <circle cx="15" cy="15" r="4.5" fill="white" />
              </svg>
            </motion.span>
            {marker.label && !isActive && (
              <span className="pointer-events-none absolute bottom-full left-1/2 mb-1 hidden -translate-x-1/2 rounded-md bg-foreground px-2 py-1 text-[11px] font-semibold whitespace-nowrap text-background shadow group-hover:block">
                {marker.label}
              </span>
            )}
          </button>
        );
      })}
      <AnimatePresence>
        {active && activePoint && (
          <motion.div
            key={active.id}
            data-map-control=""
            initial={{ opacity: 0, y: 6, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.18 }}
            className="absolute z-10 w-64 max-w-[80%] -translate-x-1/2 rounded-xl border border-border bg-popover p-3 text-[13px] text-popover-foreground shadow-xl"
            style={{ left: activePoint.x - origin.x, top: activePoint.y - origin.y + 8 }}
          >
            {active.label && <p className="font-semibold">{active.label}</p>}
            {active.detail && <div className="mt-1 text-muted-foreground">{active.detail}</div>}
          </motion.div>
        )}
      </AnimatePresence>
      <div data-map-control="" className="absolute top-3 right-3 flex flex-col gap-1.5">
        <div className="flex flex-col overflow-hidden rounded-xl border border-border/80 bg-card/90 shadow-sm backdrop-blur">
          <MapButton label="Zoom in" onClick={() => setZoom(zoom + 1)} disabled={zoom >= maxZoom}>
            <Plus />
          </MapButton>
          <MapButton label="Zoom out" onClick={() => setZoom(zoom - 1)} disabled={zoom <= MIN_ZOOM}>
            <Minus />
          </MapButton>
        </div>
        {points.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-border/80 bg-card/90 shadow-sm backdrop-blur">
            <MapButton label="Show every place" onClick={fitAll}>
              <LocateFixed />
            </MapButton>
          </div>
        )}
        {styleSwitcher && maps.available() && (
          <div className="relative">
            <div className="overflow-hidden rounded-xl border border-border/80 bg-card/90 shadow-sm backdrop-blur">
              <MapButton label="Map style" onClick={() => setStyleMenu((open) => !open)}>
                <Layers />
              </MapButton>
            </div>
            {styleMenu && (
              <div className="absolute top-0 right-11 flex flex-col gap-0.5 rounded-xl border border-border bg-popover p-1 shadow-lg">
                {switchable.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => {
                      setChosenStyle(option);
                      setStyleMenu(false);
                    }}
                    className={cn(
                      "rounded-lg px-3 py-1.5 text-left text-[12.5px] font-semibold whitespace-nowrap",
                      option === style ? "bg-primary/12 text-primary" : "hover:bg-muted",
                    )}
                  >
                    {STYLE_LABELS[option]}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      {maps.available() && (
        <p className="pointer-events-none absolute right-2 bottom-1.5 rounded bg-card/80 px-1.5 text-[10px] text-muted-foreground">
          {MAP_STYLES[style].attribution}
        </p>
      )}
    </div>
  );
}

function MapButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="grid size-9 place-items-center text-foreground transition-colors hover:bg-muted disabled:opacity-40 [&_svg]:size-4"
    >
      {children}
    </button>
  );
}

/** A box that finds addresses, Eircodes, postcodes and place names, then hands back the place. */
export function PlaceSearch({
  onPick,
  placeholder = "Search for an address or place",
  className,
}: {
  onPick: (place: MapPlace) => void;
  placeholder?: string;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MapPlace[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const text = query.trim();
    if (text.length < 3) {
      setResults([]);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      setBusy(true);
      maps
        .find(text)
        .then((found) => live && setResults(found))
        .catch(() => live && setResults([]))
        .finally(() => live && setBusy(false));
    }, 450);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);
  return (
    <div className={cn("relative", className)}>
      <label className="flex h-10 items-center gap-2 rounded-xl border border-input bg-card px-3 text-sm focus-within:ring-2 focus-within:ring-ring [&_svg]:size-4 [&_svg]:text-muted-foreground">
        <Search />
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={placeholder}
          disabled={!maps.available()}
          className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground"
        />
        {busy && (
          <span className="size-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        )}
      </label>
      {open && results.length > 0 && (
        <ul className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-border bg-popover p-1 shadow-lg">
          {results.map((place) => (
            <li key={`${place.lat},${place.lon}`}>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onPick(place);
                  setQuery(place.label.split(",")[0] ?? place.label);
                  setOpen(false);
                }}
                className="flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] hover:bg-muted [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-primary"
              >
                <MapPin />
                <span className="line-clamp-2">{place.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
