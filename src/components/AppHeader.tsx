'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export interface NavItem {
  href: string;
  label: string;
}

const IMPLEMENTED_NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Overview' },
  { href: '/library', label: 'Library' },
  { href: '/extraction', label: 'Extraction' },
  { href: '/exchange', label: 'Export & Recovery' },
];

export function AppHeader({
  navItems = IMPLEMENTED_NAV_ITEMS,
  revision,
}: {
  navItems?: NavItem[];
  revision?: number | null;
}) {
  const pathname = usePathname();

  return (
    <header className="app-header">
      <div className="app-header-inner">
        <div className="brand-group">
          <Link href="/" className="brand-mark">
            TermForge
          </Link>
          <span className="brand-subtitle">Scientific Lexicon</span>
        </div>

        <nav className="app-nav" aria-label="Workspace navigation">
          {navItems.map((item) => {
            const isActive =
              item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={isActive ? 'nav-link active' : 'nav-link'}
                aria-current={isActive ? 'page' : undefined}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="header-meta">
          <span className="tag">Browser-local</span>
          {typeof revision === 'number' && (
            <span className="tag tag-mono" data-testid="header-revision">
              Rev {revision}
            </span>
          )}
        </div>
      </div>
    </header>
  );
}
