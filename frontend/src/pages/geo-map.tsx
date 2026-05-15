import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from "react-leaflet";
import MarkerClusterGroup from "react-leaflet-cluster";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  RefreshCw, Wifi, WifiOff, Monitor, Clock, Server, Users,
  ArrowUpDown, ChevronDown, ChevronUp, Pause, Play,
} from "lucide-react";
import { useAuth } from "@/contexts/auth";
import { api } from "@/lib/api";
import type { GeoMapResponse, GeoMapNode } from "@/lib/api";
import { cn } from "@/lib/utils";

const TILE_URL = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png";
const TILE_ATTR = '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>';

const NODE_COLORS: Record<string, string> = {
  online: "#22c55e",
  offline: "#6b7280",
};

const LINE_PALETTE = [
  "#3b82f6", "#8b5cf6", "#ec4899", "#f59e0b", "#14b8a6",
  "#f43f5e", "#06b6d4", "#a855f7", "#10b981", "#f97316",
];

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatSpeed(bytesPerSec: number): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function createNodeIcon(node: GeoMapNode): L.DivIcon {
  const color = node.isConnected ? NODE_COLORS.online : NODE_COLORS.offline;
  const flag = node.countryCode
    ? node.countryCode
        .toUpperCase()
        .replace(/./g, (c) => String.fromCodePoint(0x1f1e6 - 65 + c.charCodeAt(0)))
    : "";

  return L.divIcon({
    className: "geo-map-node-icon",
    html: `<div style="
      display:flex;align-items:center;justify-content:center;
      width:44px;height:44px;border-radius:50%;
      background:${color}22;border:2px solid ${color};
      box-shadow:0 0 12px ${color}66;
      font-size:20px;position:relative;
    ">
      <span>${flag || "🖥"}</span>
      ${node.usersOnline > 0 ? `<span style="
        position:absolute;top:-4px;right:-4px;
        background:#3b82f6;color:white;
        font-size:10px;font-weight:bold;
        min-width:18px;height:18px;border-radius:9px;
        display:flex;align-items:center;justify-content:center;
        padding:0 4px;box-shadow:0 0 6px #3b82f688;
      ">${node.usersOnline}</span>` : ""}
    </div>`,
    iconSize: [44, 44],
    iconAnchor: [22, 22],
    popupAnchor: [0, -22],
  });
}

function createUserIcon(): L.DivIcon {
  return L.divIcon({
    className: "geo-map-user-icon",
    html: `<div style="
      width:12px;height:12px;border-radius:50%;
      background:#60a5fa;border:2px solid #2563eb;
      box-shadow:0 0 6px #3b82f688;
    "></div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
    popupAnchor: [0, -8],
  });
}

const userIcon = createUserIcon();

function FitBounds({ nodes }: { nodes: GeoMapNode[] }) {
  const map = useMap();
  const fitted = useRef(false);

  useEffect(() => {
    if (nodes.length === 0 || fitted.current) return;
    const bounds = L.latLngBounds(nodes.map((n) => [n.lat, n.lng]));
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 6 });
      fitted.current = true;
    }
  }, [nodes, map]);

  return null;
}

