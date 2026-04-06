'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
  { href: '/',           label: 'Dashboard' },
  { href: '/search',     label: 'Ara' },
  { href: '/closing',    label: 'Kapanacaklar' },
  { href: '/compare',    label: 'Karşılaştır' },
];

export default function Navbar() {
  const path = usePathname();

  return (
    <nav className="border-b border-poly-border bg-poly-card/50 backdrop-blur-sm sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 flex items-center justify-between h-14">
        <Link href="/" className="font-bold text-lg text-white flex items-center gap-2">
          <span className="text-poly-blue">PM</span> Polymarket Dashboard
        </Link>
        <div className="flex gap-1">
          {links.map(l => (
            <Link
              key={l.href}
              href={l.href}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
                path === l.href
                  ? 'bg-poly-blue/20 text-poly-blue font-medium'
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              {l.label}
            </Link>
          ))}
        </div>
      </div>
    </nav>
  );
}
