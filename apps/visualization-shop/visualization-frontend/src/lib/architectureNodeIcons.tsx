"use client";

import type { ReactNode } from "react";
import { groupPalette } from "@/data/architecture";
import {
  Bell,
  Boxes,
  CreditCard,
  Database,
  FileText,
  Globe,
  Inbox,
  MessagesSquare,
  Monitor,
  Package,
  Radio,
  ShoppingCart,
  Truck,
  User,
} from "lucide-react";

const SZ = 22;
const stroke = 2;

/** Matches `groupPalette.infra.border` / queue border — icon stroke for infra-class nodes. */
const INFRA_ICON_STROKE = groupPalette.infra.border;

function wrap(children: ReactNode) {
  return <span className="pointer-events-none shrink-0 select-none">{children}</span>;
}

/**
 * Small colored glyph for static architecture nodes (preview / exploration).
 */
export function ArchitectureGlyph({
  id,
  fontTitlePx,
}: {
  id: string;
  /** Slightly scale icon when service titles use the larger font */
  fontTitlePx?: number;
}) {
  const size = fontTitlePx && fontTitlePx >= 17 ? Math.round(SZ * 1.08) : SZ;
  const p = { size, strokeWidth: stroke, "aria-hidden": true as const };

  if (id === "user") {
    return wrap(<User {...p} style={{ color: "#0F172A" }} />);
  }
  if (id === "ingress") {
    return wrap(<Globe {...p} style={{ color: INFRA_ICON_STROKE }} />);
  }
  if (id.startsWith("postgres-")) {
    return wrap(<Database {...p} style={{ color: INFRA_ICON_STROKE }} />);
  }
  if (id === "kafka") {
    return wrap(<Radio {...p} style={{ color: INFRA_ICON_STROKE }} />);
  }
  if (id === "sqs") {
    return wrap(<Inbox {...p} style={{ color: INFRA_ICON_STROKE }} />);
  }
  if (id === "rabbitmq") {
    return wrap(<MessagesSquare {...p} style={{ color: INFRA_ICON_STROKE }} />);
  }
  if (id === "metal-mart-frontend") {
    return wrap(<Monitor {...p} style={{ color: "#CA8A04" }} />);
  }
  if (id === "inventory-service") {
    return wrap(<Package {...p} style={{ color: "#CA8A04" }} />);
  }
  if (id === "order-service") {
    return wrap(<ShoppingCart {...p} style={{ color: "#CA8A04" }} />);
  }
  if (id === "payment-service") {
    return wrap(<CreditCard {...p} style={{ color: "#CA8A04" }} />);
  }
  if (id === "receipt-service") {
    return wrap(<FileText {...p} style={{ color: "#CA8A04" }} />);
  }
  if (id === "delivery-service") {
    return wrap(<Truck {...p} style={{ color: "#CA8A04" }} />);
  }
  if (id === "notifications-service") {
    return wrap(<Bell {...p} style={{ color: "#CA8A04" }} />);
  }
  if (
    id.endsWith("-service") ||
    id.includes("service") ||
    id.includes("frontend")
  ) {
    return wrap(<Boxes {...p} style={{ color: "#CA8A04" }} />);
  }

  return wrap(<Boxes {...p} style={{ color: INFRA_ICON_STROKE }} />);
}

/** Dynamic DB branch node — database glyph; preview branches use sky blue. */
export function PgBranchGlyph({ matchesPreview }: { matchesPreview: boolean }) {
  const color = matchesPreview ? "#0EA5E9" : "#336791";
  return wrap(
    <Database size={SZ} strokeWidth={stroke} style={{ color }} aria-hidden />,
  );
}
