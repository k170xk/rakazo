import {
  Check,
  Layers,
  LocateFixed,
  MapPin,
  Minus,
  Navigation,
  Plus,
  Search,
  Undo2,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { KeyboardEvent, ReactNode, PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AppLocation, MapPlace, MapStyle } from "../protocol.js";
import { MAP_STYLES } from "../protocol.js";
import { canLocate, getLocation, maps, useApp } from "../sdk/index.js";
import { cn } from "./cn.js";
import { AssetImage, Lightbox } from "./media.js";
import { toast } from "./overlay.js";

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
  /** A picture id: the pin shows the photo as a round thumbnail and its card shows it larger. */
  photo?: string;
};

/** A shape someone drew on the map: an area (3+ corners) or a route (2+ points). */
export type MapDrawing = { kind: "area" | "line"; points: LatLon[] };

const EARTH_RADIUS = 6_371_008.8;
const radians = (degrees: number) => (degrees * Math.PI) / 180;

/** Metres along a route of points. */
export function distanceMeters(points: LatLon[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const [lat1, lon1] = points[i - 1]!;
    const [lat2, lon2] = points[i]!;
    const a =
      Math.sin(radians(lat2 - lat1) / 2) ** 2 +
      Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(radians(lon2 - lon1) / 2) ** 2;
    total += 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(a)));
  }
  return total;
}

/** Square metres inside an area's corners (on the globe, so large sites stay accurate). */
export function areaSquareMeters(points: LatLon[]): number {
  if (points.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [lat1, lon1] = points[i]!;
    const [lat2, lon2] = points[(i + 1) % points.length]!;
    sum += radians(lon2 - lon1) * (2 + Math.sin(radians(lat1)) + Math.sin(radians(lat2)));
  }
  return Math.abs((sum * EARTH_RADIUS * EARTH_RADIUS) / 2);
}

/** "350 m", "1.24 km". */
export function formatDistance(meters: number): string {
  return meters < 1000
    ? `${Math.round(meters)} m`
    : `${(meters / 1000).toFixed(meters < 10_000 ? 2 : 1)} km`;
}

/** "820 m²", "1.35 ha" (hectares past 10,000 m²). */
export function formatArea(squareMeters: number): string {
  return squareMeters < 10_000
    ? `${Math.round(squareMeters).toLocaleString("en-GB")} m²`
    : `${(squareMeters / 10_000).toFixed(2)} ha`;
}

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

type TileBox = { left: number; top: number; width: number; height: number };

/** One map square; keyed by style/z/x/y, so a tile seen before draws at once without a fade. */
function Tile({
  style,
  z,
  x,
  y,
  box,
}: {
  style: MapStyle;
  z: number;
  x: number;
  y: number;
  box: TileBox;
}) {
  const [cached] = useState(() => maps.cachedTile(style, z, x, y));
  const [src, setSrc] = useState(cached);
  const [shown, setShown] = useState(cached !== null);
  useEffect(() => {
    if (cached) return;
    let live = true;
    void maps.tile(style, z, x, y).then((url) => live && setSrc(url));
    return () => {
      live = false;
    };
  }, [cached, style, z, x, y]);
  if (!src) return null;
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      onLoad={() => setShown(true)}
      className={cn(
        "absolute max-w-none select-none",
        !cached && "transition-opacity duration-200",
        shown ? "opacity-100" : "opacity-0",
      )}
      style={box}
    />
  );
}

