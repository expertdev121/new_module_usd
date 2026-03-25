import React from "react";
import { ColumnDef } from "@tanstack/react-table";
import { AuditLogEntry } from "@/lib/query/useAdminAuditLogs";

const ACTION_CONFIG: Record<string, { bg: string; text: string; dot: string }> = {
  delete: { bg: "bg-red-50", text: "text-red-700", dot: "bg-red-500" },
  create: { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" },
  update: { bg: "bg-sky-50", text: "text-sky-700", dot: "bg-sky-400" },
  login:  { bg: "bg-violet-50", text: "text-violet-700", dot: "bg-violet-400" },
  logout: { bg: "bg-slate-100", text: "text-slate-600", dot: "bg-slate-400" },
  merge:  { bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-400" },
};

function getActionConfig(action: string) {
  const key = Object.keys(ACTION_CONFIG).find((k) => action.toLowerCase().includes(k));
  return key ? ACTION_CONFIG[key] : { bg: "bg-slate-100", text: "text-slate-600", dot: "bg-slate-400" };
}

function formatDetails(details: unknown, action: string): string {
  if (!details) return "—";

  const actionLower = action.toLowerCase();

  try {
    const parsed = typeof details === "string" ? JSON.parse(details) : details;

    // --- MERGE ---
    if (actionLower.includes("merge")) {
      const sourceId = parsed.mergedContactId ?? parsed.sourceContactId;
      const targetId = parsed.intoContactId ?? parsed.targetContactId;
      const sourceName = parsed.sourceContactName ?? parsed.mergedContactName ?? "";
      const targetName = parsed.intoContactName ?? parsed.targetContactName ?? "";

      if (sourceId && targetId) {
        const sourceList = Array.isArray(sourceId)
          ? sourceId.map((id: unknown) => `#${id}`).join(", ")
          : `#${sourceId}`;
        const sourceLabel = sourceName ? `${sourceName} (${sourceList})` : sourceList;
        const targetLabel = targetName ? `${targetName} (#${targetId})` : `#${targetId}`;
        return `Contact ${sourceLabel} was merged into ${targetLabel}. The merged contact no longer exists.`;
      }

      if (parsed.targetContactId) {
        const targetLabel = targetName ? `${targetName} (#${parsed.targetContactId})` : `#${parsed.targetContactId}`;
        return `One or more contacts were merged into ${targetLabel}. The merged contacts no longer exist.`;
      }
    }

    // --- CONTACT DELETE ---
    if (actionLower.includes("delete") && parsed.contactId !== undefined) {
      const name = parsed.contactName ?? parsed.name ?? "";
      const email = parsed.contactEmail ?? parsed.email ?? "";
      const phone = parsed.contactPhone ?? parsed.phone ?? "";

      const who = [
        name && `"${name}"`,
        email && `(${email})`,
        phone && `· ${phone}`,
      ].filter(Boolean).join(" ");

      return who
        ? `Contact ${who} was permanently deleted.`
        : `Contact #${parsed.contactId} was permanently deleted.`;
    }

    // --- CATEGORY DELETE ---
    if (actionLower.includes("delete") && parsed.categoryId !== undefined) {
      const catName = parsed.name ?? parsed.categoryName ?? "";
      return catName
        ? `Category "${catName}" was permanently deleted.`
        : `Category #${parsed.categoryId} was permanently deleted.`;
    }

    // --- CONTACT UPDATE with changedFields ---
    if (actionLower.includes("update") && Array.isArray(parsed.changedFields) && parsed.changedFields.length > 0) {
      const id = parsed.contactId ?? parsed.entityId ?? "?";
      const name = parsed.contactName ?? parsed.name ?? "";
      const count = parsed.changedFields.length;
      const fieldNames = parsed.changedFields
        .slice(0, 3)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((f: any) => f.field ?? f.name ?? "field")
        .join(", ");
      const more = count > 3 ? ` and ${count - 3} more` : "";
      const who = name ? `"${name}" (#${id})` : `#${id}`;
      return `Updated ${fieldNames}${more} on contact ${who}.`;
    }

    // --- CONTACT UPDATE (no changedFields) ---
    if (actionLower.includes("update") && parsed.contactId !== undefined) {
      const name = parsed.contactName ?? parsed.name ?? "";
      const who = name ? `"${name}" (#${parsed.contactId})` : `#${parsed.contactId}`;
      return `Contact ${who} was updated.`;
    }

    // --- CATEGORY CREATE ---
    if (actionLower.includes("create") && parsed.categoryId !== undefined) {
      const catName = parsed.name ?? parsed.categoryName ?? "";
      return catName
        ? `Category "${catName}" was created.`
        : `A new category was created.`;
    }

    // --- GENERIC CONTACT ---
    if (parsed.contactId !== undefined) {
      const name = parsed.contactName ?? parsed.name ?? "";
      const who = name ? `"${name}" (#${parsed.contactId})` : `#${parsed.contactId}`;
      return `Contact ${who}.`;
    }

    // --- GENERIC CATEGORY ---
    if (parsed.categoryId !== undefined) {
      const catName = parsed.name ?? parsed.categoryName ?? "";
      return catName ? `Category "${catName}".` : `Category #${parsed.categoryId}.`;
    }

    // --- GENERIC ENTITY ---
    if (parsed.entityId !== undefined) {
      return `${parsed.entity ?? "Item"} #${parsed.entityId}.`;
    }

    // --- FALLBACK ---
    return Object.entries(parsed)
      .slice(0, 3)
      .map(([k, v]) => {
        const val = typeof v === "object" ? JSON.stringify(v) : String(v);
        return `${k}: ${val.slice(0, 30)}`;
      })
      .join(" · ");

  } catch {
    return String(details).slice(0, 120);
  }
}

const headerCell = (label: string) =>
  React.createElement(
    "span",
    { className: "text-xs font-semibold uppercase tracking-widest text-slate-400" },
    label
  );

export const columns: ColumnDef<AuditLogEntry>[] = [
  {
    accessorKey: "timestamp",
    header: () => headerCell("Timestamp"),
    cell: ({ row }) => {
      const date = new Date(row.original.timestamp);
      return React.createElement(
        "div",
        { className: "flex flex-col gap-0.5" },
        React.createElement(
          "span",
          { className: "text-sm font-medium text-slate-800 tabular-nums" },
          date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
        ),
        React.createElement(
          "span",
          { className: "text-xs text-slate-400 tabular-nums" },
          date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
        )
      );
    },
  },
  {
    accessorKey: "userEmail",
    header: () => headerCell("User"),
    cell: ({ row }) => {
      const email = row.original.userEmail ?? "";
      return React.createElement(
        "div",
        { className: "flex items-center gap-2" },
        React.createElement(
          "div",
          { className: "w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center flex-shrink-0" },
          React.createElement(
            "span",
            { className: "text-xs font-semibold text-slate-500" },
            email[0]?.toUpperCase() ?? "?"
          )
        ),
        React.createElement(
          "span",
          { className: "text-sm text-slate-700 truncate max-w-[160px]" },
          email
        )
      );
    },
  },
  {
    accessorKey: "action",
    header: () => headerCell("Action"),
    cell: ({ row }) => {
      const action = row.original.action;
      const cfg = getActionConfig(action);
      return React.createElement(
        "span",
        { className: `inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium tracking-wide ${cfg.bg} ${cfg.text}` },
        React.createElement("span", { className: `w-1.5 h-1.5 rounded-full flex-shrink-0 ${cfg.dot}` }),
        action
      );
    },
  },
  {
    id: "details",
    header: () => headerCell("Details"),
    cell: ({ row }) => {
      const text = formatDetails(row.original.details, row.original.action);
      return React.createElement(
        "span",
        {
          className: "text-sm text-slate-600 max-w-[420px] block truncate",
          title: text,
        },
        text
      );
    },
  },
];