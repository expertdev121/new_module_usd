"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import React from "react";

/**
 * Modern, page-title-first breadcrumb. Renders as a small "kicker" line above
 * each page's heading — Linear / Vercel / Notion pattern.
 *
 * Design rules:
 *  - Tiny, unobtrusive (text-xs, muted). The page's own <h1> remains the
 *    visual anchor; this just provides location context.
 *  - Middle-dot separator (·) reads cleaner than chevrons at this size.
 *  - Last segment uses foreground color but is NOT visually heavy — it only
 *    signals "you are here" without competing with the page title below.
 *  - Numeric URL segments (e.g. /contacts/123) are filtered out so we don't
 *    show meaningless IDs like "Home · Contacts · 12345".
 *  - Hidden entirely on the root path — there's nowhere to navigate up to.
 */
export function CurrentBreadcrumb() {
  const pathname = usePathname();

  const segments = pathname
    .split("/")
    .filter(Boolean)
    .map((segment, index, array) => {
      const href = "/" + array.slice(0, index + 1).join("/");
      const label = decodeURIComponent(segment).replace(/-/g, " ");
      return {
        label: label.charAt(0).toUpperCase() + label.slice(1),
        href,
      };
    })
    .filter((segment) => !/\d/.test(segment.label.toLowerCase()));

  if (segments.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="mb-3">
      <ol className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
        <li>
          <Link
            href="/"
            className="transition-colors hover:text-foreground"
          >
            Home
          </Link>
        </li>
        {segments.map((segment, index) => {
          const isLast = index === segments.length - 1;
          return (
            <React.Fragment key={segment.href}>
              <li aria-hidden className="select-none text-muted-foreground/40">
                ·
              </li>
              <li>
                {isLast ? (
                  <span className="font-medium text-foreground">
                    {segment.label}
                  </span>
                ) : (
                  <Link
                    href={segment.href}
                    className="transition-colors hover:text-foreground"
                  >
                    {segment.label}
                  </Link>
                )}
              </li>
            </React.Fragment>
          );
        })}
      </ol>
    </nav>
  );
}