/** The tiles of zoom level `z` covering the view, drawn at `zoom` (fractional zooms scale them). */
function tileGrid(
  z: number,
  zoom: number,
  origin: { x: number; y: number },
  width: number,
  height: number,
) {
  const span = TILE * 2 ** (zoom - z);
  const count = 2 ** z;
  const cells: Array<{ tx: number; ty: number; x: number; box: TileBox }> = [];
  const edge = (index: number, offset: number) => Math.round(index * span - offset);
  for (
    let ty = Math.max(Math.floor(origin.y / span), 0);
    ty <= Math.min(Math.floor((origin.y + height) / span), count - 1);
    ty++
  ) {
    for (let tx = Math.floor(origin.x / span); tx <= Math.floor((origin.x + width) / span); tx++) {
      // Neighbouring tiles share rounded edges, so scaled tiles never leave hairline gaps.
      const left = edge(tx, origin.x);
      const top = edge(ty, origin.y);
      cells.push({
        tx,
        ty,
        x: ((tx % count) + count) % count,
        box: {
          left,
          top,
          width: edge(tx + 1, origin.x) - left,
          height: edge(ty + 1, origin.y) - top,
        },
      });
    }
  }
  return cells;
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
  /** A "show my location" button (default true where the device can share it). */
  locate?: boolean;
  /** Hears the device's position each time the person shows their location. */
  onLocate?: (here: AppLocation) => void;
  /**
   * Draw mode: taps add corners of an area or points of a route, with its size shown, until the
   * person taps Done (onDraw hears the shape) or Cancel (onDrawCancel). null or omitted: off.
   */
  draw?: "area" | "line" | null;
  onDraw?: (shape: MapDrawing) => void;
  onDrawCancel?: () => void;
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
  locate,
  onLocate,
  draw = null,
  onDraw,
  onDrawCancel,
  className,
}: MapViewProps) {
  const { theme } = useApp();
  const [draft, setDraft] = useState<LatLon[]>([]);
  const [here, setHere] = useState<AppLocation | null>(null);
  const [locating, setLocating] = useState(false);
  const canShowHere = (locate ?? true) && canLocate();
  useEffect(() => setDraft([]), [draw]);
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

  const fallback = { center: center ?? ([53.35, -6.26] as LatLon), zoom: startZoom ?? 6 };
  const current = view ?? fallback;
  const clampZoom = (value: number) => Math.min(Math.max(value, MIN_ZOOM), maxZoom);
  // Zoom is continuous: pinches and trackpads move through it smoothly, and tiles of the nearest
  // whole level are scaled to fit until the next level's arrive.
  const zoom = clampZoom(current.zoom);
  const tileZoom = clampZoom(Math.round(zoom));
  const middle = project(current.center, zoom);
  const origin = { x: middle.x - size.width / 2, y: middle.y - height / 2 };

  /** The view with `point` drawn at `screen` (pixels in the map) at zoom `z`. */
  const viewWith = (point: LatLon, screen: { x: number; y: number }, z: number) => {
    const at = project(point, z);
    return {
      center: unproject(at.x - screen.x + size.width / 2, at.y - screen.y + height / 2, z),
      zoom: z,
    };
  };
  /** What sits under `screen` in `now`. */
  const pointUnder = (now: { center: LatLon; zoom: number }, screen: { x: number; y: number }) => {
    const z = clampZoom(now.zoom);
    const at = project(now.center, z);
    return unproject(at.x - size.width / 2 + screen.x, at.y - height / 2 + screen.y, z);
  };
  const middleOfMap = () => ({ x: size.width / 2, y: height / 2 });
  // Updates read the latest view, so several events between two renders all count.
  const zoomAround = (next: (z: number) => number, screen = middleOfMap()) =>
    setView((now) => {
      const base = now ?? fallback;
      return viewWith(pointUnder(base, screen), screen, clampZoom(next(clampZoom(base.zoom))));
    });
  const panBy = (dx: number, dy: number) =>
    setView((now) => {
      const base = now ?? fallback;
      const z = clampZoom(base.zoom);
      const at = project(base.center, z);
      return { center: unproject(at.x - dx, at.y - dy, z), zoom: z };
    });

  // Buttons, keys and groups glide to the next whole level instead of jumping.
  const glide = useRef(0);
  const stopGlide = () => cancelAnimationFrame(glide.current);
  const setZoom = (target: number, screen = middleOfMap()) => {
    stopGlide();
    const to = clampZoom(target);
    const from = zoom;
    if (Math.abs(to - from) < 0.001) return;
    const point = pointUnder(current, screen);
    const started = performance.now();
    const step = (time: number) => {
      const t = Math.min((time - started) / 240, 1);
      const eased = 1 - (1 - t) ** 3;
      setView(viewWith(point, screen, from + (to - from) * eased));
      if (t < 1) glide.current = requestAnimationFrame(step);
    };
    glide.current = requestAnimationFrame(step);
  };
  useEffect(() => stopGlide, []);
  const zoomIn = (screen?: { x: number; y: number }, levels = 1) =>
    setZoom(Math.floor(zoom + 0.001) + levels, screen);
  const zoomOut = () => setZoom(Math.ceil(zoom - 0.001) - 1);

  // Dragging and pinching: one finger pans; two zoom around the point between them and pan with it.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{
    x: number;
    y: number;
    moved: boolean;
    pinch: { distance: number; zoom: number; point: LatLon } | null;
  } | null>(null);
  const local = (element: Element, x: number, y: number) => {
    const box = element.getBoundingClientRect();
    return { x: x - box.left, y: y - box.top };
  };
  const pinchState = () => {
    const [a, b] = [...pointers.current.values()];
    if (!a || !b) return null;
    return {
      distance: Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1),
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
    };
  };
  const startPinch = (element: Element) => {
    const two = pinchState();
    if (!two || !drag.current) return;
    drag.current.pinch = {
      distance: two.distance,
      zoom,
      point: pointUnder(current, local(element, two.x, two.y)),
    };
    drag.current.moved = true;
  };
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest("[data-map-control]")) return;
    stopGlide();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (!drag.current)
      drag.current = { x: event.clientX, y: event.clientY, moved: false, pinch: null };
    if (pointers.current.size === 2) startPinch(event.currentTarget);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current || !pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const pinch = drag.current.pinch;
    const two = pinch ? pinchState() : null;
    if (pinch && two) {
      const z = clampZoom(pinch.zoom + Math.log2(two.distance / pinch.distance));
      setView(viewWith(pinch.point, local(event.currentTarget, two.x, two.y), z));
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
    else if (drag.current) {
      // Lifting one finger of a pinch carries on as a pan from where the other finger is.
      const [rest] = [...pointers.current.values()];
      drag.current = { ...drag.current, x: rest!.x, y: rest!.y, pinch: null };
      if (pointers.current.size >= 2) startPinch(event.currentTarget);
    }
    if (
      state &&
      !state.moved &&
      (onMapClick || draw) &&
      !(event.target as Element).closest("[data-map-pin],[data-map-control]")
    ) {
      const box = event.currentTarget.getBoundingClientRect();
      const point = unproject(
        origin.x + event.clientX - box.left,
        origin.y + event.clientY - box.top,
        zoom,
      );
      if (draw) setDraft((points) => [...points, point].slice(0, 500));
      else onMapClick?.(point);
    }
  };
  // The wheel listener is attached natively, non-passive, so the page neither scrolls nor
  // browser-zooms (trackpad pinches arrive as ctrl+wheel) while the map zooms.
  const onWheel = useRef<(event: globalThis.WheelEvent) => void>(() => {});
  onWheel.current = (event) => {
    event.preventDefault();
    stopGlide();
    const lines = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1;
    // Trackpad pinches send small exact steps; a mouse notch is about a third of a level.
    const delta = Math.max(
      -1,
      Math.min(1, -event.deltaY * lines * (event.ctrlKey ? 0.012 : 0.0035)),
    );
    if (!delta) return;
    zoomAround(
      (z) => z + delta,
      local(event.currentTarget as Element, event.clientX, event.clientY),
    );
  };
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const listener = (event: globalThis.WheelEvent) => onWheel.current(event);
    element.addEventListener("wheel", listener, { passive: false });
    return () => element.removeEventListener("wheel", listener);
  }, [ref]);
  // Safari sends its own pinch gestures on a Mac trackpad; the wheel handles the zoom.
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const block = (event: Event) => event.preventDefault();
    element.addEventListener("gesturestart", block);
    element.addEventListener("gesturechange", block);
    return () => {
      element.removeEventListener("gesturestart", block);
      element.removeEventListener("gesturechange", block);
    };
  }, [ref]);
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
    } else if (event.key === "+" || event.key === "=") zoomIn();
    else if (event.key === "-") zoomOut();
    else if (event.key === "Escape") {
      if (draw) onDrawCancel?.();
      else choose(null);
    } else if (event.key === "Enter" && draw) finishDrawing();
    else if (event.key === "Backspace" && draw) setDraft((points) => points.slice(0, -1));
  };

  const showHere = async () => {
    setLocating(true);
    try {
      const found = await getLocation();
      setHere(found);
      setView({ center: [found.lat, found.lon], zoom: Math.max(zoom, Math.min(17, maxZoom)) });
      onLocate?.(found);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Your location couldn't be found.");
    } finally {
      setLocating(false);
    }
  };
  const drawReady = draw === "area" ? draft.length >= 3 : draft.length >= 2;
  const finishDrawing = () => {
    if (!draw || !drawReady) return;
    onDraw?.({ kind: draw, points: draft });
    setDraft([]);
  };

  const choose = (marker: MapMarker | null) => {
    if (selected === undefined) setOwnSelected(marker?.id ?? null);
    onSelect?.(marker);
  };

  const tiles: ReactNode[] = [];
  if (size.width && maps.available()) {
    // Squares already fetched at the neighbouring levels sit underneath, scaled, so the map
    // never blanks while the current level's squares load.
    for (const z of [tileZoom - 1, tileZoom + 1]) {
      if (z < MIN_ZOOM || z > maxZoom) continue;
      for (const cell of tileGrid(z, zoom, origin, size.width, height)) {
        const src = maps.cachedTile(style, z, cell.x, cell.ty);
        if (src)
          tiles.push(
            <img
              key={`${style}/${z}/${cell.tx}/${cell.ty}`}
              src={src}
              alt=""
              draggable={false}
              className="absolute max-w-none select-none"
              style={cell.box}
            />,
          );
      }
    }
    for (const cell of tileGrid(tileZoom, zoom, origin, size.width, height)) {
      tiles.push(
        <Tile
          key={`${style}/${tileZoom}/${cell.tx}/${cell.ty}`}
          style={style}
          z={tileZoom}
          x={cell.x}
          y={cell.ty}
          box={cell.box}
        />,
      );
    }
  }

  const grouped = cluster ?? keyed.length > 30;
  // Groups are formed at the whole level below and moved with the zoom, so they don't
  // regroup on every step of a pinch.
  const groupZoom = Math.floor(zoom);
  const groupScale = 2 ** (zoom - groupZoom);
  const clusters = grouped
    ? clusterMarkers(keyed, groupZoom).map((group) => ({
        ...group,
        x: group.x * groupScale,
        y: group.y * groupScale,
      }))
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
      onKeyDown={onKeyDown}
      className={cn(
        "relative touch-none overflow-hidden rounded-2xl border border-border/70 bg-muted/40 outline-none select-none focus-visible:ring-2 focus-visible:ring-ring",
        !maps.available() && "bg-dots",
        draw ? "cursor-crosshair" : drag.current?.moved ? "cursor-grabbing" : "cursor-grab",
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
        {here &&
          (() => {
            const [x, y] = screen([here.lat, here.lon]).split(",").map(Number) as [number, number];
            const perPixel = (156_543.03392 * Math.cos(radians(here.lat))) / 2 ** zoom;
            return (
              <g>
                <circle
                  cx={x}
                  cy={y}
                  r={Math.max(here.accuracy / perPixel, 9)}
                  fill="hsl(var(--info))"
                  fillOpacity={0.12}
                  stroke="hsl(var(--info))"
                  strokeOpacity={0.4}
                />
                <circle
                  cx={x}
                  cy={y}
                  r={7}
                  fill="hsl(var(--info))"
                  stroke="white"
                  strokeWidth={3}
                />
              </g>
            );
          })()}
        {draw && draft.length > 0 && (
          <g>
            {draw === "area" && draft.length >= 3 ? (
              <polygon
                points={draft.map(screen).join(" ")}
                fill="hsl(var(--primary))"
                fillOpacity={0.18}
                stroke="hsl(var(--primary))"
                strokeWidth={2.5}
                strokeDasharray="7 5"
              />
            ) : (
              <polyline
                points={draft.map(screen).join(" ")}
                fill="none"
                stroke="hsl(var(--primary))"
                strokeWidth={3}
                strokeDasharray="7 5"
              />
            )}
            {draft.map((point, index) => {
              const [x, y] = screen(point).split(",").map(Number) as [number, number];
              return (
                <circle
                  key={index}
                  cx={x}
                  cy={y}
                  r={index === 0 ? 6.5 : 5}
                  fill="white"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2.5}
                />
              );
            })}
          </g>
        )}
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
              onClick={() => zoomIn({ x: left, y: top }, 2)}
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
              {marker.photo ? (
                <span className="flex flex-col items-center">
                  <span
                    className="block size-11 overflow-hidden rounded-full border-[3px] bg-muted"
                    style={{ borderColor: toneColor(marker.tone) }}
                  >
                    <AssetImage asset={marker.photo} className="h-full w-full" />
                  </span>
                  <span
                    className="-mt-px h-2 w-0.5"
                    style={{ background: toneColor(marker.tone) }}
                  />
                </span>
              ) : (
                <svg width="30" height="38" viewBox="0 0 30 38" aria-hidden="true">
                  <path
                    d="M15 37s12-12.2 12-22A12 12 0 0 0 3 15c0 9.8 12 22 12 22Z"
                    fill={toneColor(marker.tone)}
                    stroke="white"
                    strokeWidth="2"
                  />
                  <circle cx="15" cy="15" r="4.5" fill="white" />
                </svg>
              )}
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
            {active.photo && (
              <AssetImage asset={active.photo} className="mb-2 h-36 w-full rounded-lg" />
            )}
            {active.label && <p className="font-semibold">{active.label}</p>}
            {active.detail && <div className="mt-1 text-muted-foreground">{active.detail}</div>}
          </motion.div>
        )}
      </AnimatePresence>
      <div data-map-control="" className="absolute top-3 right-3 flex flex-col gap-1.5">
        <div className="flex flex-col overflow-hidden rounded-xl border border-border/80 bg-card/90 shadow-sm backdrop-blur">
          <MapButton label="Zoom in" onClick={() => zoomIn()} disabled={zoom >= maxZoom}>
            <Plus />
          </MapButton>
          <MapButton label="Zoom out" onClick={zoomOut} disabled={zoom <= MIN_ZOOM}>
            <Minus />
          </MapButton>
        </div>
        {(points.length > 0 || canShowHere) && (
          <div className="flex flex-col overflow-hidden rounded-xl border border-border/80 bg-card/90 shadow-sm backdrop-blur">
            {canShowHere && (
              <MapButton label="Show my location" onClick={showHere} disabled={locating}>
                <Navigation className={cn(locating && "animate-pulse", here && "fill-current")} />
              </MapButton>
            )}
            {points.length > 0 && (
              <MapButton label="Show every place" onClick={fitAll}>
                <LocateFixed />
              </MapButton>
            )}
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
      {draw && (
        <div
          data-map-control=""
          className="absolute bottom-7 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-border bg-card/95 p-1 pl-3 text-[12.5px] shadow-lg backdrop-blur"
        >
          <span className="mr-1 font-semibold whitespace-nowrap">
            {draft.length === 0
              ? draw === "area"
                ? "Tap the corners of the area"
                : "Tap along the route"
              : draw === "area" && draft.length >= 3
                ? formatArea(areaSquareMeters(draft))
                : formatDistance(distanceMeters(draft))}
          </span>
          <MapButton
            label="Undo last point"
            onClick={() => setDraft((points) => points.slice(0, -1))}
            disabled={!draft.length}
          >
            <Undo2 />
          </MapButton>
          {onDrawCancel && (
            <MapButton label="Cancel drawing" onClick={onDrawCancel}>
              <X />
            </MapButton>
          )}
          <button
            type="button"
            onClick={finishDrawing}
            disabled={!drawReady}
            className="flex h-9 items-center gap-1 rounded-lg bg-primary px-3 font-semibold text-primary-foreground disabled:opacity-40"
          >
            <Check className="size-4" />
            Done
          </button>
        </div>
      )}
      {maps.available() && (
        <p className="pointer-events-none absolute right-2 bottom-1.5 rounded bg-card/80 px-1.5 text-[10px] text-muted-foreground">
          {MAP_STYLES[style].attribution}
        </p>
      )}
    </div>
  );
}

