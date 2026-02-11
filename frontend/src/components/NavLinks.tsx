"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/missions", label: "Missions" },
  { href: "/demo", label: "Demo" },
  { href: "/policies", label: "Policies" },
];

export function NavLinks() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  function isActive(href: string) {
    if (href === "/") return pathname === "/";
    return pathname.startsWith(href);
  }

  return (
    <>
      {/* Desktop links */}
      <div className="hidden md:flex items-center gap-1 ml-8">
        {links.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition ${
              isActive(l.href)
                ? "bg-slate-700 text-white"
                : "text-slate-300 hover:text-white hover:bg-slate-700/50"
            }`}
          >
            {l.label}
          </Link>
        ))}
      </div>

      {/* Mobile hamburger */}
      <button
        className="md:hidden ml-4 p-2 rounded-lg hover:bg-slate-700/50 text-slate-300"
        onClick={() => setOpen(!open)}
        aria-label="Toggle navigation"
      >
        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          {open ? (
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          ) : (
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          )}
        </svg>
      </button>

      {/* Mobile dropdown */}
      {open && (
        <div className="absolute top-full left-0 right-0 bg-slate-800 border-b border-slate-700 md:hidden z-50">
          <div className="px-4 py-2 space-y-1">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setOpen(false)}
                className={`block px-3 py-2 rounded-lg text-sm font-medium transition ${
                  isActive(l.href)
                    ? "bg-slate-700 text-white"
                    : "text-slate-300 hover:text-white hover:bg-slate-700/50"
                }`}
              >
                {l.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