export function GeoMapPage() {
  const { state } = useAuth();
  const token = state.accessToken ?? "";
  const [data, setData] = useState<GeoMapResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoPolling, setAutoPolling] = useState(true);
  const [pollingInterval] = useState(30);
  const [selectedNodes, setSelectedNodes] = useState<Set<string>>(new Set());
  const [panelOpen, setPanelOpen] = useState(true);

  const fetchData = useCallback(async (force = false) => {
    if (!token) return;
    try {
      const result = force
        ? await api.refreshGeoMap(token)
        : await api.getGeoMapData(token);
      setData(result);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load map data");
    }
  }, [token]);

  useEffect(() => {
    setLoading(true);
    fetchData().finally(() => setLoading(false));
  }, [fetchData]);

  useEffect(() => {
    if (!autoPolling || !token) return;
    const id = window.setInterval(() => fetchData(), pollingInterval * 1000);
    return () => window.clearInterval(id);
  }, [autoPolling, pollingInterval, fetchData, token]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchData(true);
    setRefreshing(false);
  };

  const filteredConnections = useMemo(() => {
    if (!data) return [];
    if (selectedNodes.size === 0) return data.connections;
    return data.connections.filter((c) => selectedNodes.has(c.nodeUuid));
  }, [data, selectedNodes]);

  const filteredNodes = useMemo(() => {
    if (!data) return [];
    if (selectedNodes.size === 0) return data.nodes;
    return data.nodes.filter((n) => selectedNodes.has(n.uuid));
  }, [data, selectedNodes]);

  const nodeColorMap = useMemo(() => {
    const map = new Map<string, string>();
    if (!data) return map;
    data.nodes.forEach((n, i) => map.set(n.uuid, LINE_PALETTE[i % LINE_PALETTE.length]));
    return map;
  }, [data]);

  const totalTraffic = useMemo(() => {
    if (!data) return 0;
    return data.nodes.reduce((sum, n) => sum + n.trafficUsedBytes, 0);
  }, [data]);

  const toggleNode = (uuid: string) => {
    setSelectedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(uuid)) next.delete(uuid);
      else next.add(uuid);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-8rem)]">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-muted-foreground font-mono text-sm">Loading map data...</p>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-8rem)]">
        <div className="flex flex-col items-center gap-4 text-center">
          <WifiOff className="h-12 w-12 text-red-500/60" />
          <p className="text-red-500 font-mono">{error}</p>
          <button onClick={() => fetchData()} className="text-sm text-primary hover:underline font-mono">
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-[calc(100vh-8rem)] rounded-xl overflow-hidden border border-white/10">
      <style>{`
        .geo-map-node-icon, .geo-map-user-icon { background: none !important; border: none !important; }
        .leaflet-popup-content-wrapper {
          background: hsl(var(--card)) !important;
          color: hsl(var(--card-foreground)) !important;
          border: 1px solid hsl(var(--border)) !important;
          border-radius: 12px !important;
          box-shadow: 0 8px 32px rgba(0,0,0,0.4) !important;
          backdrop-filter: blur(12px);
        }
        .leaflet-popup-tip { background: hsl(var(--card)) !important; }
        .leaflet-popup-content { margin: 12px 16px !important; font-family: ui-monospace, monospace; font-size: 13px; }
        .marker-cluster div { background: #3b82f6cc !important; color: white !important; font-weight: bold; font-size: 12px; }
        .marker-cluster { background: #3b82f644 !important; }
      `}</style>

      <MapContainer
        center={[30, 10]}
        zoom={3}
        minZoom={2}
        maxZoom={18}
        className="h-full w-full z-0"
        zoomControl={false}
        attributionControl={false}
      >
        <TileLayer url={TILE_URL} attribution={TILE_ATTR} />
        {data && <FitBounds nodes={data.nodes} />}

        {filteredNodes.map((node) => (
          <Marker key={node.uuid} position={[node.lat, node.lng]} icon={createNodeIcon(node)}>
            <Popup>
              <div className="space-y-2 min-w-[200px]">
                <div className="flex items-center gap-2">
                  <span className={cn("h-2 w-2 rounded-full", node.isConnected ? "bg-green-500" : "bg-gray-500")} />
                  <span className="font-bold text-sm">{node.name}</span>
                </div>
                <div className="space-y-1 text-xs opacity-80">
                  <div className="flex justify-between">
                    <span>Country</span>
                    <span>{node.countryCode.toUpperCase()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Online</span>
                    <span>{node.usersOnline}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Speed ↓</span>
                    <span>{formatSpeed(node.rxBytesPerSec)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Speed ↑</span>
                    <span>{formatSpeed(node.txBytesPerSec)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Traffic</span>
                    <span>
                      {formatBytes(node.trafficUsedBytes)}
                      {node.trafficLimitBytes ? ` / ${formatBytes(node.trafficLimitBytes)}` : ""}
                    </span>
                  </div>
                </div>
              </div>
            </Popup>
          </Marker>
        ))}

        {filteredConnections.map((conn, i) => {
          const node = data?.nodes.find((n) => n.uuid === conn.nodeUuid);
          if (!node) return null;
          const color = nodeColorMap.get(conn.nodeUuid) ?? "#3b82f6";
          const weight = Math.max(1, Math.min(4, Math.log10(conn.trafficBytes + 1) / 3));

          return (
            <Polyline
              key={`line-${i}`}
              positions={[[node.lat, node.lng], [conn.lat, conn.lng]]}
              pathOptions={{ color, weight, opacity: 0.35, dashArray: "6 4" }}
            />
          );
        })}

        <MarkerClusterGroup chunkedLoading maxClusterRadius={40}>
          {filteredConnections.map((conn, i) => (
            <Marker key={`user-${i}`} position={[conn.lat, conn.lng]} icon={userIcon}>
              <Popup>
                <div className="space-y-2 min-w-[180px]">
                  <div className="font-bold text-sm">{conn.username}</div>
                  <div className="space-y-1 text-xs opacity-80">
                    <div className="flex justify-between">
                      <span>IP</span>
                      <span className="font-mono">{conn.ip}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Traffic</span>
                      <span>{formatBytes(conn.trafficBytes)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Last seen</span>
                      <span>{timeAgo(conn.lastSeen)}</span>
                    </div>
                    {conn.device && (
                      <>
                        <div className="flex justify-between">
                          <span>Device</span>
                          <span>{conn.device.deviceModel || conn.device.platform}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>OS</span>
                          <span>{conn.device.platform} {conn.device.osVersion}</span>
                        </div>
                      </>
                    )}
                    <div className="flex justify-between">
                      <span>Node</span>
                      <span>{data?.nodes.find((n) => n.uuid === conn.nodeUuid)?.name ?? "—"}</span>
                    </div>
                  </div>
                </div>
              </Popup>
            </Marker>
          ))}
        </MarkerClusterGroup>
      </MapContainer>

      {/* Control panel overlay */}
      <div className="absolute top-3 right-3 z-[1000] w-72">
        <div className="rounded-xl border border-white/10 bg-card/90 backdrop-blur-xl shadow-2xl overflow-hidden">
          <button
            onClick={() => setPanelOpen(!panelOpen)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/5 transition-colors"
          >
            <span className="text-xs font-mono font-bold tracking-wider uppercase text-primary">
              Node Map Control
            </span>
            {panelOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </button>

          {panelOpen && (
            <div className="border-t border-white/10 p-4 space-y-4">
              {/* Stats */}
              <div className="grid grid-cols-3 gap-2">
                <div className="text-center">
                  <Server className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
                  <div className="text-sm font-bold">{data?.nodes.length ?? 0}</div>
                  <div className="text-[10px] text-muted-foreground">Nodes</div>
                </div>
                <div className="text-center">
                  <Users className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
                  <div className="text-sm font-bold">{filteredConnections.length}</div>
                  <div className="text-[10px] text-muted-foreground">Clients</div>
                </div>
                <div className="text-center">
                  <ArrowUpDown className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
                  <div className="text-sm font-bold">{formatBytes(totalTraffic)}</div>
                  <div className="text-[10px] text-muted-foreground">Traffic</div>
                </div>
              </div>

              {/* Controls */}
              <div className="flex items-center gap-2">
                <button
                  onClick={handleRefresh}
                  disabled={refreshing}
                  className={cn(
                    "flex-1 flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-mono font-bold transition-all",
                    "bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20",
                    refreshing && "opacity-50 pointer-events-none",
                  )}
                >
                  <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
                  {refreshing ? "Updating..." : "Refresh"}
                </button>
                <button
                  onClick={() => setAutoPolling(!autoPolling)}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-mono transition-all border",
                    autoPolling
                      ? "bg-green-500/10 border-green-500/20 text-green-500"
                      : "bg-muted/30 border-white/10 text-muted-foreground",
                  )}
                >
                  {autoPolling ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  {autoPolling ? "Auto" : "Off"}
                </button>
              </div>

              {/* Last updated */}
              {data?.updatedAt && (
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground font-mono">
                  <Clock className="h-3 w-3" />
                  Updated: {timeAgo(data.updatedAt)}
                  {autoPolling && <span className="text-green-500">· polling {pollingInterval}s</span>}
                </div>
              )}

              {/* Node filter */}
              {data && data.nodes.length > 0 && (
                <div>
                  <div className="text-[11px] font-mono font-bold text-muted-foreground uppercase tracking-wider mb-2">
                    Filter by node
                  </div>
                  <div className="space-y-1 max-h-48 overflow-y-auto pr-1 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-white/10 [&::-webkit-scrollbar-thumb]:rounded-full">
                    {data.nodes.map((node) => {
                      const isSelected = selectedNodes.size === 0 || selectedNodes.has(node.uuid);
                      const color = nodeColorMap.get(node.uuid) ?? "#3b82f6";
                      return (
                        <button
                          key={node.uuid}
                          onClick={() => toggleNode(node.uuid)}
                          className={cn(
                            "w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-all text-xs",
                            isSelected ? "bg-white/5" : "opacity-40 hover:opacity-70",
                          )}
                        >
                          <span
                            className="h-2.5 w-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: color, boxShadow: `0 0 6px ${color}66` }}
                          />
                          <span className="flex-1 truncate font-mono">{node.name}</span>
                          <span className="flex items-center gap-1 text-muted-foreground">
                            {node.isConnected ? (
                              <Wifi className="h-3 w-3 text-green-500" />
                            ) : (
                              <WifiOff className="h-3 w-3 text-gray-500" />
                            )}
                            <Monitor className="h-3 w-3" />
                            <span>{node.usersOnline}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  {selectedNodes.size > 0 && (
                    <button
                      onClick={() => setSelectedNodes(new Set())}
                      className="mt-2 text-[11px] text-primary hover:underline font-mono"
                    >
                      Show all nodes
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