/** A geotagged photo for PhotoMap: a picture id with where (and when) it was taken. */
export type MapPhoto = {
  photo: string;
  lat?: number | null;
  lon?: number | null;
  label?: string;
  takenAt?: string | null;
  tone?: MapMarker["tone"];
};

/**
 * Site photos on a map: each located photo is a round thumbnail pin, with a strip of every photo
 * underneath (those without a location are marked) and full-size viewing.
 */
export function PhotoMap({
  photos,
  height = 420,
  mapStyle = "satellite",
  className,
}: {
  photos: MapPhoto[];
  height?: number;
  mapStyle?: MapViewProps["mapStyle"];
  className?: string;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [center, setCenter] = useState<LatLon | undefined>(undefined);
  const ids = photos.map((item) => item.photo);
  const captions = photos.map((item) =>
    [item.label, item.takenAt ? new Date(item.takenAt).toLocaleString("en-GB") : null]
      .filter(Boolean)
      .join(" · "),
  );
  const markers: MapMarker[] = photos.flatMap((item, index) =>
    typeof item.lat === "number" && typeof item.lon === "number"
      ? [
          {
            id: String(index),
            lat: item.lat,
            lon: item.lon,
            photo: item.photo,
            ...(item.tone ? { tone: item.tone } : {}),
            ...(item.label ? { label: item.label } : {}),
            detail: (
              <div className="space-y-1.5">
                {item.takenAt && <p>{new Date(item.takenAt).toLocaleString("en-GB")}</p>}
                <button
                  type="button"
                  onClick={() => setOpen(index)}
                  className="font-semibold text-primary hover:underline"
                >
                  View full size
                </button>
              </div>
            ),
          },
        ]
      : [],
  );
  return (
    <div className={cn("space-y-2", className)}>
      <MapView
        markers={markers}
        height={height}
        mapStyle={mapStyle}
        selected={selected}
        onSelect={(marker) => setSelected(marker?.id ?? null)}
        {...(center ? { center } : {})}
      />
      {photos.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {photos.map((item, index) => {
            const located = typeof item.lat === "number" && typeof item.lon === "number";
            return (
              <button
                key={`${item.photo}-${index}`}
                type="button"
                onClick={() => {
                  if (!located) return setOpen(index);
                  setSelected(String(index));
                  setCenter([item.lat as number, item.lon as number]);
                }}
                className={cn(
                  "relative size-16 shrink-0 overflow-hidden rounded-lg ring-2 transition",
                  selected === String(index)
                    ? "ring-primary"
                    : "ring-transparent hover:ring-border",
                )}
              >
                <AssetImage asset={item.photo} className="h-full w-full" />
                {!located && (
                  <span className="absolute inset-x-0 bottom-0 bg-black/60 py-0.5 text-[9.5px] font-semibold text-white">
                    No location
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      <Lightbox ids={ids} captions={captions} index={open} onIndex={setOpen} />
    </div>
  );
}

/**
 * Records a walked route from the device's position. Call start from a tap; points are added
 * every few seconds while the app stays open and the person has moved, ignoring poor fixes.
 */
export function useRouteRecorder({
  every = 5000,
  minMeters = 5,
  maxAccuracy = 50,
}: {
  every?: number;
  minMeters?: number;
  maxAccuracy?: number;
} = {}) {
  const [points, setPoints] = useState<LatLon[]>([]);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const add = useCallback(
    (here: AppLocation) => {
      if (here.accuracy > maxAccuracy) return;
      setPoints((now) => {
        const last = now[now.length - 1];
        const next: LatLon = [here.lat, here.lon];
        if (last && distanceMeters([last, next]) < minMeters) return now;
        return [...now, next].slice(-5000);
      });
    },
    [maxAccuracy, minMeters],
  );
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(
      () => {
        void getLocation().then(add, () => undefined);
      },
      Math.max(every, 2000),
    );
    return () => clearInterval(timer);
  }, [recording, every, add]);
  const start = async () => {
    setError(null);
    try {
      add(await getLocation());
      setRecording(true);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "Location isn't available.");
    }
  };
  return {
    points,
    recording,
    error,
    meters: distanceMeters(points),
    start,
    stop: () => setRecording(false),
    clear: () => setPoints([]),
  };
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
